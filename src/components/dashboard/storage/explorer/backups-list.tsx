"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnFiltersState, OnChangeFn, SortingState } from "@tanstack/react-table";
import { SharedCard } from "@/components/dashboard/shared/shared-card";
import { useTenantColumns } from "@/components/tenant/tenant-column";
import { matchesTenants, TENANT_COLUMN_ID, withTenantColumn } from "@/components/tenant/tenant-rows";
import { useTenantView } from "@/components/tenant/tenant-view";
import { DataTable, type DataTableFilterableColumn } from "@/components/ui/data-table";
import type { ColumnLayoutOption } from "@/components/ui/use-column-layout";
import { listView, type ViewMode } from "@/lib/core/table-preferences";
import type { BackupRun, ExplorerDestination, ExplorerFile, ExplorerJob, ExplorerPlan } from "@/services/storage/explorer-types";
import { backupActions, type BackupActionHandlers } from "./backup-actions";
import { backupBulkActions } from "./backup-bulk-actions";
import { BackupCard } from "./backup-card";
import { backupColumns } from "./backup-columns";
import { backupFilterColumns } from "./backup-filter-columns";
import { byAnswer, countBackups, filterBackups, lookupOf, primaryCopy, runKey, startedByOptions, targetsOf, type BackupState } from "./backup-filters";
import { BackupContextMenu, BackupRowMenu } from "./backup-menus";
import { BackupsStrip } from "./backups-strip";
import { AnswerLegend, JobTile } from "./explorer-cells";
import { typeLabel } from "./explorer-format";
import { BackupQuickFilter, SharedContextMenu, SharedListNote, type SharedListSource } from "./shared-list-parts";
import { isSharedRun, splitAt, type ListRun, type QuickPick } from "./shared-runs";
import { useTimelineList } from "./timeline-list";
import type { BackupTarget } from "./use-backup-actions";

/** The filters by job, destination and who started a run, which live in the address. */
export interface BackupScope {
    jobs: string[];
    at: string[];
    by: string[];
}

interface BackupsListProps {
    /** The own backups and the shared ones, newest first. */
    runs: ListRun[];
    /** Every job of the index, in its order: jobs, deleted jobs, then the rest. */
    jobs: ExplorerJob[];
    jobsByKey: Map<string, ExplorerJob>;
    destinations: ExplorerDestination[];
    destinationsById: Map<string, ExplorerDestination>;
    scope: BackupScope;
    onScope: (next: BackupScope) => void;
    /** Every backup, the own ones or the shared ones, offered only with `shared`. */
    quick: QuickPick;
    onQuick: (next: QuickPick) => void;
    /** The shared databases, null for a tenant without any, whose list stays as it always was. */
    shared: SharedListSource | null;
    view: ViewMode;
    /** What the schedules plan and missed, for the timeline view. Null while it loads or in another view. */
    plan: ExplorerPlan | null;
    columnLayout: ColumnLayoutOption;
    canDelete: boolean;
    handlersFor: (file: ExplorerFile, destinationId: string) => BackupActionHandlers;
    askDelete: (targets: BackupTarget[], title?: string) => void;
    /** Opens a backup in its details, `onClosed` runs once they are gone again. */
    onOpen: (run: ListRun, onClosed?: () => void) => void;
    /** Moves from the timeline to the list view, for what a list of the timeline holds. */
    onShowList: () => void;
    onRefresh: () => void;
    refreshing: boolean;
    onChanged: () => void;
}

/** The tenant of a backup, the one of its job, for the Tenant column in All tenants. */
const tenantOfRun = (run: BackupRun) => run.tenantId;

/**
 * Every backup of every job in one list, with the backups of the databases another tenant's server
 * gives to this one among them. The job and the destination are filters of it like on the other
 * pages, a filter by destination also decides which copies the numbers, the states and the actions
 * count, and the quick filter tells the own backups from the shared ones. A shared backup offers
 * only what the tenant may do with its database, the rest stays with its provider.
 */
