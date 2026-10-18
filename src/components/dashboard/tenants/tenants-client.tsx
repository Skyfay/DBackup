"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Building2, Eye, Loader2, Plus, Trash } from "lucide-react";
import { bulkDeleteTenants } from "@/app/actions/tenant/tenant";
import { TENANTS_TABLE_ID } from "@/components/dashboard/platform/platform-tables";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { useOpenInTenant } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs } from "@/components/ui/tabs";
import { useOpenFromLink } from "@/hooks/use-open-from-link";
import { useTableLayout } from "@/hooks/use-table-layout";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { attentionOf } from "@/lib/core/tab-attention";
import type { TablePreferences } from "@/lib/core/table-preferences";
import { TenantTile, tenantActions, tenantColumns, tenantNote, type TenantHandlers } from "./tenant-columns";
import { NewTenantDialog, TenantDeleteDialog } from "./tenant-dialogs";
import { TenantEditDialog, type TenantSection } from "./tenant-edit-dialog";
import { countOf, deleteRefusal, managesTenant, troubledTenants, type TenantListRow } from "./tenant-words";
import { TenantsStrip } from "./tenants-strip";

interface TenantsClientProps {
    rows: TenantListRow[];
    /** The tenant the viewer works in, which is neither opened again nor deleted from here. Null in All tenants. */
    activeTenantId: string | null;
    viewerId: string;
    /** May create, change and delete tenants and their members. Otherwise the page only shows them. */
    canManage: boolean;
    /**
     * The tenants the viewer looks after here, those their platform group reaches. A membership opens
     * a tenant but gives no right on the platform. Null or left out for every tenant listed.
     */
    managedIds?: readonly string[] | null;
    /** May create a tenant: a platform admin or a platform group of all tenants, the only ones who reach a new one. Follows `canManage` when left out. */
    canCreate?: boolean;
    /** A platform admin, who alone makes someone one and changes the memberships of a platform admin. */
    viewerPlatformAdmin: boolean;
    /** The platform group the viewer sees the tenants through, none for a platform admin. */
    through?: string | null;
    /** The column layout the viewer saved for the table. */
    initialLayout?: TablePreferences | null;
}

/** A tenant without connections, jobs or people, which Delete of several at once takes. */
const holdsNothing = (row: TenantListRow) => row.connections === 0 && row.jobs === 0 && row.members === 0;

/**
 * The tenants of this DBackup for whoever may see them: each with its members, connections,
 * databases and jobs, what other tenants share with it, its backups on demand and what it may add
 * itself. A click opens Edit with every setting of it, Open switches into it, and whoever may manage
 * them deletes one, or several empty ones at once. The home tenant holds what the platform owns and
 * stays. `?open=<id>` opens the members of a tenant, like after New tenant in the head of the sidebar.
 */
