
"use client";

import { useState, useEffect, useCallback, useMemo, useImperativeHandle, type Ref } from "react";
import { STORAGE_ROLES, storageRoleLabel, supportsStorageRole, canOfferCounterpart, counterpartStorageRole, type StorageRole } from "@/lib/core/storage-roles";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DIALOG_SURFACE } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { ADAPTER_DEFINITIONS, AdapterDefinition } from "@/lib/adapters/definitions";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import { useRouter } from "next/navigation";

import { AdapterManagerProps, AdapterConfig } from "./types";
import { AdapterForm } from "./adapter-form";
import { ConnectionForm } from "./connection-form";
import { AdapterPickerDialog } from "./adapter-picker";
import { StorageHistoryModal } from "@/components/dashboard/widgets/storage-history-modal";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { CloneDialog } from "@/components/ui/clone-dialog";
import { useTableLayout } from "@/hooks/use-table-layout";
import { connectionColumns, type ConnectionKind } from "./connection-columns";
import { ConnectionRowActions } from "./connection-row-actions";
import { ConnectionContextMenu } from "./connection-context-menu";
import type { ConnectionActionHandlers } from "./connection-actions";
import { ConnectionStatusFilter, matchesStatus, type StatusFilter } from "./connection-status-filter";
import { ConnectionDetailsSheet } from "./connection-details-sheet";
import { ConnectionDetailsContent } from "./connection-details-content";
import { ConnectionCard } from "./connection-card";
import { ConnectionSplitView } from "./connection-split-view";
import { adapterTypeIcon } from "./connection-type-icon";
import { connectionBulkActions, deleteBlocker } from "./connection-bulk-actions";
import { ConnectionDeleteDialog } from "./connection-delete-dialog";

/** What the page around a manager can trigger, such as the Add button beside the tabs. */
export interface AdapterManagerHandle {
    openCreate: () => void;
}

const SEARCH_NOUNS: Record<ConnectionKind, string> = {
    database: "databases",
    source: "sources",
    destination: "destinations",
    notification: "channels",
};

