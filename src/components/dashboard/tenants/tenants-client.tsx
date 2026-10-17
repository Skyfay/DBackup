"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Building2, Eye, Loader2, Plus } from "lucide-react";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { useOpenInTenant } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs } from "@/components/ui/tabs";
import { useOpenFromLink } from "@/hooks/use-open-from-link";
import { attentionOf } from "@/lib/core/tab-attention";
import { TenantAllowancesDialog } from "./tenant-allowances-dialog";
import { TenantTile, tenantActions, tenantColumns, tenantNote, type TenantHandlers } from "./tenant-columns";
import { TenantDeleteDialog, TenantNameDialog, TenantSharingDialog } from "./tenant-dialogs";
import { TenantMembersDialog } from "./tenant-members-dialog";
import { troubledTenants, type TenantListRow } from "./tenant-words";
import { TenantsStrip } from "./tenants-strip";

interface TenantsClientProps {
    rows: TenantListRow[];
    /** The tenant the viewer works in, which is neither opened again nor deleted from here. Null in All tenants. */
    activeTenantId: string | null;
    viewerId: string;
    /** May create, rename and delete tenants and change their members. Otherwise the page only shows them. */
    canManage: boolean;
    /** A platform admin, who alone makes someone one and changes the memberships of a platform admin. */
    viewerPlatformAdmin: boolean;
    /** The platform group the viewer sees the tenants through, none for a platform admin. */
    through?: string | null;
}

/**
 * The tenants of this DBackup for whoever may see them: each with its members, connections,
 * databases and jobs, what other tenants share with it and what it may add itself, its members
 * opened with a click, opened, and for whoever may manage them renamed, limited in what it adds or
 * deleted with everything it holds. The home tenant holds what the platform owns and
 * stays. `?open=<id>` opens the members of a tenant, like after New tenant in the head of the sidebar.
 */
export function TenantsClient({ rows, activeTenantId, viewerId, canManage, viewerPlatformAdmin, through = null }: TenantsClientProps) {
    const router = useRouter();
    const openInTenant = useOpenInTenant();
    const [naming, setNaming] = useState<{ tenant: TenantListRow | null } | null>(null);
    const [members, setMembers] = useState<{ id: string; name: string } | null>(null);
    const [deleting, setDeleting] = useState<TenantListRow | null>(null);
    const [sharing, setSharing] = useState<TenantListRow | null>(null);
    const [allowing, setAllowing] = useState<TenantListRow | null>(null);
    const [opening, setOpening] = useState<string | null>(null);

    const open = useCallback(async (row: TenantListRow) => {
        setOpening(row.id);
        try {
            await openInTenant(row.id, "/dashboard");
        } finally {
            setOpening(null);
        }
    }, [openInTenant]);

    const handlers = useMemo<TenantHandlers>(() => ({
        onOpen: (row) => void open(row),
        onMembers: (row) => setMembers({ id: row.id, name: row.name }),
        ...(canManage ? { onRename: (row: TenantListRow) => setNaming({ tenant: row }), onDelete: setDeleting, onSharing: setSharing, onAllowances: setAllowing } : {}),
    }), [open, canManage]);

    useOpenFromLink(rows, handlers.onMembers);

    const columns = useMemo(() => tenantColumns(activeTenantId, handlers.onMembers, (row) => (
        <>
            {row.id !== activeTenantId && (
                <Button variant="outline" size="sm" onClick={() => handlers.onOpen(row)} disabled={opening !== null}>
                    {opening === row.id ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
                    Open
                </Button>
            )}
            <BackupRowMenu name={row.name} groups={tenantActions(row, activeTenantId, handlers)} />
        </>
    )), [activeTenantId, handlers, opening]);

    const { failed, partial } = troubledTenants(rows);
    const attention = attentionOf("destructive", failed, "had a backup fail", "had a backup fail") ?? attentionOf("warning", partial, "missed a copy", "missed a copy");

    return (
        <div className="space-y-4 md:space-y-0">
            {/* One tab for the one list, so the row reads like the pages with several lists. */}
            <PageHead>
                <Tabs value="tenants" className="min-w-0 flex-1">
                    <PageTabs tabs={[{ value: "tenants", label: "Tenants", icon: Building2, attention }]} value="tenants" onValueChange={() => undefined} label="Tenant list" />
                </Tabs>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {canManage ? (
                        <Button tone="create" onClick={() => setNaming({ tenant: null })} aria-label="New tenant">
                            <Plus />
                            <span className="hidden sm:inline">New tenant</span>
                        </Button>
                    ) : (
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
                onRowClick={handlers.onMembers}
                activeRowId={members?.id ?? null}
                onRefresh={() => router.refresh()}
                renderRowMenu={(row, bulk) => (
                    <BackupContextMenu tile={<TenantTile home={row.isHome} logo={row.logo} />} title={row.name} note={tenantNote(row)} groups={tenantActions(row, activeTenantId, handlers)} bulk={bulk} />
                )}
            />
            <div className="space-y-1.5 text-xs text-muted-foreground md:mt-4">
                <p>A tenant is a customer of this DBackup. Its connections, jobs, backups, keys and logs belong to it alone, and its people see nothing of the other tenants.</p>
                <p>
                    {canManage
                        ? "Platform admins open every tenant, member or not, and manage the tenants here. The menu of a member under Members makes them one."
                        : "Creating, renaming and the members of a tenant need a platform group that may change tenants."}
                </p>
            </div>

            {naming && (
                <TenantNameDialog
                    tenant={naming.tenant}
                    onClose={() => setNaming(null)}
                    onSaved={(tenant) => {
                        setNaming(null);
                        router.refresh();
                        // A new tenant has nobody in it yet, so its members come next.
                        if (!naming.tenant) setMembers(tenant);
                    }}
                />
            )}
            {members && (
                <TenantMembersDialog key={members.id} tenant={members} viewerId={viewerId} canManage={canManage} viewerPlatformAdmin={viewerPlatformAdmin} onClose={() => setMembers(null)} onChanged={() => router.refresh()} />
            )}
            {sharing && (
                <TenantSharingDialog
                    tenant={sharing}
                    onClose={() => setSharing(null)}
                    onChanged={() => {
                        setSharing(null);
                        router.refresh();
                    }}
                />
            )}
            {allowing && (
                <TenantAllowancesDialog
                    tenant={allowing}
                    onClose={() => setAllowing(null)}
                    onSaved={() => {
                        setAllowing(null);
                        router.refresh();
                    }}
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
