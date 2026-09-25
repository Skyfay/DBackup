"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { BackupDetailsSheet } from "@/components/dashboard/storage/explorer/backup-details";
import { targetsOf } from "@/components/dashboard/storage/explorer/backup-filters";
import { BACKUPS_PAGE_ID, BACKUPS_TABLE_ID, DESTINATIONS_PAGE_ID } from "@/components/dashboard/storage/explorer/backup-tables";
import { BackupsList } from "@/components/dashboard/storage/explorer/backups-list";
import { DestinationsView } from "@/components/dashboard/storage/explorer/destinations-view";
import { checkNow, destinationsOf, useExplorerData, useListingPoll } from "@/components/dashboard/storage/explorer/explorer-data";
import { ExplorerEmpty, ExplorerSkeleton } from "@/components/dashboard/storage/explorer/explorer-page-states";
import { FreshnessButton } from "@/components/dashboard/storage/explorer/freshness-button";
import { useBackupActions } from "@/components/dashboard/storage/explorer/use-backup-actions";
import { useBackupDetails } from "@/components/dashboard/storage/explorer/use-backup-details";
import { useExplorerAddress, type ExplorerTab } from "@/components/dashboard/storage/explorer/use-explorer-address";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewSwitch } from "@/components/ui/view-switch";
import { useIsMobileState } from "@/hooks/use-mobile";
import { useTableLayout } from "@/hooks/use-table-layout";
import type { TablePreferences, ViewMode } from "@/lib/core/table-preferences";
import type { ExplorerBackups, ExplorerDestination, ExplorerFile, ExplorerIndex, ExplorerPlan } from "@/services/storage/explorer-types";

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
    /** The column layout of the list of backups this user saved, null for the defaults. */
    initialLayout: TablePreferences | null;
    /** The views of the list of backups and of the destinations this user picked last. */
    initialViews: Record<ExplorerTab, ViewMode>;
}

/**
 * The Storage Explorer: every backup of every job in one list, with the job and the destination as
 * its filters, and every destination with how it is doing and its details under the list. Both come
 * from the lists DBackup keeps of every destination. The filters, the tab and the picked destination
 * live in the address.
 */
