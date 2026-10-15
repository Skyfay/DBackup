"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnFiltersState, OnChangeFn, SortingState } from "@tanstack/react-table";
import { Archive, Clock, Copy, Layers, ShieldCheck } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { useTenantColumns } from "@/components/tenant/tenant-column";
import { matchesTenants, TENANT_COLUMN_ID, withTenantColumn } from "@/components/tenant/tenant-rows";
import { useTenantView } from "@/components/tenant/tenant-view";
import { DataTable, type DataTableFilterableColumn } from "@/components/ui/data-table";
import type { ColumnLayoutOption } from "@/components/ui/use-column-layout";
import { listView, type ViewMode } from "@/lib/core/table-preferences";
import { formatBytes } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerFile, ExplorerJob, ExplorerPlan } from "@/services/storage/explorer-types";
import { backupActions, type BackupActionHandlers } from "./backup-actions";
import { backupBulkActions } from "./backup-bulk-actions";
import { BackupCard } from "./backup-card";
import { backupColumns } from "./backup-columns";
import { backupFilterColumns } from "./backup-filter-columns";
import { byAnswer, countBackups, filterBackups, lookupOf, primaryCopy, runKey, startedByOptions, summarize, targetsOf, type BackupState } from "./backup-filters";
import { BackupContextMenu, BackupRowMenu } from "./backup-menus";
import { AnswerLegend, JobTile } from "./explorer-cells";
import { count, typeLabel } from "./explorer-format";
import { ExplorerStrip } from "./explorer-strip";
import { useTimelineList } from "./timeline-list";
import type { BackupTarget } from "./use-backup-actions";

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
    /** Opens a backup in its details, `onClosed` runs once they are gone again. */
    onOpen: (run: BackupRun, onClosed?: () => void) => void;
    /** Moves from the timeline to the list view, for what a list of the timeline holds. */
    onShowList: () => void;
    onRefresh: () => void;
    refreshing: boolean;
    onChanged: () => void;
}