export function AdapterManager({ ref, type, canManage = true, permissions = [], roleFilter, defaultRole, tableId, initialLayout = null, view }: AdapterManagerProps & { ref?: Ref<AdapterManagerHandle> }) {
    const [configs, setConfigs] = useState<AdapterConfig[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [selectedAdapterForNew, setSelectedAdapterForNew] = useState<string | null>(null);
    const [availableAdapters, setAvailableAdapters] = useState<AdapterDefinition[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [cloningId, setCloningId] = useState<string | null>(null);
    // A clone target with a role is the counterpart action: same server and credentials in
    // the opposite role, so the same NAS does not have to be configured twice by hand.
    const [cloneTarget, setCloneTarget] = useState<{ id: string; name: string; role?: StorageRole } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    // Only the first load shows a skeleton. A refresh keeps the rows and spins the button.
    const [hasLoaded, setHasLoaded] = useState(false);
    const [historyAdapter, setHistoryAdapter] = useState<{ id: string; name: string; adapterId: string } | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    // The id stays after closing, so the panel keeps its content while it slides out. The view
    // it was opened in is kept too, so leaving that view closes it for good.
    const [details, setDetails] = useState<{ id: string; open: boolean; view: typeof view } | null>(null);
    // The split view shows one connection at a time. Null picks the first one listed.
    const [splitId, setSplitId] = useState<string | null>(null);
    const router = useRouter();
    const layout = useTableLayout(tableId, initialLayout);

    const kind: ConnectionKind =
        type === "database" ? "database"
            : type === "notification" ? "notification"
                : roleFilter === STORAGE_ROLES.SOURCE ? "source" : "destination";

    // A storage adapter has exactly one role; a manager instance scoped to one (the
    // "Directory Sources" section, the Destinations page) only shows configs in it -
    // filtered client-side against the single type=storage fetch.
    const applyRoleFilter = useCallback((data: AdapterConfig[]) => {
        if (!roleFilter || type !== 'storage') return data;
        return data.filter((c) => (c.storageRole ?? STORAGE_ROLES.DESTINATION) === roleFilter);
    }, [roleFilter, type]);

    // The overview adds usage, last backup and health. The server caches it for a minute,
    // so the frequent status poll stays cheap.
    const listUrl = `/api/adapters?type=${type}&overview=true`;

    const fetchConfigs = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(listUrl);
            if (res.ok) {
                const data = await res.json();
                setConfigs(applyRoleFilter(data));
            } else {
                 const data = await res.json();
                 toast.error(data.error || "Failed to load configurations");
            }
        } catch (_error) {
            toast.error("Failed to load configurations");
        } finally {
            setIsLoading(false);
            setHasLoaded(true);
        }
    }, [listUrl, applyRoleFilter]);

    // Silent polling refresh (no loading spinner, no error toasts)
    const silentRefresh = useCallback(async () => {
        try {
            const res = await fetch(listUrl);
            if (res.ok) {
                const data = await res.json();
                setConfigs(applyRoleFilter(data));
            }
        } catch {
            // Silent - don't disturb the user on background poll failures
        }
    }, [listUrl, applyRoleFilter]);

    // After a change the counts beside the tabs are stale too, and they come from the server.
    const afterChange = useCallback(() => {
        fetchConfigs();
        router.refresh();
    }, [fetchConfigs, router]);

    // The role a config created here will hold. Destinations and Directory Sources are two
    // instances over the same `type="storage"` list, so the type alone cannot say which
    // adapters belong on this page.
    const pickerRole = defaultRole ?? roleFilter;

    // The dialogs used to say "Destination" for every storage adapter, so the Directory
    // Sources page invited you to add a destination and then filed it under sources.
    const storageNoun = pickerRole ? storageRoleLabel(pickerRole) : "Storage Connection";

    useImperativeHandle(ref, () => ({
        openCreate: () => {
            setEditingId(null);
            setSelectedAdapterForNew(null);
            setIsPickerOpen(true);
        },
    }), []);

    useEffect(() => {
        // Filtered by type, and for storage also by the role this page creates. An adapter
        // that cannot serve that role has no business being offered - the API refuses it,
        // so picking it could only ever end in a rejected save.
        setAvailableAdapters(ADAPTER_DEFINITIONS.filter(d =>
            d.type === type
            && (type !== 'storage' || !pickerRole || supportsStorageRole(d.supportedRoles, pickerRole))
        ));
        fetchConfigs();
    }, [type, pickerRole, fetchConfigs]);

    // Poll every 10 seconds to keep health status up to date
    useEffect(() => {
        const interval = setInterval(silentRefresh, 10000);
        return () => clearInterval(interval);
    }, [silentRefresh]);

    const cloneAdapter = async (id: string, name: string, role?: StorageRole) => {
        setCloningId(id);
        try {
            const res = await fetch(`/api/adapters/${id}/clone`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, ...(role ? { role } : {}) }),
            });
            const data = await res.json();
            if (res.ok) {
                // A counterpart lands in the other role, so it will not show up in this
                // list - say where it went instead of leaving the user looking for it.
                toast.success(role
                    ? `Created "${name}" as a ${storageRoleLabel(role)}. Adjust its path there.`
                    : "Configuration cloned successfully");
                afterChange();
            } else {
                toast.error(data.error || "Failed to clone configuration");
            }
        } catch (_error) {
            toast.error("Error cloning configuration");
        } finally {
            setCloningId(null);
            setCloneTarget(null);
        }
    };

    const canViewHealth = permissions.includes(type === "database" ? PERMISSIONS.SOURCES.VIEW : PERMISSIONS.DESTINATIONS.READ);
    const canViewStorage = permissions.includes(PERMISSIONS.STORAGE.READ);

    /**
     * What one connection can do. The panel shows Explore and Edit as buttons of their own,
     * so its menu leaves them out.
     */
    const rowHandlers = useCallback((config: AdapterConfig, inPanel = false): ConnectionActionHandlers => {
        // Same server and credentials in the other role. An adapter that only works one way
        // round has no counterpart, and the API would refuse the clone.
        const counterpartOf = () => {
            const current = config.storageRole ?? STORAGE_ROLES.DESTINATION;
            const counterpart = counterpartStorageRole(current);
            const definition = ADAPTER_DEFINITIONS.find((d) => d.id === config.adapterId);
            if (!canOfferCounterpart(definition?.supportedRoles, current)) return undefined;
            return {
                label: `Create as ${storageRoleLabel(counterpart)}`,
                onSelect: () => setCloneTarget({
                    id: config.id,
                    name: `${config.name} (${counterpart === STORAGE_ROLES.SOURCE ? 'Source' : 'Destination'})`,
                    role: counterpart,
                }),
            };
        };

        // Only a destination holds backups, so only it has a storage history.
        const isDestination = type === "storage" && (config.storageRole ?? STORAGE_ROLES.DESTINATION) === STORAGE_ROLES.DESTINATION;

        return {
            onExplore: !inPanel && type === "database" ? () => router.push(`/dashboard/explorer?sourceId=${config.id}`) : undefined,
            onHistory: isDestination && canViewStorage ? () => setHistoryAdapter({ id: config.id, name: config.name, adapterId: config.adapterId }) : undefined,
            onEdit: !inPanel && canManage ? () => { setEditingId(config.id); setIsDialogOpen(true); } : undefined,
            onClone: canManage ? () => setCloneTarget({ id: config.id, name: config.name }) : undefined,
            counterpart: canManage && type === "storage" ? counterpartOf() : undefined,
            onDelete: canManage ? () => {
                // The row already knows whether a job or a template still holds the connection.
                const blocker = deleteBlocker(config);
                if (blocker) toast.error(`${config.name} cannot be deleted. ${blocker}.`);
                else setDeletingId(config.id);
            } : undefined,
            busy: cloningId === config.id,
        };
    }, [type, canViewStorage, canManage, cloningId, router]);

    const renderActions = useCallback(
        (config: AdapterConfig, inPanel = false) => <ConnectionRowActions name={config.name} {...rowHandlers(config, inPanel)} />,
        [rowHandlers]
    );

    const openDetails = useCallback((config: AdapterConfig) => setDetails({ id: config.id, open: true, view }), [view]);

    const columns = useMemo(
        () => connectionColumns({ kind, canViewHealth, renderActions: (config) => renderActions(config), onOpen: openDetails }),
        [kind, canViewHealth, renderActions, openDetails]
    );

    // A deleted connection has no row left to show, so its panel closes with it.
    const detailsConfig = details ? configs.find((config) => config.id === details.id) ?? null : null;
    const deleting = deletingId ? configs.find((config) => config.id === deletingId) : undefined;
    const canViewHistory = permissions.includes(PERMISSIONS.HISTORY.READ);

    /** What the details of one connection offer, the same in the side panel and in the split view. */
    const detailProps = (config: AdapterConfig) => ({
        kind,
        canTest: canManage && type !== "notification",
        canViewHistory,
        exploreHref: type === "database" ? `/dashboard/explorer?sourceId=${config.id}` : undefined,
        onEdit: canManage ? () => { setEditingId(config.id); setIsDialogOpen(true); } : undefined,
        menu: renderActions(config, true),
    });

    const visibleConfigs = useMemo(() => configs.filter((config) => matchesStatus(config, statusFilter)), [configs, statusFilter]);

    // Only show filter options for adapter types that have at least one config entry
    const typeFilterColumns = useMemo(() => {
        const usedAdapterIds = new Set(configs.map(c => c.adapterId));
        const options = availableAdapters
            .filter(a => usedAdapterIds.has(a.id))
            .map(a => ({ label: a.name, value: a.id, icon: adapterTypeIcon(a.id) }));

        if (options.length <= 1) return [];
        return [{ id: "adapterId", title: "Type", options }];
    }, [configs, availableAdapters]);

    const bulkActions = useMemo(() => connectionBulkActions(kind, canManage), [kind, canManage]);

    // Stable reference for the adapter list passed to AdapterForm - prevents the
    // useEffect inside AdapterForm from re-running (and wiping typed values) when
    // unrelated state changes cause the parent to re-render.
    const adapterFormList = useMemo(
        () => selectedAdapterForNew
            ? availableAdapters.filter(a => a.id === selectedAdapterForNew)
            : availableAdapters,
        [selectedAdapterForNew, availableAdapters]
    );

    // The connection the form edits, or the type picked for a new one.
    const editingConfig = editingId ? configs.find((config) => config.id === editingId) : undefined;
    const formAdapterId = editingConfig?.adapterId ?? selectedAdapterForNew;
    const formAdapter = formAdapterId ? ADAPTER_DEFINITIONS.find((definition) => definition.id === formAdapterId) : undefined;
    const backToPicker = () => { setIsDialogOpen(false); setSelectedAdapterForNew(null); setIsPickerOpen(true); };
    const afterSave = () => { setIsDialogOpen(false); setSelectedAdapterForNew(null); afterChange(); };

    return (
        <div className="space-y-4">
            <CredentialUpgradeBanner configs={configs} />

            {!hasLoaded || !view ? (
                <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm" aria-busy="true">
                    <span className="sr-only">Loading connections</span>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-60" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                    {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} className="h-11 w-full" />
                    ))}
                </div>
            ) : (
                <DataTable
                    variant="card"
                    columns={columns}
                    data={visibleConfigs}
                    searchKey="name"
                    searchPlaceholder={`Search ${SEARCH_NOUNS[kind]}`}
                    onRefresh={fetchConfigs}
                    isLoading={isLoading}
                    filterableColumns={typeFilterColumns}
                    toolbarExtra={
                        <ConnectionStatusFilter
                            value={statusFilter}
                            onChange={setStatusFilter}
                            configs={configs}
                            withHealth={type !== "notification"}
                        />
                    }
                    // Selecting for bulk actions is a table thing. Cards keep to one connection at a time.
                    enableRowSelection={canManage && view === "table"}
                    // Load-bearing here: this list is re-fetched by a poll every
                    // 10 seconds, and index-keyed selection would jump each time.
                    getRowId={(config) => config.id}
                    bulkActions={bulkActions}
                    onBulkActionComplete={afterChange}
                    columnLayout={layout}
                    initialPageSize={20}
                    onRowClick={openDetails}
                    view={view}
                    renderCard={(row) => <ConnectionCard row={row} onOpen={openDetails} />}
                    renderRowMenu={(config, bulk) => (
                        <ConnectionContextMenu config={config} bulk={bulk} {...rowHandlers(config)} />
                    )}
                    renderSplit={(rows) => (
                        <ConnectionSplitView
                            configs={rows.map((row) => row.original)}
                            withHealth={type !== "notification"}
                            selectedId={splitId}
                            onSelect={setSplitId}
                            renderPanel={(config) => (
                                <ConnectionDetailsContent key={config.id} variant="inline" config={config} {...detailProps(config)} />
                            )}
                            renderMenu={(config) => <ConnectionContextMenu config={config} bulk={null} {...rowHandlers(config)} />}
                        />
                    )}
                />
            )}

            <ConnectionDetailsSheet
                // The split view shows the details itself, so the panel only opens in the view it was opened from.
                open={details !== null && details.open && details.view === view}
                config={detailsConfig}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                {...(detailsConfig ? detailProps(detailsConfig) : { kind, canTest: false, canViewHistory, menu: null })}
            />

            {/* Step 1: Adapter Picker */}
            <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                    <AdapterPickerDialog
                        adapters={availableAdapters}
                        title={type === 'notification' ? "Add notification channel" : (type === 'database' ? "Add database" : `Add ${storageNoun.toLowerCase()}`)}
                        onSelect={(adapter) => {
                            setSelectedAdapterForNew(adapter.id);
                            setIsPickerOpen(false);
                            setIsDialogOpen(true);
                        }}
                    />
                </DialogContent>
            </Dialog>

            {/* Step 2: the form. Databases and storage have the new one, notifications still the old one. */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                {type !== "notification" && formAdapter ? (
                    <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-3xl")}>
                        {isDialogOpen && (
                            <ConnectionForm
                                adapter={formAdapter}
                                initialData={editingConfig}
                                defaultRole={pickerRole}
                                onBack={editingId ? undefined : backToPicker}
                                onSaved={afterSave}
                            />
                        )}
                    </DialogContent>
                ) : (
                    <DialogContent className="sm:max-w-2xl max-h-[90vh] p-0" aria-describedby={undefined}>
                        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
                            <DialogTitle>{editingId ? "Edit Configuration" : "Add New Notification"}</DialogTitle>
                        </DialogHeader>
                        {isDialogOpen && (
                            <AdapterForm
                                type={type}
                                adapters={adapterFormList}
                                onSuccess={afterSave}
                                initialData={editingConfig}
                                onBack={editingId ? undefined : backToPicker}
                                defaultRole={defaultRole}
                            />
                        )}
                    </DialogContent>
                )}
            </Dialog>

            {deleting && (
                <ConnectionDeleteDialog
                    config={deleting}
                    onClose={() => setDeletingId(null)}
                    onDeleted={(id) => {
                        setConfigs((current) => current.filter((config) => config.id !== id));
                        router.refresh();
                    }}
                />
            )}

            {historyAdapter && (
                <StorageHistoryModal
                    open={!!historyAdapter}
                    onOpenChange={(open) => { if (!open) setHistoryAdapter(null); }}
                    configId={historyAdapter.id}
                    adapterName={historyAdapter.name}
                    adapterId={historyAdapter.adapterId}
                />
            )}

            <CloneDialog
                open={!!cloneTarget}
                onOpenChange={(open) => !open && setCloneTarget(null)}
                defaultName={cloneTarget?.name ?? ""}
                existingNames={configs.map((c) => c.name)}
                isLoading={!!cloningId}
                onConfirm={(name) => cloneAdapter(cloneTarget!.id, name, cloneTarget!.role)}
            />
        </div>
    );
}