export function StorageClient({
    canDownload,
    canRestore,
    canDelete,
    canManageVault = false,
    canViewHistory = false,
    canEditAlerts = false,
    initialLayout,
    initialViews,
}: StorageClientProps) {
    const index = useExplorerData<ExplorerIndex>("/api/storage/explorer");
    const columnLayout = useTableLayout(BACKUPS_TABLE_ID, initialLayout);
    const [views, setViews] = useState<Record<ExplorerTab, ViewMode>>(() => ({
        backups: VIEWS.includes(initialViews.backups) ? initialViews.backups : "table",
        destinations: VIEWS.includes(initialViews.destinations) ? initialViews.destinations : "table",
    }));

    const jobs = useMemo(() => index.data?.jobs ?? [], [index.data]);
    const destinations = useMemo(() => index.data?.destinations ?? [], [index.data]);
    const jobsByKey = useMemo(() => new Map(jobs.map((job) => [job.key, job])), [jobs]);
    const destinationsById = useMemo(() => new Map(destinations.map((destination) => [destination.id, destination])), [destinations]);
    const { tab: pageTab, scope, picked, setParams, showBackupsAt } = useExplorerAddress(jobs, jobsByKey, destinationsById);

    // A phone has no room for the table, so it always gets the cards and no switch. The list
    // waits until the screen is measured, so a phone never flashes the table first.
    const isMobile = useIsMobileState();
    const shownView: ViewMode | undefined = isMobile === undefined ? undefined : isMobile ? "cards" : views[pageTab];

    // Both tabs read every backup, the Destinations tab for its timeline and the jobs of a destination.
    const backups = useExplorerData<ExplorerBackups>("/api/storage/explorer/runs");
    // What the schedules plan and missed, only while a timeline shows.
    const plan = useExplorerData<ExplorerPlan>(shownView === "timeline" ? "/api/storage/explorer/plan" : null);

    const { reload: reloadIndex } = index;
    const { reload: reloadBackups } = backups;
    const { reload: reloadPlan } = plan;
    const reloadAll = useCallback(() => {
        reloadIndex();
        reloadBackups();
        reloadPlan();
    }, [reloadIndex, reloadBackups, reloadPlan]);
    useListingPoll(destinations, reloadAll);

    const actions = useBackupActions({ canDownload, canRestore, canDelete, canManageVault, destinations: destinationsById, onChanged: reloadAll });
    const { handlersFor: handlersForTarget, askDelete } = actions;
    const handlersFor = useCallback((file: ExplorerFile, destinationId: string) => handlersForTarget({ file, destinationId }), [handlersForTarget]);
    const details = useBackupDetails({ runs: pageTab === "backups" ? backups.data?.runs ?? null : null, at: scope.at, jobsByKey, destinationsById });

    const changeView = useCallback((next: ViewMode) => {
        setViews((current) => ({ ...current, [pageTab]: next }));
        saveViewLayout(PAGE_IDS[pageTab], next)
            .then((result) => result.success)
            .catch(() => false)
            .then((saved) => {
                if (!saved) toast.error("Your view could not be saved.");
            });
    }, [pageTab]);

    // How fresh the lists are that the page shows: those of the filtered destinations, of the
    // destinations of the filtered jobs, or of every destination.
    const freshnessList = useMemo<ExplorerDestination[]>(() => {
        if (pageTab === "destinations") return destinations;
        if (scope.at.length > 0) return scope.at.map((id) => destinationsById.get(id)).filter((entry): entry is ExplorerDestination => entry !== undefined);
        if (scope.jobs.length > 0) {
            const ids = new Set(scope.jobs.flatMap((key) => destinationsOf(jobsByKey.get(key) ?? null, destinationsById).map((entry) => entry.id)));
            return destinations.filter((entry) => ids.has(entry.id));
        }
        return destinations;
    }, [pageTab, scope, destinations, destinationsById, jobsByKey]);
    const check = useCallback(async (targets: ExplorerDestination[], failure: string) => {
        try {
            await checkNow(targets);
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : failure);
        }
        reloadAll();
    }, [reloadAll]);
    const checkDestination = useCallback((destination: ExplorerDestination) => void check([destination], `${destination.name} could not be checked`), [check]);
    const onPick = useCallback((destinationId: string | null) => setParams({ tab: "destinations", destination: destinationId }), [setParams]);

    const backupCount = jobs.reduce((sum, entry) => sum + entry.runs, 0);
    const detailsRun = details.run;

    if (index.loading) {
        return (
            <div className="space-y-4 md:space-y-6">
                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                    <Skeleton className="h-9 w-56" />
                    <Skeleton className="ml-auto h-9 w-40" />
                </div>
                <ExplorerSkeleton />
            </div>
        );
    }

    if (!index.data) {
        return (
            <ExplorerEmpty title="The backups could not be loaded">
                {index.error ?? "Something went wrong."}{" "}
                <Button variant="link" className="h-auto p-0" onClick={reloadIndex}>Try again</Button>
            </ExplorerEmpty>
        );
    }

    if (jobs.length === 0 && destinations.length === 0) {
        return (
            <ExplorerEmpty title="No destinations yet">
                Backups appear here once a job has written to a destination. Add a destination on the Connections page and a job that uses it.
            </ExplorerEmpty>
        );
    }

    return (
        <div className="space-y-4 md:space-y-6">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <Tabs
                    value={pageTab}
                    onValueChange={(next) => {
                        details.reset();
                        setParams(next === "backups"
                            ? { tab: null, destination: null }
                            : { tab: "destinations", destination: null, job: null, at: null, by: null });
                    }}
                >
                    <TabsList aria-label="Show">
                        <TabsTrigger value="backups">
                            <span className="flex items-center gap-2">
                                Backups
                                <span className="text-xs font-normal text-muted-foreground tabular-nums">{backupCount.toLocaleString()}</span>
                            </span>
                        </TabsTrigger>
                        <TabsTrigger value="destinations">
                            <span className="flex items-center gap-2">
                                Destinations
                                <span className="text-xs font-normal text-muted-foreground tabular-nums">{destinations.length}</span>
                            </span>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <FreshnessButton destinations={freshnessList} onCheckNow={() => check(freshnessList, "The destinations could not be checked")} />
                    {/* Hidden by CSS rather than by the measured screen, so it does not pop in after loading. */}
                    <div className="hidden md:block">
                        <ViewSwitch value={views[pageTab]} onChange={changeView} views={VIEWS} />
                    </div>
                </div>
            </div>

            {pageTab === "backups" && (
                backups.loading || !backups.data || !shownView ? (
                    backups.error ? <ExplorerEmpty title="The backups could not be loaded">{backups.error}</ExplorerEmpty> : <ExplorerSkeleton />
                ) : (
                    <BackupsList
                        runs={backups.data.runs}
                        jobs={jobs}
                        jobsByKey={jobsByKey}
                        destinations={destinations}
                        destinationsById={destinationsById}
                        scope={scope}
                        onScope={(next) => setParams({ job: next.jobs, at: next.at, by: next.by, destination: null })}
                        view={shownView}
                        plan={plan.data ?? null}
                        columnLayout={columnLayout}
                        canDelete={canDelete}
                        handlersFor={handlersFor}
                        askDelete={askDelete}
                        onOpen={details.openRun}
                        onRefresh={reloadAll}
                        refreshing={backups.reloading}
                        onChanged={reloadAll}
                    />
                )
            )}

            {pageTab === "destinations" && (
                destinations.length === 0 ? (
                    <ExplorerEmpty title="No destinations yet">Add a destination on the Connections page, then it shows here with its backups.</ExplorerEmpty>
                ) : !shownView ? (
                    <ExplorerSkeleton />
                ) : (
                    <DestinationsView
                        destinations={destinations}
                        destinationsById={destinationsById}
                        jobs={jobs}
                        runs={backups.data?.runs ?? null}
                        runsError={backups.error}
                        plan={plan.data ?? null}
                        view={shownView === "timeline" ? "timeline" : shownView === "cards" ? "cards" : "table"}
                        picked={picked}
                        onPick={onPick}
                        onOpenBackups={showBackupsAt}
                        canDelete={canDelete}
                        canEditAlerts={canEditAlerts}
                        onCheckNow={checkDestination}
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
        </div>
    );
}
