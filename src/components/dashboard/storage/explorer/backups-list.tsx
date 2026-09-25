"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnFiltersState, OnChangeFn, SortingState } from "@tanstack/react-table";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { DataTable, type BulkAction, type DataTableFilterableColumn } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import type { ColumnLayoutOption } from "@/components/ui/use-column-layout";
import type { BulkResult } from "@/lib/core/bulk";
import type { ViewMode } from "@/lib/core/table-preferences";
import { formatBytes } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerFile, ExplorerJob, ExplorerJobKind } from "@/services/storage/explorer-types";
import { backupActions, type BackupActionHandlers } from "./backup-actions";
import { BackupCard } from "./backup-card";
import { backupColumns } from "./backup-columns";
import { countBackups, filterBackups, isLocked, primaryCopy, runKey, summarize, targetsOf, type BackupQuick } from "./backup-filters";
import { BackupContextMenu, BackupRowMenu } from "./backup-menus";
import { DestinationTile, JobTile } from "./explorer-cells";
import { count, typeLabel } from "./explorer-format";
import { ExplorerStrip } from "./explorer-strip";
import { bulkAcross, type BackupTarget } from "./use-backup-actions";

/** The job and destination filters, which live in the address. */
export interface BackupScope {
    jobs: string[];
    at: string[];
}

interface BackupsListProps {
    runs: BackupRun[];
    /** Every job of the index, in its order: jobs, deleted jobs, then the rest. */
    jobs: ExplorerJob[];
    jobsByKey: Map<string, ExplorerJob>;
    destinations: ExplorerDestination[];
    destinationsById: Map<string, ExplorerDestination>;
    scope: BackupScope;
    onScope: (next: BackupScope) => void;
    view: ViewMode;
    columnLayout: ColumnLayoutOption;
    canDelete: boolean;
    handlersFor: (file: ExplorerFile, destinationId: string) => BackupActionHandlers;
    askDelete: (targets: BackupTarget[], title?: string) => void;
    onOpen: (run: BackupRun) => void;
    onRefresh: () => void;
    refreshing: boolean;
    onChanged: () => void;
}

const GROUPS: Record<ExplorerJobKind, string> = { job: "Jobs", deleted: "Deleted jobs", system: "Not from a job", none: "Not from a job" };

/** Turns the results per copy into results per backup, which is what the list selected. */
function perRun(result: BulkResult, runs: BackupRun[], at: string[]): BulkResult {
    const failedIds = new Map(result.failed.map((failure) => [failure.id, failure]));
    const merged: BulkResult = { succeeded: [], failed: [] };
    for (const run of runs) {
        const ids = targetsOf(run, at).map((target) => `${target.destinationId}:${target.file.path}`);
        const failure = ids.map((id) => failedIds.get(id)).find((entry) => entry !== undefined);
        if (failure) merged.failed.push({ id: runKey(run), name: run.file.name, error: failure.error });
        else merged.succeeded.push(runKey(run));
    }
    return merged;
}

/**
 * Every backup of every job in one list. The job and the destination are filters of it like on
 * the other pages, and a filter by destination also decides which copies the numbers, the quick
 * filters and the actions count.
 */