export function BackupsList({
    runs,
    jobs,
    jobsByKey,
    destinations,
    destinationsById,
    scope,
    onScope,
    quick,
    onQuick,
    shared,
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
    // The Destination filter holds the destinations and the providers of the shared databases.
    const { at, providers } = useMemo(() => splitAt(scope.at), [scope.at]);
    const shownQuick: QuickPick = shared ? quick : "all";
    // In All tenants the list holds the backups of every tenant, with a Tenant column and filter.
    const tenant = useTenantColumns(tenantOfRun, runs);
    const { tenants: tenantList } = useTenantView();

    const filters = useMemo(
        () => ({ jobs: scope.jobs, at, providers, by: scope.by, search, states, tenants, quick: shownQuick }),
        [scope.jobs, at, providers, scope.by, search, states, tenants, shownQuick]
    );
    const destinationIds = useMemo(() => destinations.map((destination) => destination.id), [destinations]);
    const lookup = useMemo(() => lookupOf(jobsByKey, destinations), [jobsByKey, destinations]);
    const visible = useMemo(() => filterBackups(runs, filters, lookup), [runs, filters, lookup]);
    const counts = useMemo(() => countBackups(runs, filters, lookup, destinationIds, shared?.providers), [runs, filters, lookup, destinationIds, shared?.providers]);
    // The timeline has a row for every job of the picked tenants, with backups or not.
    const tenantJobs = useMemo(() => (tenants.length > 0 ? jobs.filter((job) => matchesTenants(job.tenantId, tenants)) : jobs), [jobs, tenants]);
    const timeline = useTimelineList({
        on: view === "timeline",
        runs: visible,
        jobs: tenantJobs,
        jobsByKey,
        sharedDatabases: shared?.databases,
        scopeJobs: scope.jobs,
        narrowed: scope.at.length > 0 || scope.by.length > 0 || states.length > 0 || search.trim() !== "",
        quick: shownQuick,
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
        ...(scope.at.length > 0 ? [{ id: "at", value: scope.at }] : []),
        ...(scope.by.length > 0 ? [{ id: "startedBy", value: scope.by }] : []),
        ...(states.length > 0 ? [{ id: "state", value: states }] : []),
        ...(tenants.length > 0 ? [{ id: TENANT_COLUMN_ID, value: tenants }] : []),
        ...(search ? [{ id: "backup", value: search }] : []),
    ], [scope, states, tenants, search]);
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
        if (!same(nextScope.jobs, scope.jobs) || !same(nextScope.at, scope.at) || !same(nextScope.by, scope.by)) onScope(nextScope);
    };

    const scopeName = at.map((id) => destinationsById.get(id)?.name ?? "a removed destination").join(", ");

    const deleteRun = useCallback((run: BackupRun) => {
        const targets = targetsOf(run, at);
        askDelete(targets, targets.length > 1 ? `Delete this backup at ${targets.length} destinations?` : "Delete this backup?");
    }, [askDelete, at]);

    // A restore or download from a row reads from a copy whose destination answers right now.
    // A shared backup offers what the tenant may do with its database alone.
    const rank = useMemo(() => byAnswer(destinationsById), [destinationsById]);
    const groupsFor = useCallback((run: ListRun) => {
        if (isSharedRun(run)) return shared?.groupsFor(run.shared) ?? [];
        const target = primaryCopy(run, at, rank);
        const handlers = handlersFor(target.file, target.destinationId);
        return backupActions(target.file, { ...handlers, onDelete: handlers.onDelete ? () => deleteRun(run) : undefined });
    }, [at, rank, handlersFor, deleteRun, shared]);

    const renderActions = useCallback((run: ListRun) => (
        <BackupRowMenu name={run.file.name} groups={groupsFor(run)} foot={isSharedRun(run) ? shared?.footFor(run.shared) : undefined} />
    ), [groupsFor, shared]);

    const columns = useMemo(
        () => withTenantColumn(backupColumns({ jobs: jobsByKey, destinations: destinationsById, at, onOpen, renderActions }), tenant.column),
        [jobsByKey, destinationsById, at, onOpen, renderActions, tenant.column]
    );

    const bulkActions = useMemo(() => backupBulkActions(canDelete, at, scopeName), [canDelete, at, scopeName]);

    const starters = useMemo(() => startedByOptions(runs), [runs]);
    const { allTenants, nameOf } = tenant;
    const filterableColumns = useMemo<DataTableFilterableColumn<ListRun>[]>(
        () => backupFilterColumns({
            jobs,
            destinations,
            starters,
            counts,
            shown: visible.length,
            tenants: allTenants ? { all: tenantList, of: runs.map(tenantOfRun), nameOf } : null,
            shared: shared ? { databases: shared.databases, providers: shared.providers } : null,
        }),
        [jobs, destinations, starters, counts, visible.length, allTenants, tenantList, runs, nameOf, shared]
    );

    const activeShared = shared?.activeId ? visible.find((run) => run.shared?.id === shared.activeId) : undefined;

    return (
        <div className="space-y-4 md:space-y-0">
            <BackupsStrip runs={visible} at={at} scopeName={scopeName} jobsByKey={jobsByKey} />

            <DataTable
                joined
                columns={columns}
                data={timeline.data}
                searchKey="backup"
                searchPlaceholder="Search backups"
                filterableColumns={filterableColumns}
                manualFiltering
                toolbarNote={(
                    <>
                        <AnswerLegend airGapped={destinations.some((destination) => destination.airGapped)} />
                        {shared && <SharedListNote providers={shared.providers} error={shared.error} onRetry={shared.onRetry} />}
                    </>
                )}
                toolbarExtra={(
                    <>
                        {shared && !shared.loading && <BackupQuickFilter value={quick} onChange={onQuick} counts={counts.quick} />}
                        {timeline.chip}
                    </>
                )}
                aboveRows={timeline.above}
                hideRows={timeline.hideRows}
                columnFilters={columnFilters}
                onColumnFiltersChange={onColumnFiltersChange}
                sorting={sorting}
                onSortingChange={setSorting}
                onRefresh={onRefresh}
                isLoading={refreshing}
                // The shared backups are still on their way, so a list of them alone does not read as empty.
                loadingRows={shared?.loading === true && visible.length === 0}
                // Selecting for actions on many is a table thing. Cards keep to one backup at a time.
                enableRowSelection={canDelete && view !== "cards"}
                // Lock and delete of a shared backup stay with its provider.
                isRowSelectable={(run) => !isSharedRun(run)}
                getRowId={runKey}
                bulkActions={bulkActions}
                onBulkActionComplete={onChanged}
                columnLayout={columnLayout}
                onRowClick={onOpen}
                activeRowId={activeShared ? runKey(activeShared) : null}
                view={listView(view)}
                renderCard={(row) => {
                    const run = row.original;
                    if (isSharedRun(run)) return <SharedCard row={run.shared} onOpen={() => onOpen(run)} actions={renderActions(run)} />;
                    return (
                        <BackupCard
                            run={run}
                            job={jobsByKey.get(run.jobKey)}
                            destinations={destinationsById}
                            at={at}
                            onOpen={onOpen}
                            actions={renderActions(run)}
                            tenantName={tenant.allTenants ? tenant.nameOf(run.tenantId) : null}
                        />
                    );
                }}
                renderRowMenu={(run, bulk) => {
                    if (isSharedRun(run)) return shared ? <SharedContextMenu run={run} source={shared} /> : null;
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
