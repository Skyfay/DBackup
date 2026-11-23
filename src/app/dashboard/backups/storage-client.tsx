"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { useSharedBackups } from "@/components/dashboard/shared/use-shared-backups";
import { BackupDetailsSheet } from "@/components/dashboard/storage/explorer/backup-details";
import { targetsOf } from "@/components/dashboard/storage/explorer/backup-filters";
import { BACKUPS_PAGE_ID, BACKUPS_TABLE_ID, DESTINATIONS_PAGE_ID } from "@/components/dashboard/storage/explorer/backup-tables";
import { BackupsList } from "@/components/dashboard/storage/explorer/backups-list";
import { BackupsPageHead } from "@/components/dashboard/storage/explorer/backups-page-head";
import { DestinationsView } from "@/components/dashboard/storage/explorer/destinations-view";
import { checkNow, freshnessOf, useExplorerData, useListingPoll } from "@/components/dashboard/storage/explorer/explorer-data";
import { BackupsPending, ExplorerEmpty, ExplorerPageSkeleton, ExplorerSkeleton } from "@/components/dashboard/storage/explorer/explorer-page-states";
import { isSharedRun, mergeRuns, splitAt, type ListRun } from "@/components/dashboard/storage/explorer/shared-runs";
import { useBackupActions, type BackupTarget } from "@/components/dashboard/storage/explorer/use-backup-actions";
import { useBackupDetails } from "@/components/dashboard/storage/explorer/use-backup-details";
import { BACKUP_PARAM, useExplorerAddress, type ExplorerTab } from "@/components/dashboard/storage/explorer/use-explorer-address";
import { Button } from "@/components/ui/button";
import { useIsMobileState } from "@/hooks/use-mobile";
import { useOpenFromLink } from "@/hooks/use-open-from-link";
import { useTableLayout } from "@/hooks/use-table-layout";
import type { TablePreferences, ViewMode } from "@/lib/core/table-preferences";
import type { BackupRun, ExplorerBackups, ExplorerDestination, ExplorerFile, ExplorerIndex, ExplorerPlan } from "@/services/storage/explorer-types";

/**
 * The views of both lists above a phone: the table and the timeline of days above it. A card only
 * repeats a row of the table, so the cards are left to phones, which always get them.
 */
const VIEWS: ViewMode[] = ["table", "timeline"];

const PAGE_IDS: Record<ExplorerTab, string> = { backups: BACKUPS_PAGE_ID, destinations: DESTINATIONS_PAGE_ID };

interface StorageClientProps {
    canDownload: boolean;
    canRestore: boolean;
    canDelete: boolean;
    /** Whether this user may create vault profiles, which key recovery does. */
    canManageVault?: boolean;
    canViewHistory?: boolean;
    /** Whether this user may change the alerts of a destination, which are settings. */
    canEditAlerts?: boolean;
    /** Whether another tenant's server shares a database with this tenant, whose backups then join the list. */
    hasShared?: boolean;
    /** Whether this user may start a backup of a shared database its provider allows, which Run now of a job allows. */
    canBackUpShared?: boolean;
    /** The column layout of the list of backups this user saved, null for the defaults. */
    initialLayout: TablePreferences | null;
    /** The views of the list of backups and of the destinations this user picked last. */
    initialViews: Record<ExplorerTab, ViewMode>;
}

/**
 * The Backups page: every backup of every job in one list, with the job and the destination as
 * its filters, and every destination with how it is doing and its details under the list. Both come
 * from the lists DBackup keeps of every destination. The backups of the databases another tenant's
 * server gives to this one join the list, with a quick filter that tells them from the own ones. The
 * filters, the tab and the picked destination live in the address.
 */