/**
 * Banner shown at the top of the adapter manager when one or more adapters
 * are flagged OFFLINE due to a missing credential profile assignment.
 *
 * The startup-checks job sets `lastError = "No credential profile assigned"`
 * for adapters that existed before the credential vault (v2.0.0 migration).
 * New adapters where the user intentionally leaves the credential field empty
 * are never flagged and therefore never appear here.
 *
 * TODO(2026-06-28): Remove this migration banner. It was added for the v1.5
 * credential profiles rollout to guide users through reassigning their
 * credentials. By this point all active installs should have migrated.
 */
function CredentialUpgradeBanner({ configs }: { configs: AdapterConfig[] }) {
    const affected = configs.filter(
        (c) => (c.lastStatus === "OFFLINE" || c.lastStatus === "DEGRADED") && c.lastError === "No credential profile assigned"
    );
    if (affected.length === 0) return null;

    return (
        <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Credential profiles required</AlertTitle>
            <AlertDescription>
                <p className="mb-2">
                    {affected.length === 1 ? "1 adapter" : `${affected.length} adapters`} need a credential profile to come back online:
                </p>
                <ul className="list-disc pl-5 space-y-0.5 mb-2">
                    {affected.slice(0, 5).map((a) => (
                        <li key={a.id}>
                            <span className="font-medium">{a.name}</span>{" "}
                            <span className="text-xs">({a.adapterId})</span>
                        </li>
                    ))}
                    {affected.length > 5 && (
                        <li className="text-xs italic">
                            ...and {affected.length - 5} more.
                        </li>
                    )}
                </ul>
                <p className="text-sm">
                    Create reusable profiles in the{" "}
                    <Link href="/dashboard/vault" className="underline font-medium">
                        Security Vault
                    </Link>
                    , then assign them by editing each adapter.
                </p>
            </AlertDescription>
        </Alert>
    );
}
