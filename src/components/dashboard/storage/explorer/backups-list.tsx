"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnFiltersState, OnChangeFn, SortingState } from "@tanstack/react-table";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { DataTable, type BulkAction, type DataTableFilterableColumn } from "@/components/ui/data-table";
import type { ColumnLayoutOption } from "@/components/ui/use-column-layout";
import type { BulkResult } from "@/lib/core/bulk";
import { listView, type ViewMode } from "@/lib/core/table-preferences";
import { formatBytes } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerFile, ExplorerJob, ExplorerPlan } from "@/services/storage/explorer-types";
import { backupActions, type BackupActionHandlers } from "./backup-actions";
import { BackupCard } from "./backup-card";
import { backupColumns } from "./backup-columns";
import { backupFilterColumns } from "./backup-filter-columns";
import { byAnswer, countBackups, filterBackups, isLocked, lookupOf, primaryCopy, runKey, startedByOptions, summarize, targetsOf, type BackupState } from "./backup-filters";
import { BackupContextMenu, BackupRowMenu } from "./backup-menus";
import { AnswerLegend, JobTile } from "./explorer-cells";
import { count, typeLabel } from "./explorer-format";
import { ExplorerStrip } from "./explorer-strip";
import { useTimelineList } from "./timeline-list";
import { bulkAcross, type BackupTarget } from "./use-backup-actions";

/** The filters by job, destination and who started a run, which live in the address. */
export interface BackupScope {
    jobs: string[];
    at: string[];
    by: string[];
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
    /** What the schedules plan and missed, for the timeline view. Null while it loads or in another view. */
    plan: ExplorerPlan | null;
    columnLayout: ColumnLayoutOption;
    canDelete: boolean;
    handlersFor: (file: ExplorerFile, destinationId: string) => BackupActionHandlers;
    askDelete: (targets: BackupTarget[], title?: string) => void;
    onOpen: (run: BackupRun) => void;
    onRefresh: () => void;
    refreshing: boolean;
    onChanged: () => void;
}

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
 * the other pages, and a filter by destination also decides which copies the numbers, the states
 * and the actions count.
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
    plan,
    columnLayout,
    canDelete,
    handlersFor,
    askDelete,
    onOpen,
    onRefresh,
    refreshing,
    onChanged,
}: BackupsListProps) {
    const [states, setStates] = useState<BackupState[]>([]);
    const [search, setSearch] = useState("");
    const [sorting, setSorting] = useState<SortingState>([{ id: "backup", desc: true }]);
    const { at } = scope;

    const filters = useMemo(() => ({ jobs: scope.jobs, at, by: scope.by, search, states }), [scope.jobs, at, scope.by, search, states]);
    const destinationIds = useMemo(() => destinations.map((destination) => destination.id), [destinations]);
    const lookup = useMemo(() => lookupOf(jobsByKey, destinations), [jobsByKey, destinations]);
    const visible = useMemo(() => filterBackups(runs, filters, lookup), [runs, filters, lookup]);
    const counts = useMemo(() => countBackups(runs, filters, lookup, destinationIds), [runs, filters, lookup, destinationIds]);
    const summary = useMemo(() => summarize(visible, at, jobsByKey), [visible, at, jobsByKey]);
    const timeline = useTimelineList({
        on: view === "timeline",
        runs: visible,
        jobs,
        jobsByKey,
        scopeJobs: scope.jobs,
        narrowed: at.length > 0 || scope.by.length > 0 || states.length > 0 || search.trim() !== "",
        plan,
        destinations: destinationsById,
        at,
    });

    // The table keeps its own search box and filter buttons, but what they leave is worked out
    // here, so the list, the counts and the numbers agree.
    const columnFilters = useMemo<ColumnFiltersState>(() => [
        ...(scope.jobs.length > 0 ? [{ id: "job", value: scope.jobs }] : []),
        ...(at.length > 0 ? [{ id: "at", value: at }] : []),
        ...(scope.by.length > 0 ? [{ id: "startedBy", value: scope.by }] : []),
        ...(states.length > 0 ? [{ id: "state", value: states }] : []),
        ...(search ? [{ id: "backup", value: search }] : []),
    ], [scope.jobs, at, scope.by, states, search]);
    const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
        const next = typeof updater === "function" ? updater(columnFilters) : updater;
        const valueOf = (id: string) => next.find((entry) => entry.id === id)?.value;
        setSearch((valueOf("backup") as string | undefined) ?? "");
        setStates((valueOf("state") as BackupState[] | undefined) ?? []);
        const nextScope = {
            jobs: (valueOf("job") as string[] | undefined) ?? [],
            at: (valueOf("at") as string[] | undefined) ?? [],
            by: (valueOf("startedBy") as string[] | undefined) ?? [],
        };
        const same = (a: string[], b: string[]) => a.join("\n") === b.join("\n");
        if (!same(nextScope.jobs, scope.jobs) || !same(nextScope.at, at) || !same(nextScope.by, scope.by)) onScope(nextScope);
    };

    const scopeName = at.map((id) => destinationsById.get(id)?.name ?? "a removed destination").join(", ");

    const deleteRun = useCallback((run: BackupRun) => {
        const targets = targetsOf(run, at);
        askDelete(targets, targets.length > 1 ? `Delete this backup at ${targets.length} destinations?` : "Delete this backup?");
    }, [askDelete, at]);

    // A restore or download from a row reads from a copy whose destination answers right now.
    const rank = useMemo(() => byAnswer(destinationsById), [destinationsById]);
    const groupsFor = useCallback((run: BackupRun) => {
        const target = primaryCopy(run, at, rank);
        const handlers = handlersFor(target.file, target.destinationId);
        return backupActions(target.file, { ...handlers, onDelete: handlers.onDelete ? () => deleteRun(run) : undefined });
    }, [at, rank, handlersFor, deleteRun]);

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

    const starters = useMemo(() => startedByOptions(runs), [runs]);
    const filterableColumns = useMemo<DataTableFilterableColumn<BackupRun>[]>(
        () => backupFilterColumns({ jobs, destinations, starters, counts, shown: visible.length }),
        [jobs, destinations, starters, counts, visible.length]
    );

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
                data={timeline.data}
                searchKey="backup"
                searchPlaceholder="Search backups"
                filterableColumns={filterableColumns}
                manualFiltering
                toolbarNote={<AnswerLegend />}
                toolbarExtra={timeline.chip}
                aboveRows={timeline.above}
                hideRows={timeline.hideRows}
                columnFilters={columnFilters}
                onColumnFiltersChange={onColumnFiltersChange}
                sorting={sorting}
                onSortingChange={setSorting}
                onRefresh={onRefresh}
                isLoading={refreshing}
                // Selecting for actions on many is a table thing. Cards keep to one backup at a time.
                enableRowSelection={canDelete && view !== "cards"}
                getRowId={runKey}
                bulkActions={bulkActions}
                onBulkActionComplete={onChanged}
                columnLayout={columnLayout}
                initialPageSize={20}
                onRowClick={onOpen}
                view={listView(view)}
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