export function StorageClient({
    canDownload,
    canRestore,
    canDelete,
    canManageVault = false,
    canViewHistory = false,
    canEditAlerts = false,
    hasShared = false,
    canBackUpShared = false,
    initialLayout,
    initialViews,
}: StorageClientProps) {
    const index = useExplorerData<ExplorerIndex>("/api/storage/explorer");
    const columnLayout = useTableLayout(BACKUPS_TABLE_ID, initialLayout);
    const [views, setViews] = useState<Record<ExplorerTab, ViewMode>>(() => {
        const valid = (view: ViewMode | undefined) => (view && VIEWS.includes(view) ? view : "table");
        return { backups: valid(initialViews.backups), destinations: valid(initialViews.destinations) };
    });

    const jobs = useMemo(() => index.data?.jobs ?? [], [index.data]);
    const destinations = useMemo(() => index.data?.destinations ?? [], [index.data]);
    const jobsByKey = useMemo(() => new Map(jobs.map((job) => [job.key, job])), [jobs]);
    const destinationsById = useMemo(() => new Map(destinations.map((destination) => [destination.id, destination])), [destinations]);
    const { tab, quick, scope, picked, setParams, setScope, setQuick, showBackupsAt } = useExplorerAddress(jobs, jobsByKey, destinationsById);
    // The Destination filter may hold the providers of shared databases beside the destinations.
    const at = useMemo(() => splitAt(scope.at).at, [scope.at]);
    const ownEmpty = jobs.length === 0 && destinations.length === 0;

    // A phone has no room for the table, so it always gets the cards and no switch. The list
    // waits until the screen is measured, so a phone never flashes the table first.
    const isMobile = useIsMobileState();
    const shownView: ViewMode | undefined = isMobile === undefined ? undefined : isMobile ? "cards" : views[tab];

    // Both tabs read every backup, the Destinations tab for its timeline and the jobs of a destination.
    const backups = useExplorerData<ExplorerBackups>("/api/storage/explorer/runs");
    // What the schedules plan and missed, only while a timeline shows.
    const plan = useExplorerData<ExplorerPlan>(shownView === "timeline" ? "/api/storage/explorer/plan" : null);
    // The backups of the shared databases, asked for only while the tenant has some.
    const shared = useSharedBackups({ enabled: hasShared, canDownload, canRestore, canViewHistory, canBackUp: canBackUpShared });

    const { reload: reloadIndex } = index;
    const { reload: reloadBackups } = backups;
    const { reload: reloadPlan } = plan;
    const { reload: reloadShared } = shared;
    const reloadAll = useCallback(() => {
        reloadIndex();
        reloadBackups();
        reloadPlan();
    }, [reloadIndex, reloadBackups, reloadPlan]);
    // Refresh loads the shared backups again too, the poll of the listings leaves them alone.
    const refresh = useCallback(() => {
        reloadAll();
        reloadShared();
    }, [reloadAll, reloadShared]);
    useListingPoll(destinations, reloadAll);

    // The integrity dialog lists every copy of a backup, which the list of backups knows.
    const runs = backups.data?.runs;
    const copiesOf = useCallback((target: BackupTarget) => runs?.find((run) => run.path === target.file.path)?.copies
        ?? [{ destinationId: target.destinationId, state: "stored" as const, file: target.file }], [runs]);
    const actions = useBackupActions({ canDownload, canRestore, canDelete, canManageVault, destinations: destinationsById, onChanged: reloadAll, canViewHistory, copiesOf });
    const { handlersFor: handlersForTarget, askDelete } = actions;
    const handlersFor = useCallback((file: ExplorerFile, destinationId: string) => handlersForTarget({ file, destinationId }), [handlersForTarget]);
    const details = useBackupDetails({ runs: tab === "backups" ? runs ?? null : null, at, jobsByKey, destinationsById });
    // A link names a backup by its path with `?backup=`, like Open in a tenant from All tenants.
    const linkable = useMemo(() => (tab === "backups" && runs ? runs.map((run) => ({ id: run.path, run })) : null), [tab, runs]);
    const { openRun: openOwn } = details;
    const openLinked = useCallback((entry: { run: BackupRun }) => openOwn(entry.run), [openOwn]);
    useOpenFromLink(linkable, openLinked, BACKUP_PARAM);
    // A shared backup opens the panel of a shared backup, an own one its details.
    const { open: openShared } = shared;
    const openRun = useCallback((run: ListRun, onClosed?: () => void) => (isSharedRun(run) ? openShared(run.shared, onClosed) : openOwn(run, onClosed)), [openShared, openOwn]);

    const listRuns = useMemo(() => (runs ? mergeRuns(runs, shared.runs) : null), [runs, shared.runs]);

    const changeView = useCallback((next: ViewMode) => {
        setViews((current) => ({ ...current, [tab]: next }));
        saveViewLayout(PAGE_IDS[tab], next)
            .then((result) => result.success)
            .catch(() => false)
            .then((saved) => {
                if (!saved) toast.error("Your view could not be saved.");
            });
    }, [tab]);
    // Show in the list of the timeline moves to the table for now, the saved view stays the timeline.
    const showList = useCallback(() => setViews((current) => ({ ...current, backups: "table" })), []);

    // How fresh the lists are that the page shows: those of the filtered destinations, of the
    // destinations of the filtered jobs, or of every destination.
    const freshnessList = useMemo(
        () => (tab === "destinations" ? destinations : freshnessOf(at, scope.jobs, destinations, destinationsById, jobsByKey)),
        [tab, at, scope.jobs, destinations, destinationsById, jobsByKey]
    );
    const check = useCallback(async (targets: ExplorerDestination[], failure: string) => {
        try {
            await checkNow(targets);
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : failure);
        }
        reloadAll();
    }, [reloadAll]);
    const checkDestination = useCallback((destination: ExplorerDestination) => void check([destination], `${destination.name} could not be checked`), [check]);
    // The bulk action of the Destinations tab reports itself, so a failure is thrown for it rather than shown here.
    const checkMany = useCallback(async (targets: ExplorerDestination[]) => {
        try {
            await checkNow(targets);
        } finally {
            reloadAll();
        }
    }, [reloadAll]);
    const onPick = useCallback((destinationId: string | null) => setParams({ tab: "destinations", destination: destinationId }), [setParams]);

    const detailsRun = details.run;
    const changeTab = (next: string) => {
        details.reset();
        shared.reset();
        setParams(next === "backups"
            ? { tab: null, destination: null }
            : { tab: "destinations", destination: null, job: null, at: null, by: null, quick: null, shared: null });
    };

    if (index.loading) return <ExplorerPageSkeleton />;

    if (!index.data) {
        return (
            <ExplorerEmpty title="The backups could not be loaded">
                {index.error ?? "Something went wrong."}{" "}
                <Button variant="link" className="h-auto p-0" onClick={reloadIndex}>Try again</Button>
            </ExplorerEmpty>
        );
    }

    if (ownEmpty && !hasShared) {
        return (
            <ExplorerEmpty title="No destinations yet">
                Backups appear here once a job has written to a destination. Add a destination on the Connections page and a job that uses it.
            </ExplorerEmpty>
        );
    }

    // A tenant with nothing of its own lists the backups of its shared databases once they are there.
    const sharedPending = ownEmpty && (shared.loading || (shared.error !== null && shared.runs.length === 0));
    const waiting = !listRuns || !shownView || sharedPending;

    return (
        <div className="space-y-4 md:space-y-0">
            <BackupsPageHead
                tab={tab}
                onTab={changeTab}
                jobs={jobs}
                destinations={destinations}
                freshness={freshnessList}
                onCheckNow={() => check(freshnessList, "The destinations could not be checked")}
                view={views[tab]}
                views={VIEWS}
                onView={changeView}
            />

            {tab === "backups" && (
                waiting || (ownEmpty && listRuns.length === 0) ? (
                    <BackupsPending error={waiting ? backups.error : null} sharedError={sharedPending ? shared.error : null} onRetryShared={reloadShared} empty={!waiting} />
                ) : (
                    <BackupsList
                        runs={listRuns}
                        jobs={jobs}
                        jobsByKey={jobsByKey}
                        destinations={destinations}
                        destinationsById={destinationsById}
                        scope={scope}
                        onScope={setScope}
                        quick={quick}
                        onQuick={setQuick}
                        shared={shared.source}
                        view={shownView}
                        plan={plan.data ?? null}
                        columnLayout={columnLayout}
                        canDelete={canDelete}
                        handlersFor={handlersFor}
                        askDelete={askDelete}
                        onOpen={openRun}
                        onShowList={showList}
                        onRefresh={refresh}
                        refreshing={backups.reloading || shared.reloading}
                        onChanged={reloadAll}
                    />
                )
            )}

            {tab === "destinations" && (
                destinations.length === 0 ? (
                    <ExplorerEmpty joined title="No destinations yet">Add a destination on the Connections page, then it shows here with its backups.</ExplorerEmpty>
                ) : !shownView ? (
                    <ExplorerSkeleton joined />
                ) : (
                    <DestinationsView
                        destinations={destinations}
                        destinationsById={destinationsById}
                        jobs={jobs}
                        runs={runs ?? null}
                        runsError={backups.error}
                        plan={plan.data ?? null}
                        view={shownView === "timeline" ? "timeline" : shownView === "cards" ? "cards" : "table"}
                        picked={picked}
                        onPick={onPick}
                        onOpenBackups={showBackupsAt}
                        canDelete={canDelete}
                        canEditAlerts={canEditAlerts}
                        onCheckNow={checkDestination}
                        onCheckMany={checkMany}
                        askDelete={askDelete}
                        onRefresh={reloadAll}
                        refreshing={index.reloading || backups.reloading}
                        onChanged={reloadAll}
                    />
                )
            )}

            <BackupDetailsSheet
                open={details.open}
                data={details.data}
                onClose={details.close}
                onCloseAutoFocus={details.closed}
                destinations={destinationsById}
                handlersFor={handlersFor}
                onCheckDestination={(id) => {
                    const target = destinationsById.get(id);
                    if (target) checkDestination(target);
                }}
                onDeleteEverywhere={detailsRun && canDelete
                    ? () => {
                        const targets = targetsOf(detailsRun, []);
                        askDelete(targets, targets.length > 1 ? "Delete this backup at every destination?" : "Delete this backup?");
                    }
                    : undefined}
                canViewHistory={canViewHistory}
            />
            {actions.dialogs}
            {shared.elements}
        </div>
    );
}
