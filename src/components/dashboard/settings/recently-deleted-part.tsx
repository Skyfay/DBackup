"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, ArrowRightLeft, Building2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { purgeDeletedAction, restoreDeletedAction } from "@/app/actions/settings/trash";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { useOpenInTenant, useTenantName } from "@/components/tenant/tenant-view";
import { reportRestore } from "@/components/trash/use-undo-delete";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import type { BulkResult } from "@/lib/core/bulk";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { TRASH_KINDS, type TrashKind, type TrashRestoreResult, type TrashRow } from "@/services/trash/trash-types";
import { PartFrame, useSettingsFrame } from "./settings-frame";
import { RestoreAsDialog } from "./trash-dialogs";
import { TRASH_KIND_INFO, TrashTile, trashActions, trashColumns, type TrashHandlers } from "./trash-columns";

const log = logger.child({ component: "recently-deleted-part" });

type KindFilter = "all" | TrashKind;

const ENTRY = { noun: "entry", nounPlural: "entries" };

/** The ids of a restore that did not come back, with why, for the failure list of a bulk action. */
function failuresOf(result: TrashRestoreResult, names: Map<string, string>): BulkResult["failed"] {
    return [
        ...result.conflicts.map((conflict) => ({ id: conflict.id, name: conflict.name, error: conflict.message })),
        ...result.failed.map((failure) => ({ id: failure.id, name: names.get(failure.id) ?? failure.name, error: failure.error })),
    ];
}

/** Where an entry is restored: Recently deleted of the tenant settings, in the tenant of the entry. */
const PART_HREF = "/dashboard/settings?part=recently-deleted";

/**
 * What was deleted lately, of the kinds the viewer may change: keys, saved logins, connections, jobs
 * and users, each until Data retention lets go of it. Someone who may change the tenant settings restores
 * one under its own name, and gives another one when someone took it meanwhile, or deletes it for
 * good. Someone who may only read the settings sees the list without its buttons. All tenants lists
 * the entries of every tenant with their tenant and opens that tenant for a restore, since an entry
 * comes back or goes for good in its own tenant.
 */
