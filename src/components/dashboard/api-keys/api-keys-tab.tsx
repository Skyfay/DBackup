"use client";

import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff, Trash } from "lucide-react";
import { toast } from "sonner";
import { bulkDeleteApiKeys, bulkToggleApiKeys, toggleApiKey } from "@/app/actions/auth/api-key";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { QuickFilter } from "@/components/ui/quick-filter";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageModel } from "@/hooks/use-page-model";
import { useTableLayout } from "@/hooks/use-table-layout";
import { unwrapBulkAction } from "@/lib/bulk-request";
import type { TablePreferences } from "@/lib/core/table-preferences";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import { runsOutSoon, type ApiKeyRow, type ApiKeysModel } from "@/services/auth/api-keys-types";
import { apiKeyActions, type ApiKeyActionHandlers } from "./api-key-actions";
import { ApiKeyCard } from "./api-key-card";
import { keyLine, KeyTile } from "./api-key-cells";
import { apiKeyColumns, apiKeyFilters } from "./api-key-columns";
import { ApiKeyDeleteDialog, ApiKeyRotateDialog } from "./api-key-confirm-dialogs";
import { ApiKeyCreatedDialog, type CreatedKey } from "./api-key-created-dialog";
import { ApiKeyDetails } from "./api-key-details";
import { ApiKeyFormDialog, type ApiKeyFormMode } from "./api-key-form-dialog";
import { ApiKeysStrip } from "./api-key-strip";
import { API_KEYS_TABLE_ID } from "./api-keys-tables";
import { useOpenFromLink } from "@/hooks/use-open-from-link";

const log = logger.child({ component: "api-keys-tab" });

/** What the page around the list can start, like New API key beside the tabs. */
export interface ApiKeysTabHandle {
    openCreate: () => void;
}

type Quick = "all" | "active" | "soon" | "disabled" | "expired";

const QUICK: { value: Quick; label: string; keep: (key: ApiKeyRow, now: number) => boolean }[] = [
    { value: "all", label: "All", keep: () => true },
    { value: "active", label: "Active", keep: (key) => key.state === "enabled" },
    { value: "soon", label: "Runs out soon", keep: runsOutSoon },
    { value: "disabled", label: "Disabled", keep: (key) => key.state === "disabled" },
    { value: "expired", label: "Expired", keep: (key) => key.state === "expired" },
];

const RAN_OUT = "Ran out, edit it to give it a new end";

interface ApiKeysTabProps {
    ref?: Ref<ApiKeysTabHandle>;
    view: "table" | "cards";
    /** May create, change, rotate and delete keys. */
    canManage: boolean;
    /** May open the runs a key started. */
    canOpenRuns: boolean;
    initialLayout: TablePreferences | null;
}

/**
 * The API keys: the numbers, then the list as a table or as cards, a panel with what a key may do
 * and the runs it started, and the dialogs to make, change, rotate and delete a key. A phone gets cards.
 */