/** The tenant of a backup, the one of its job, for the Tenant column in All tenants. */
const tenantOfRun = (run: BackupRun) => run.tenantId;

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
    onShowList,
    onRefresh,
    refreshing,
    onChanged,
}: BackupsListProps) {
    const [states, setStates] = useState<BackupState[]>([]);
    const [tenants, setTenants] = useState<string[]>([]);
    const [search, setSearch] = useState("");
    const [sorting, setSorting] = useState<SortingState>([{ id: "backup", desc: true }]);
    const { at } = scope;
    // In All tenants the list holds the backups of every tenant, with a Tenant column and filter.
    const tenant = useTenantColumns(tenantOfRun, runs);
    const { tenants: tenantList } = useTenantView();

    const filters = useMemo(() => ({ jobs: scope.jobs, at, by: scope.by, search, states, tenants }), [scope.jobs, at, scope.by, search, states, tenants]);
    const destinationIds = useMemo(() => destinations.map((destination) => destination.id), [destinations]);
    const lookup = useMemo(() => lookupOf(jobsByKey, destinations), [jobsByKey, destinations]);
    const visible = useMemo(() => filterBackups(runs, filters, lookup), [runs, filters, lookup]);
    const counts = useMemo(() => countBackups(runs, filters, lookup, destinationIds), [runs, filters, lookup, destinationIds]);
    const summary = useMemo(() => summarize(visible, at, jobsByKey), [visible, at, jobsByKey]);
    // The timeline has a row for every job of the picked tenants, with backups or not.
    const tenantJobs = useMemo(() => (tenants.length > 0 ? jobs.filter((job) => matchesTenants(job.tenantId, tenants)) : jobs), [jobs, tenants]);
    const timeline = useTimelineList({
        on: view === "timeline",
        runs: visible,
        jobs: tenantJobs,
        jobsByKey,
        scopeJobs: scope.jobs,
        narrowed: at.length > 0 || scope.by.length > 0 || states.length > 0 || search.trim() !== "",
        plan,
        destinations: destinationsById,
        at,
        onOpen,
        onShowList,
    });

    // The table keeps its own search box and filter buttons, but what they leave is worked out
    // here, so the list, the counts and the numbers agree.
    const columnFilters = useMemo<ColumnFiltersState>(() => [
        ...(scope.jobs.length > 0 ? [{ id: "job", value: scope.jobs }] : []),
        ...(at.length > 0 ? [{ id: "at", value: at }] : []),
        ...(scope.by.length > 0 ? [{ id: "startedBy", value: scope.by }] : []),
        ...(states.length > 0 ? [{ id: "state", value: states }] : []),
        ...(tenants.length > 0 ? [{ id: TENANT_COLUMN_ID, value: tenants }] : []),
        ...(search ? [{ id: "backup", value: search }] : []),
    ], [scope.jobs, at, scope.by, states, tenants, search]);
    const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
        const next = typeof updater === "function" ? updater(columnFilters) : updater;
        const valueOf = (id: string) => next.find((entry) => entry.id === id)?.value;
        setSearch((valueOf("backup") as string | undefined) ?? "");
        setStates((valueOf("state") as BackupState[] | undefined) ?? []);
        setTenants((valueOf(TENANT_COLUMN_ID) as string[] | undefined) ?? []);
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
        () => withTenantColumn(backupColumns({ jobs: jobsByKey, destinations: destinationsById, at, onOpen, renderActions }), tenant.column),
        [jobsByKey, destinationsById, at, onOpen, renderActions, tenant.column]
    );

    const bulkActions = useMemo(() => backupBulkActions(canDelete, at, scopeName), [canDelete, at, scopeName]);

    const starters = useMemo(() => startedByOptions(runs), [runs]);
    const { allTenants, nameOf } = tenant;
    const filterableColumns = useMemo<DataTableFilterableColumn<BackupRun>[]>(
        () => backupFilterColumns({
            jobs,
            destinations,
            starters,
            counts,
            shown: visible.length,
            tenants: allTenants ? { all: tenantList, of: runs.map(tenantOfRun), nameOf } : null,
        }),
        [jobs, destinations, starters, counts, visible.length, allTenants, tenantList, runs, nameOf]
    );

    const [storedValue, storedUnit] = formatBytes(summary.stored, 1).split(" ");
    const newestJob = summary.newest ? jobsByKey.get(summary.newest.jobKey) : undefined;

    return (
        <div className="space-y-4 md:space-y-0">
            <ExplorerStrip
                joined
                cells={[
                    {
                        label: "Backups",
                        icon: Archive,
                        value: summary.runs.toLocaleString(),
                        extra: `from ${count(summary.jobs, "job")}${summary.deletedJobs > 0 ? ` and ${count(summary.deletedJobs, "deleted job")}` : ""}`,
                    },
                    {
                        label: "Stored",
                        icon: Layers,
                        value: storedValue,
                        unit: storedUnit,
                        extra: at.length === 1 ? `at ${scopeName}` : `at ${count(summary.destinations, "destination")}`,
                    },
                    {
                        label: "Newest",
                        icon: Clock,
                        value: summary.newest ? <RelativeTime date={summary.newest.createdAt} /> : "-",
                        extra: newestJob ? `${newestJob.name} · ${typeLabel(summary.newest!.file)}` : undefined,
                    },
                    {
                        label: "Copies",
                        icon: Copy,
                        value: (summary.copies - summary.missing).toLocaleString(),
                        unit: `of ${summary.copies.toLocaleString()}`,
                        tone: summary.missing > 0 ? "warning" : undefined,
                        extra: summary.missing > 0 ? `${count(summary.missing, "copy", "copies")} missing` : "none missing",
                    },
                    {
                        label: "Integrity",
                        icon: ShieldCheck,
                        value: summary.failed > 0 ? summary.failed.toLocaleString() : summary.verified.toLocaleString(),
                        unit: summary.failed > 0 ? "failed" : `of ${summary.runs.toLocaleString()} verified`,
                        tone: summary.failed > 0 ? "destructive" : undefined,
                        extra: summary.failed > 0 ? `${summary.verified.toLocaleString()} verified` : summary.locked > 0 ? `${summary.locked.toLocaleString()} locked` : undefined,
                    },
                ]}
            />

            <DataTable
                joined
                columns={columns}
                data={timeline.data}
                searchKey="backup"
                searchPlaceholder="Search backups"
                filterableColumns={filterableColumns}
                manualFiltering
                toolbarNote={<AnswerLegend airGapped={destinations.some((destination) => destination.airGapped)} />}
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
                        tenantName={tenant.allTenants ? tenant.nameOf(row.original.tenantId) : null}
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
