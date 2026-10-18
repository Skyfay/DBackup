"use client";

import { useMemo, useState } from "react";
import { Building2, Database, Info, Undo2 } from "lucide-react";
import { assignDatabases } from "@/app/actions/tenant/database-assignments";
import { BackupContextMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import type { BulkResult } from "@/lib/core/bulk";
import type { DatabaseOwnerRow, SourceAssignments } from "@/services/tenant/database-assignments";
import { assignmentActions, assignmentColumns, assignmentFilters } from "./assignment-columns";
import { GiveDialog } from "./assignment-give-dialog";
import { countOf, matchesQuick, quickCounts, type Quick } from "./assignment-model";
import { MoveDialog } from "./assignment-move-dialog";
import { OnDemandDialog } from "./assignment-on-demand-dialog";
import type { OwnerChange } from "./assignment-picker";
import { ownerLock } from "./assignment-reach";

interface AssignmentTableProps {
    serverId: string;
    serverName: string;
    /** The tenant of the server. */
    tenantName: string;
    data: SourceAssignments;
    canAssign: boolean;
    now: Date;
    /** Saves the change of one row, true once it went through. */
    onChange: (changes: OwnerChange[]) => Promise<boolean>;
    /** Shows who held a database in the timeline. */
    onHistory: (name: string) => void;
    onReload: () => void;
}

/** Sends many changes at once, reported row by row like every bulk action. */
async function sendMany(serverId: string, changes: OwnerChange[]): Promise<BulkResult> {
    const result = await assignDatabases(serverId, changes);
    if (result.success) return { succeeded: changes.map((change) => change.databaseName), failed: [] };
    return { succeeded: [], failed: changes.map((change) => ({ id: change.databaseName, error: result.error })) };
}

/**
 * The databases of the server with the tenant that sees each one, picked right in its row, how it
 * holds it and how many backups the destinations keep of it. Several picked at once go to one
 * tenant through Give to tenant, or back to nobody else through Take back.
 */
export function AssignmentTable({ serverId, serverName, tenantName, data, canAssign, now, onChange, onHistory, onReload }: AssignmentTableProps) {
    const [quick, setQuick] = useState<Quick>("all");
    const [moving, setMoving] = useState<DatabaseOwnerRow | null>(null);
    const [onDemand, setOnDemand] = useState<DatabaseOwnerRow | null>(null);
    const counts = quickCounts(data.databases);
    const rows = useMemo(() => data.databases.filter((row) => matchesQuick(row, quick)), [data.databases, quick]);
    const columns = useMemo(
        () => assignmentColumns({ data, tenantName, canAssign, onChange, onHistory, onMove: setMoving, onOnDemand: setOnDemand, now }),
        [data, tenantName, canAssign, onChange, onHistory, now]
    );
    const filters = useMemo(() => assignmentFilters(data), [data]);

    const bulkActions = useMemo<BulkAction<DatabaseOwnerRow>[]>(() => [
        {
            id: "give",
            labels: { verb: "give", verbPast: "given to a tenant", noun: "database" },
            label: () => "Give to tenant",
            icon: Building2,
            tone: "pick",
            itemName: (row) => row.name,
            ineligible: (row) => ownerLock(row, data),
            dialog: ({ rows: picked, onClose, onDone }) => (
                <GiveDialog
                    rows={picked}
                    data={data}
                    serverName={serverName}
                    tenantName={tenantName}
                    onClose={onClose}
                    onGive={async (changes) => {
                        const result = await sendMany(serverId, changes);
                        onDone(result);
                        return result.succeeded.length > 0;
                    }}
                />
            ),
        },
        {
            id: "take-back",
            labels: { verb: "take back", verbPast: "taken back", noun: "database" },
            label: () => "Take back",
            icon: Undo2,
            itemName: (row) => row.name,
            ineligible: (row) => ownerLock(row, data) ?? (row.owner?.via === "assignment" ? null : row.owner ? "A rule gives it. Remove the rule to take it back." : "Nobody else has it."),
            confirm: {
                title: (picked) => `Take back ${countOf(picked.length, "database")}?`,
                description: () => `From now on only ${tenantName} sees them. The tenants keep their backups of before.`,
                confirmLabel: "Take back",
            },
            run: (picked) => sendMany(serverId, picked.map((row) => ({ databaseName: row.name, tenantId: null }))),
        },
    ], [data, serverId, serverName, tenantName]);

    return (
        <section aria-label="Databases and tenants" className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
            <div className="px-5 pt-4 pb-3">
                <h3 className="font-semibold">Databases and tenants</h3>
                <p className="text-sm text-muted-foreground">Who sees the backups of each database. A tenant sees its own from the start on, nothing else of this server.</p>
            </div>
            {data.databases.length === 0 ? (
                <p className="border-t px-5 py-6 text-sm text-muted-foreground">DBackup has not read the databases of {serverName} yet. They show here once the server answered a check.</p>
            ) : (
                <div className="border-t">
                    <DataTable
                        frameless
                        columns={columns}
                        data={rows}
                        searchKey="name"
                        searchPlaceholder="Search databases"
                        filterableColumns={filters}
                        toolbarExtra={
                            <QuickFilter
                                aria-label="Show"
                                value={quick}
                                onChange={setQuick}
                                options={[
                                    { value: "all", label: "All", count: counts.all },
                                    { value: "given", label: "Given", count: counts.given },
                                    { value: "nobody", label: "Only yours", count: counts.nobody },
                                ]}
                            />
                        }
                        enableRowSelection={canAssign && data.customers.length > 0}
                        getRowId={(row) => row.name}
                        bulkActions={bulkActions}
                        onBulkActionComplete={onReload}
                        onRefresh={onReload}
                        autoResetPageIndex={false}
                        renderRowMenu={(row, bulk) => (
                            <BackupContextMenu
                                tile={<span className="flex size-7 items-center justify-center rounded-md border bg-muted/50"><Database className="size-3.5 text-muted-foreground" aria-hidden="true" /></span>}
                                title={row.name}
                                note={row.owner ? `${row.owner.tenantName} · ${row.owner.via === "assignment" ? "by name" : "by a rule"}` : `Only ${tenantName}`}
                                groups={assignmentActions(row, { canAssign, data, onChange, onHistory, onMove: setMoving, onOnDemand: setOnDemand })}
                                bulk={bulk}
                            />
                        )}
                    />
                </div>
            )}
            <p className="flex items-start gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                A change ends the time of the tenant before, which keeps the backups of its time.
            </p>
            {moving?.owner && (
                <MoveDialog
                    serverId={serverId}
                    serverName={serverName}
                    row={{ ...moving, owner: moving.owner }}
                    onClose={() => setMoving(null)}
                    onMoved={() => {
                        setMoving(null);
                        onReload();
                    }}
                />
            )}
            {onDemand?.owner && (
                <OnDemandDialog
                    serverId={serverId}
                    serverName={serverName}
                    target={{ kind: "database", name: onDemand.name, tenantName: onDemand.owner.tenantName, perDay: onDemand.owner.onDemandPerDay, tenantPerDay: onDemand.owner.tenantOnDemand }}
                    onClose={() => setOnDemand(null)}
                    onSaved={() => {
                        setOnDemand(null);
                        onReload();
                    }}
                />
            )}
        </section>
    );
}