export function ApiKeysTab({ ref, view, canManage, canOpenRuns, initialLayout }: ApiKeysTabProps) {
    const router = useRouter();
    const { model, isLoading, refresh } = usePageModel<ApiKeysModel>("/api/api-keys", "The API keys could not be loaded.");
    const layout = useTableLayout(API_KEYS_TABLE_ID, initialLayout);
    const [now] = useState(() => Date.now());
    const [quick, setQuick] = useState<Quick>("all");
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [version, setVersion] = useState(0);
    const [form, setForm] = useState<{ open: boolean; mode: ApiKeyFormMode }>({ open: false, mode: { kind: "create" } });
    const [rotating, setRotating] = useState<ApiKeyRow | null>(null);
    const [removing, setRemoving] = useState<ApiKeyRow | null>(null);
    const [secret, setSecret] = useState<CreatedKey | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true, mode: { kind: "create" } }) }), []);

    // The counts beside the tabs come from the server, so they are loaded again too.
    const afterChange = useCallback(() => {
        void refresh();
        setVersion((current) => current + 1);
        router.refresh();
    }, [refresh, router]);

    const toggle = useCallback(async (key: ApiKeyRow) => {
        const enabled = key.state === "disabled";
        try {
            const result = await toggleApiKey(key.id, enabled);
            if (!result.success) {
                toast.error(result.error || "The key could not be changed.");
                return;
            }
            toast.success(`${key.name} ${enabled ? "enabled" : "disabled"}`);
            afterChange();
        } catch (error) {
            // Without the right to change API keys the actions throw instead of answering.
            log.warn("Toggling an API key failed", { apiKeyId: key.id }, wrapError(error));
            toast.error("The key could not be changed.");
        }
    }, [afterChange]);

    const handlers = useMemo<ApiKeyActionHandlers>(() => canManage ? {
        onEdit: (key) => setForm({ open: true, mode: { kind: "edit", key } }),
        onRotate: setRotating,
        onToggle: (key) => void toggle(key),
        onDelete: setRemoving,
    } : {}, [canManage, toggle]);

    // Rotating hands out the secret, so only the owner or someone who may do all the key may do rotates it.
    const viewerPermissions = useMemo(() => model?.viewer.permissions ?? [], [model]);
    const handlersFor = useCallback((key: ApiKeyRow): ApiKeyActionHandlers => {
        const viewer = new Set(viewerPermissions);
        return key.isMine || key.effective.every((permission) => viewer.has(permission)) ? handlers : { ...handlers, onRotate: undefined };
    }, [handlers, viewerPermissions]);

    const open = useCallback((key: ApiKeyRow) => setDetails({ id: key.id, open: true }), []);
    // A link like the search in the header opens one with `?open=`.
    useOpenFromLink(model?.keys, open);
    const columns = useMemo(
        () => apiKeyColumns({ onOpen: open, now, renderActions: (key) => <BackupRowMenu name={key.name} groups={apiKeyActions(key, handlersFor(key))} /> }),
        [open, now, handlersFor]
    );

    const keys = useMemo(() => model?.keys ?? [], [model]);
    const rows = useMemo(() => {
        const keep = QUICK.find((option) => option.value === quick)?.keep ?? (() => true);
        return keys.filter((key) => keep(key, now));
    }, [keys, quick, now]);
    const filters = useMemo(() => apiKeyFilters(keys), [keys]);
    const bulkActions = useMemo<BulkAction<ApiKeyRow>[]>(() => canManage ? [
        {
            id: "enable",
            labels: { verb: "enable", verbPast: "enabled", noun: "API key" },
            icon: Power,
            isAvailable: (selected) => selected.some((key) => key.state === "disabled"),
            itemName: (key) => key.name,
            ineligible: (key) => (key.state === "expired" ? RAN_OUT : null),
            run: (selected) => unwrapBulkAction(bulkToggleApiKeys(selected.map((key) => key.id), true)),
        },
        {
            id: "disable",
            labels: { verb: "disable", verbPast: "disabled", noun: "API key" },
            icon: PowerOff,
            isAvailable: (selected) => selected.some((key) => key.state === "enabled"),
            itemName: (key) => key.name,
            ineligible: (key) => (key.state === "expired" ? RAN_OUT : null),
            run: (selected) => unwrapBulkAction(bulkToggleApiKeys(selected.map((key) => key.id), false)),
        },
        {
            id: "delete",
            labels: { verb: "delete", verbPast: "deleted", noun: "API key" },
            icon: Trash,
            variant: "destructive",
            itemName: (key) => key.name,
            itemDetail: (key) => key.owner.name,
            confirm: {
                title: (selected) => `Delete ${selected.length} API key${selected.length === 1 ? "" : "s"}?`,
                description: () => "Whatever uses them is refused from its next request. The runs they started stay in History.",
                confirmLabel: "Delete",
            },
            run: (selected) => unwrapBulkAction(bulkDeleteApiKeys(selected.map((key) => key.id))),
        },
    ] : [], [canManage]);

    const shown = details ? keys.find((key) => key.id === details.id) ?? null : null;
    const shownHandlers = shown ? handlersFor(shown) : {};

    return (
        <div className="space-y-4 md:space-y-0">
            <ApiKeysStrip model={model} />

            {!model ? (
                <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
                    <span className="sr-only">Loading API keys</span>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-60" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                    {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
                </div>
            ) : (
                <DataTable
                    joined
                    columns={columns}
                    data={rows}
                    searchKey="name"
                    searchPlaceholder="Search by name or prefix"
                    filterableColumns={filters}
                    toolbarExtra={
                        <QuickFilter
                            aria-label="Filter by state"
                            value={quick}
                            onChange={setQuick}
                            options={QUICK.map((option) => {
                                const count = keys.filter((key) => option.keep(key, now)).length;
                                // Amber like the badge of such a key, once one runs out soon.
                                return { value: option.value, label: option.label, count, ...(option.value === "soon" && count > 0 ? { dot: "bg-warning" } : {}) };
                            })}
                        />
                    }
                    onRefresh={refresh}
                    isLoading={isLoading}
                    enableRowSelection={canManage && view === "table"}
                    getRowId={(key) => key.id}
                    bulkActions={bulkActions}
                    onBulkActionComplete={afterChange}
                    columnLayout={layout}
                    onRowClick={open}
                    activeRowId={details?.open ? details.id : null}
                    view={view}
                    renderCard={(row) => (
                        <ApiKeyCard apiKey={row.original} now={now} onOpen={open} actions={<BackupRowMenu name={row.original.name} groups={apiKeyActions(row.original, handlersFor(row.original))} />} />
                    )}
                    renderRowMenu={(key, bulk) => (
                        <BackupContextMenu tile={<KeyTile size="sm" />} title={key.name} note={keyLine(key)} groups={apiKeyActions(key, handlersFor(key))} bulk={bulk} />
                    )}
                />
            )}

            <ApiKeyDetails
                open={details?.open ?? false}
                apiKey={shown}
                now={now}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={shownHandlers.onEdit}
                onRotate={shownHandlers.onRotate}
                keyMenu={shown ? apiKeyActions(shown, shownHandlers, true) : []}
                canOpenRuns={canOpenRuns}
                version={version}
            />

            <ApiKeyFormDialog
                open={form.open}
                mode={form.mode}
                keys={keys}
                viewerPermissions={viewerPermissions}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                onSaved={afterChange}
            />

            {rotating && (
                <ApiKeyRotateDialog
                    apiKey={rotating}
                    now={now}
                    onClose={() => setRotating(null)}
                    onRotated={(created) => {
                        setRotating(null);
                        setSecret(created);
                        afterChange();
                    }}
                />
            )}
            {removing && (
                <ApiKeyDeleteDialog
                    apiKey={removing}
                    now={now}
                    onClose={() => setRemoving(null)}
                    onDeleted={() => {
                        setRemoving(null);
                        setDetails(null);
                        afterChange();
                    }}
                />
            )}
            {secret && <ApiKeyCreatedDialog created={secret} onClose={() => setSecret(null)} />}
        </div>
    );
}