export function BackupsList({
    runs,
    jobs,
    jobsByKey,
    destinations,
    destinationsById,
    scope,
    onScope,
    view,
    columnLayout,
    canDelete,
    handlersFor,
    askDelete,
    onOpen,
    onRefresh,
    refreshing,
    onChanged,
}: BackupsListProps) {
    const [quick, setQuick] = useState<BackupQuick>("all");
    const [search, setSearch] = useState("");
    const [sorting, setSorting] = useState<SortingState>([{ id: "backup", desc: true }]);
    const { at } = scope;

    const filters = useMemo(() => ({ jobs: scope.jobs, at, search, quick }), [scope.jobs, at, search, quick]);
    const destinationIds = useMemo(() => destinations.map((destination) => destination.id), [destinations]);
    const visible = useMemo(() => filterBackups(runs, filters, jobsByKey), [runs, filters, jobsByKey]);
    const counts = useMemo(() => countBackups(runs, filters, jobsByKey, destinationIds), [runs, filters, jobsByKey, destinationIds]);
    const summary = useMemo(() => summarize(visible, at, jobsByKey), [visible, at, jobsByKey]);

    // The table keeps its own search box and filter buttons, but what they leave is worked out
    // here, so the list, the counts and the numbers agree.
    const columnFilters = useMemo<ColumnFiltersState>(() => [
        ...(scope.jobs.length > 0 ? [{ id: "job", value: scope.jobs }] : []),
        ...(at.length > 0 ? [{ id: "at", value: at }] : []),
        ...(search ? [{ id: "backup", value: search }] : []),
    ], [scope.jobs, at, search]);
    const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
        const next = typeof updater === "function" ? updater(columnFilters) : updater;
        const valueOf = (id: string) => next.find((entry) => entry.id === id)?.value;
        setSearch((valueOf("backup") as string | undefined) ?? "");
        const nextJobs = (valueOf("job") as string[] | undefined) ?? [];
        const nextAt = (valueOf("at") as string[] | undefined) ?? [];
        if (nextJobs.join("\n") !== scope.jobs.join("\n") || nextAt.join("\n") !== at.join("\n")) onScope({ jobs: nextJobs, at: nextAt });
    };

    const scopeName = at.map((id) => destinationsById.get(id)?.name ?? "a removed destination").join(", ");

    const deleteRun = useCallback((run: BackupRun) => {
        const targets = targetsOf(run, at);
        askDelete(targets, targets.length > 1 ? `Delete this backup at ${targets.length} destinations?` : "Delete this backup?");
    }, [askDelete, at]);

    const groupsFor = useCallback((run: BackupRun) => {
        const target = primaryCopy(run, at);
        const handlers = handlersFor(target.file, target.destinationId);
        return backupActions(target.file, { ...handlers, onDelete: handlers.onDelete ? () => deleteRun(run) : undefined });
    }, [at, handlersFor, deleteRun]);

    const renderActions = useCallback((run: BackupRun) => <BackupRowMenu name={run.file.name} groups={groupsFor(run)} />, [groupsFor]);

    const columns = useMemo(
        () => backupColumns({ jobs: jobsByKey, destinations: destinationsById, at, onOpen, renderActions }),
        [jobsByKey, destinationsById, at, onOpen, renderActions]
    );

    const bulkActions = useMemo<BulkAction<BackupRun>[]>(() => {
        if (!canDelete) return [];
        const run = (action: "delete" | "lock" | "unlock") => async (rows: BackupRun[]) =>
            perRun(await bulkAcross(action, rows.flatMap((row) => targetsOf(row, at))), rows, at);
        const unreachable = (row: BackupRun) => (targetsOf(row, at).length === 0 ? "No copy of it there" : null);
        return [
            {
                id: "lock",
                labels: { verb: "lock", verbPast: "locked", noun: "backup" },
                icon: Lock,
                isAvailable: (rows) => rows.some((row) => !isLocked(row, at)),
                itemName: (row) => row.file.name,
                ineligible: (row) => unreachable(row) ?? (isLocked(row, at) ? "Already locked" : null),
                run: run("lock"),
            },
            {
                id: "unlock",
                labels: { verb: "unlock", verbPast: "unlocked", noun: "backup" },
                icon: LockOpen,
                isAvailable: (rows) => rows.some((row) => isLocked(row, at)),
                itemName: (row) => row.file.name,
                ineligible: (row) => unreachable(row) ?? (isLocked(row, at) ? null : "Not locked"),
                run: run("unlock"),
            },
            {
                id: "delete",
                labels: { verb: "delete", verbPast: "deleted", noun: "backup" },
                icon: Trash2,
                variant: "destructive",
                itemName: (row) => row.file.name,
                itemDetail: (row) => count(targetsOf(row, at).length, "copy", "copies"),
                // A locked backup was protected on purpose. The server refuses it as well.
                ineligible: (row) => unreachable(row) ?? (isLocked(row, at) ? "Locked, unlock it first" : null),
                confirm: {
                    title: (rows) => `Delete ${rows.length} backup${rows.length === 1 ? "" : "s"}?`,
                    description: () => (at.length > 0 ? `This removes them from ${scopeName}.` : "This removes every copy of them, at every destination of their job."),
                    confirmLabel: "Delete",
                },
                run: run("delete"),
            },
        ];
    }, [canDelete, at, scopeName]);

    const filterableColumns = useMemo<DataTableFilterableColumn<BackupRun>[]>(() => [
        {
            id: "job",
            title: "Job",
            contentClassName: "w-80",
            options: jobs.map((job) => ({
                value: job.key,
                label: job.name,
                group: GROUPS[job.kind],
                lead: <JobTile job={job} size="sm" />,
                count: counts.jobs.get(job.key) ?? 0,
            })),
        },
        {
            id: "at",
            title: "Destination",
            contentClassName: "w-72",
            options: destinations.map((destination) => ({
                value: destination.id,
                label: destination.name,
                lead: <DestinationTile destination={destination} size="sm" />,
                count: counts.at.get(destination.id) ?? 0,
            })),
        },
    ], [jobs, destinations, counts]);

    const [storedValue, storedUnit] = formatBytes(summary.stored, 1).split(" ");
    const newestJob = summary.newest ? jobsByKey.get(summary.newest.jobKey) : undefined;

    return (
        <div className="space-y-4 md:space-y-6">
            <ExplorerStrip
                cells={[
                    {
                        label: "Backups",
                        value: summary.runs.toLocaleString(),
                        extra: `from ${count(summary.jobs, "job")}${summary.deletedJobs > 0 ? ` and ${count(summary.deletedJobs, "deleted job")}` : ""}`,
                    },
                    {
                        label: "Stored",
                        value: storedValue,
                        unit: storedUnit,
                        extra: at.length === 1 ? `at ${scopeName}` : `at ${count(summary.destinations, "destination")}`,
                    },
                    {
                        label: "Newest",
                        value: summary.newest ? <RelativeTime date={summary.newest.createdAt} /> : "-",
                        extra: newestJob ? `${newestJob.name} · ${typeLabel(summary.newest!.file)}` : undefined,
                    },
                    {
                        label: "Copies",
                        value: (summary.copies - summary.missing).toLocaleString(),
                        unit: `of ${summary.copies.toLocaleString()}`,
                        tone: summary.missing > 0 ? "warning" : undefined,
                        extra: summary.missing > 0 ? `${count(summary.missing, "copy", "copies")} missing` : "none missing",
                    },
                    {
                        label: "Integrity",
                        value: summary.failed > 0 ? summary.failed.toLocaleString() : summary.verified.toLocaleString(),
                        unit: summary.failed > 0 ? "failed" : `of ${summary.runs.toLocaleString()} verified`,
                        tone: summary.failed > 0 ? "destructive" : undefined,
                        extra: summary.failed > 0 ? `${summary.verified.toLocaleString()} verified` : summary.locked > 0 ? `${summary.locked.toLocaleString()} locked` : undefined,
                    },
                ]}
            />

            <DataTable
                variant="card"
                columns={columns}
                data={visible}
                searchKey="backup"
                searchPlaceholder="Search backups"
                filterableColumns={filterableColumns}
                manualFiltering
                columnFilters={columnFilters}
                onColumnFiltersChange={onColumnFiltersChange}
                toolbarExtra={
                    <QuickFilter<BackupQuick>
                        aria-label="Show"
                        value={quick}
                        onChange={setQuick}
                        options={[
                            { value: "all", label: "All", count: counts.quick.all },
                            { value: "missing", label: "Copy missing", count: counts.quick.missing, dot: "bg-warning" },
                            { value: "failed", label: "Check failed", count: counts.quick.failed, dot: "bg-destructive" },
                            { value: "locked", label: "Locked", count: counts.quick.locked },
                            ...(counts.quick.deleted > 0 || quick === "deleted" ? [{ value: "deleted" as const, label: "Job deleted", count: counts.quick.deleted }] : []),
                        ]}
                    />
                }
                sorting={sorting}
                onSortingChange={setSorting}
                onRefresh={onRefresh}
                isLoading={refreshing}
                // Selecting for actions on many is a table thing. Cards keep to one backup at a time.
                enableRowSelection={canDelete && view === "table"}
                getRowId={runKey}
                bulkActions={bulkActions}
                onBulkActionComplete={onChanged}
                columnLayout={columnLayout}
                initialPageSize={20}
                onRowClick={onOpen}
                view={view}
                renderCard={(row) => (
                    <BackupCard
                        run={row.original}
                        job={jobsByKey.get(row.original.jobKey)}
                        destinations={destinationsById}
                        at={at}
                        onOpen={onOpen}
                        actions={renderActions(row.original)}
                    />
                )}
                renderRowMenu={(run, bulk) => {
                    const job = jobsByKey.get(run.jobKey);
                    return (
                        <BackupContextMenu
                            tile={job ? <JobTile job={job} /> : null}
                            title={run.file.name}
                            note={`${job?.name ?? "Without a job"} · ${typeLabel(run.file)}`}
                            groups={groupsFor(run)}
                            bulk={bulk}
                        />
                    );
                }}
            />
        </div>
    );
}