export function RecentlyDeletedPart({ rows, allTenants = false }: { rows: TrashRow[]; allTenants?: boolean }) {
    const router = useRouter();
    const frame = useSettingsFrame();
    const readOnly = frame.readOnly || allTenants;
    const tenantName = useTenantName();
    const openInTenant = useOpenInTenant();
    const [opening, setOpening] = useState<string | null>(null);
    const [filter, setFilter] = useState<KindFilter>("all");
    const [conflict, setConflict] = useState<{ row: TrashRow; reason: string } | null>(null);
    const [purging, setPurging] = useState<TrashRow | null>(null);
    const [pending, setPending] = useState(false);
    const names = useMemo(() => new Map(rows.map((row) => [row.id, row.name])), [rows]);

    const restore = useCallback(async (row: TrashRow, newName?: string): Promise<string | null> => {
        try {
            const result = await restoreDeletedAction([row.id], newName);
            if (!result.success) return result.error;
            const [clash] = result.data.conflicts;
            if (clash) {
                // A name picked in the dialog that is taken as well stays in the dialog.
                if (newName) return clash.message;
                setConflict({ row, reason: clash.message });
                return null;
            }
            reportRestore(result.data, names);
            setConflict(null);
            router.refresh();
            return null;
        } catch (error: unknown) {
            log.warn("Restoring a deleted record failed", { id: row.id }, wrapError(error));
            return "It could not be restored.";
        }
    }, [names, router]);

    const purge = async (row: TrashRow) => {
        setPending(true);
        try {
            const result = await purgeDeletedAction([row.id]);
            if (result.success) {
                toast.success(`${row.name} is gone for good`);
                router.refresh();
            } else {
                toast.error(result.error);
            }
        } catch (error: unknown) {
            log.warn("Deleting a record for good failed", { id: row.id }, wrapError(error));
            toast.error("It could not be deleted.");
        } finally {
            setPending(false);
            setPurging(null);
        }
    };

    const handlers = useMemo<TrashHandlers>(() => ({
        onRestore: (row) => void restore(row).then((refused) => refused && toast.error(refused)),
        onPurge: setPurging,
    }), [restore]);

    const openTenantOf = useCallback(async (row: TrashRow) => {
        setOpening(row.id);
        try {
            await openInTenant(row.tenantId, PART_HREF);
        } finally {
            setOpening(null);
        }
    }, [openInTenant]);

    const columns = useMemo(() => trashColumns(
        (row) => allTenants ? (
            <Button variant="outline" size="sm" onClick={() => void openTenantOf(row)} disabled={opening !== null} aria-label={`Open ${tenantName(row.tenantId) ?? "the tenant"} to restore ${row.name}`}>
                {opening === row.id ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
                Open tenant
            </Button>
        ) : readOnly ? null : (
            <>
                <Button variant="outline" size="sm" onClick={() => handlers.onRestore(row)}>
                    <ArchiveRestore />
                    Restore
                </Button>
                <BackupRowMenu name={row.name} groups={trashActions(row, handlers)} />
            </>
        ),
        allTenants ? (row) => tenantName(row.tenantId) : undefined
    ), [allTenants, handlers, opening, openTenantOf, readOnly, tenantName]);

    const bulkActions = useMemo<BulkAction<TrashRow>[]>(() => readOnly ? [] : [
        {
            id: "restore",
            labels: { verb: "restore", verbPast: "restored", ...ENTRY },
            icon: ArchiveRestore,
            tone: "create",
            itemName: (row) => row.name,
            itemDetail: (row) => TRASH_KIND_INFO[row.kind].label,
            run: async (selected) => {
                const result = await restoreDeletedAction(selected.map((row) => row.id));
                if (!result.success) throw new Error(result.error);
                // What changed on the way, like a job that stays paused, is told apart from the count.
                const notes = result.data.restored.flatMap((entry) => entry.notes.map((note) => `${entry.name}: ${note}`));
                if (notes.length > 0) toast.warning("Some came back changed", { description: notes.join(" ") });
                return { succeeded: result.data.restored.map((entry) => entry.id), failed: failuresOf(result.data, names) };
            },
        },
        {
            id: "purge",
            labels: { verb: "delete", verbPast: "deleted", ...ENTRY },
            label: () => "Delete permanently",
            icon: Trash2,
            variant: "destructive",
            itemName: (row) => row.name,
            itemDetail: (row) => TRASH_KIND_INFO[row.kind].label,
            confirm: {
                title: (selected) => `Delete ${selected.length === 1 ? "1 entry" : `${selected.length} entries`} permanently?`,
                description: () => "They skip the rest of their time in Recently deleted. DBackup keeps no copy of them anywhere.",
                confirmLabel: "Delete",
            },
            run: async (selected) => {
                const result = await purgeDeletedAction(selected.map((row) => row.id));
                if (!result.success) throw new Error(result.error);
                const gone = new Set(result.data.purged);
                return {
                    succeeded: result.data.purged,
                    failed: selected.filter((row) => !gone.has(row.id)).map((row) => ({ id: row.id, name: row.name, error: "It is not in Recently deleted any more." })),
                };
            },
        },
    ], [names, readOnly]);

    const shown = useMemo(() => (filter === "all" ? rows : rows.filter((row) => row.kind === filter)), [rows, filter]);
    const kinds = TRASH_KINDS.filter((kind) => rows.some((row) => row.kind === kind) || filter === kind);

    return (
        <PartFrame part="recently-deleted" flush>
            {allTenants && rows.length > 0 && (
                <p className="flex items-start gap-2 border-b px-4 py-3 text-sm text-muted-foreground md:px-6">
                    <Building2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    All tenants lists what was deleted in every tenant. Open the tenant of an entry to restore it or delete it for good.
                </p>
            )}
            {rows.length === 0 ? (
                <div className="m-4 flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center md:m-6">
                    <ArchiveRestore className="size-6 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium">Nothing was deleted lately</p>
                    <p className="max-w-sm text-sm text-muted-foreground">A deleted key, saved login, connection, job or user waits here until Data retention lets go of it.</p>
                </div>
            ) : (
                <DataTable
                    frameless
                    columns={columns}
                    data={shown}
                    searchKey="name"
                    searchPlaceholder="Search deleted items"
                    getRowId={(row) => row.id}
                    enableRowSelection={!readOnly}
                    bulkActions={bulkActions}
                    onBulkActionComplete={() => router.refresh()}
                    toolbarExtra={
                        <QuickFilter
                            value={filter}
                            onChange={setFilter}
                            aria-label="Show the kinds"
                            options={[
                                { value: "all", label: "All", count: rows.length },
                                ...kinds.map((kind) => ({ value: kind, label: TRASH_KIND_INFO[kind].plural, count: rows.filter((row) => row.kind === kind).length })),
                            ]}
                        />
                    }
                    renderRowMenu={readOnly ? undefined : (row, bulk) => (
                        <BackupContextMenu tile={<TrashTile kind={row.kind} />} title={row.name} note={TRASH_KIND_INFO[row.kind].label} groups={trashActions(row, handlers)} bulk={bulk} />
                    )}
                />
            )}
            <p className="px-4 py-4 text-xs text-muted-foreground md:px-6">
                Only the kinds you may change show here: keys with the right to change the Vault, saved logins with the right to delete them, users with the right to change users, and so on. Restoring and deleting for good need the right to change the tenant settings as well.
            </p>

            {conflict && (
                <RestoreAsDialog row={conflict.row} reason={conflict.reason} onRestore={(name) => restore(conflict.row, name)} onClose={() => setConflict(null)} />
            )}
            {purging && (
                <ConfirmDialog
                    open
                    onOpenChange={(open) => !open && setPurging(null)}
                    icon={Trash2}
                    destructive
                    title={`Delete ${purging.name} permanently?`}
                    note="Cannot be undone"
                    description="It skips the rest of its time in Recently deleted. DBackup keeps no copy of it anywhere."
                    confirmLabel="Delete permanently"
                    isPending={pending}
                    onConfirm={() => void purge(purging)}
                >
                    <DialogItemList items={[{ name: purging.name, detail: TRASH_KIND_INFO[purging.kind].label, icon: TRASH_KIND_INFO[purging.kind].icon }]} />
                </ConfirmDialog>
            )}
        </PartFrame>
    );
}