export function TenantsClient({ rows, activeTenantId, viewerId, canManage, managedIds = null, canCreate = canManage, viewerPlatformAdmin, through = null, initialLayout = null }: TenantsClientProps) {
    const router = useRouter();
    const openInTenant = useOpenInTenant();
    const layout = useTableLayout(TENANTS_TABLE_ID, initialLayout);
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<{ id: string; section: TenantSection } | null>(null);
    const [deleting, setDeleting] = useState<TenantListRow | null>(null);
    const [opening, setOpening] = useState<string | null>(null);

    const open = useCallback(async (row: TenantListRow) => {
        setOpening(row.id);
        try {
            await openInTenant(row.id, "/dashboard");
        } finally {
            setOpening(null);
        }
    }, [openInTenant]);

    // Edit, Delete and the members only where the viewer looks after the tenant, else the server refuses.
    const manages = useCallback((row: Pick<TenantListRow, "id">) => managesTenant(row, canManage, managedIds), [canManage, managedIds]);
    const handlers = useMemo<TenantHandlers>(() => ({
        onOpen: (row) => void open(row),
        onEdit: (row) => setEditing({ id: row.id, section: "general" }),
        canManage,
        ...(canManage ? { onDelete: setDeleting } : {}),
    }), [open, canManage]);
    const handlersOf = useCallback((row: TenantListRow): TenantHandlers => {
        if (manages(row)) return handlers;
        const { onDelete: _onDelete, ...rest } = handlers;
        return { ...rest, canManage: false };
    }, [handlers, manages]);

    // A link opens the members of a tenant, like the one after New tenant.
    useOpenFromLink(rows, (row) => setEditing({ id: row.id, section: "members" }));

    const columns = useMemo(() => tenantColumns(activeTenantId, handlers.onEdit, (row) => (
        <>
            {row.id !== activeTenantId && (
                <Button variant="outline" size="sm" onClick={() => handlers.onOpen(row)} disabled={opening !== null}>
                    {opening === row.id ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
                    Open
                </Button>
            )}
            <BackupRowMenu name={row.name} groups={tenantActions(row, activeTenantId, handlersOf(row))} />
        </>
    )), [activeTenantId, handlers, handlersOf, opening]);

    const managesAny = rows.some(manages);
    const bulkActions = useMemo<BulkAction<TenantListRow>[]>(() => managesAny ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "tenant" },
        icon: Trash,
        variant: "destructive",
        itemName: (row) => row.name,
        itemDetail: (row) => countOf(row.members, "member"),
        // Delete of one asks first what goes with it, which Delete of several cannot.
        ineligible: (row) => deleteRefusal(row, activeTenantId) ?? (holdsNothing(row) ? null : "Holds connections, jobs or people, delete it on its own"),
        confirm: {
            title: (picked) => `Delete ${countOf(picked.length, "tenant")}?`,
            description: () => "They hold no connections, jobs or people, so only their name, groups and templates go.",
            confirmLabel: "Delete",
        },
        run: (picked) => unwrapBulkAction(bulkDeleteTenants(picked.map((row) => row.id))),
    }] : [], [managesAny, activeTenantId]);

    const { failed, partial } = troubledTenants(rows);
    const attention = attentionOf("destructive", failed, "had a backup fail", "had a backup fail") ?? attentionOf("warning", partial, "missed a copy", "missed a copy");
    // The row of the dialog is read from the list each time, so it shows the tenant as saved.
    const edited = editing ? rows.find((row) => row.id === editing.id) ?? null : null;

    return (
        <div className="space-y-4 md:space-y-0">
            {/* One tab for the one list, so the row reads like the pages with several lists. */}
            <PageHead>
                <Tabs value="tenants" className="min-w-0 flex-1">
                    <PageTabs tabs={[{ value: "tenants", label: "Tenants", icon: Building2, attention }]} value="tenants" onValueChange={() => undefined} label="Tenant list" />
                </Tabs>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {canCreate ? (
                        <Button tone="create" onClick={() => setCreating(true)} aria-label="New tenant">
                            <Plus />
                            <span className="hidden sm:inline">New tenant</span>
                        </Button>
                    ) : canManage ? null : (
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Eye className="size-4" aria-hidden="true" />
                            {through ? `Read only, through ${through}` : "Read only"}
                        </span>
                    )}
                </div>
            </PageHead>

            <TenantsStrip rows={rows} />
            <DataTable
                joined
                columns={columns}
                data={rows}
                searchKey="name"
                searchPlaceholder="Search tenants"
                getRowId={(row) => row.id}
                enableRowSelection={managesAny}
                isRowSelectable={(row) => !row.isHome && row.id !== activeTenantId && manages(row)}
                bulkActions={bulkActions}
                onBulkActionComplete={() => router.refresh()}
                columnLayout={layout}
                onRowClick={handlers.onEdit}
                activeRowId={editing?.id ?? null}
                onRefresh={() => router.refresh()}
                renderRowMenu={(row, bulk) => (
                    <BackupContextMenu tile={<TenantTile home={row.isHome} logo={row.logo} />} title={row.name} note={tenantNote(row)} groups={tenantActions(row, activeTenantId, handlersOf(row))} bulk={bulk} />
                )}
            />

            {creating && (
                <NewTenantDialog
                    onClose={() => setCreating(false)}
                    onSaved={(tenant) => {
                        setCreating(false);
                        router.refresh();
                        // A new tenant has nobody in it yet, so its members come next.
                        setEditing({ id: tenant.id, section: "members" });
                    }}
                />
            )}
            {edited && editing && (
                <TenantEditDialog
                    key={edited.id}
                    tenant={edited}
                    section={editing.section}
                    viewerId={viewerId}
                    canManage={manages(edited)}
                    viewerPlatformAdmin={viewerPlatformAdmin}
                    onClose={() => setEditing(null)}
                    onChanged={() => router.refresh()}
                />
            )}
            {deleting && (
                <TenantDeleteDialog
                    tenant={deleting}
                    onClose={() => setDeleting(null)}
                    onDeleted={() => {
                        setDeleting(null);
                        router.refresh();
                    }}
                />
            )}
        </div>
    );
}
