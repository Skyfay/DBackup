"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { HardDrive, List, RotateCw, ChartGantt } from "lucide-react";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { StorageHistoryTab, type StorageHistoryTabRef } from "@/components/dashboard/storage/storage-history-tab";
import { StorageSettingsTab, type StorageSettingsTabRef } from "@/components/dashboard/storage/storage-settings-tab";
import { BackupDetailsSheet, type BackupDetailsData } from "@/components/dashboard/storage/explorer/backup-details";
import { byAnswer, primaryCopy, runKey, targetsOf } from "@/components/dashboard/storage/explorer/backup-filters";
import { BACKUPS_PAGE_ID, BACKUPS_TABLE_ID } from "@/components/dashboard/storage/explorer/backup-tables";
import { BackupsList, type BackupScope } from "@/components/dashboard/storage/explorer/backups-list";
import { DestinationBackups, type DestinationLayout } from "@/components/dashboard/storage/explorer/destination-backups";
import { checkNow, destinationsOf, useExplorerData } from "@/components/dashboard/storage/explorer/explorer-data";
import { ExplorerPicker } from "@/components/dashboard/storage/explorer/explorer-picker";
import { FreshnessButton } from "@/components/dashboard/storage/explorer/freshness-button";
import { useBackupActions } from "@/components/dashboard/storage/explorer/use-backup-actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewSwitch } from "@/components/ui/view-switch";
import { useIsMobileState } from "@/hooks/use-mobile";
import { useTableLayout } from "@/hooks/use-table-layout";
import type { TablePreferences, ViewMode } from "@/lib/core/table-preferences";
import type {
    BackupRun,
    DestinationBackup,
    ExplorerBackups,
    ExplorerDestination,
    ExplorerDestinationView,
    ExplorerFile,
    ExplorerIndex,
    ExplorerPlan,
    RunExecution,
} from "@/services/storage/explorer-types";

type PageTab = "backups" | "destinations";
type DestinationTab = "backups" | "history" | "alerts";
type Display = "table" | "timeline";

/** How often the page asks again while destinations are listed in the background, and for how long at most. */
const POLL_MS = 3_000;
const MAX_POLLS = 60;

/** The views of the list of backups: the table, the cards and the timeline of jobs and days above the list. */
const VIEWS: ViewMode[] = ["table", "cards", "timeline"];

interface StorageClientProps {
    canDownload: boolean;
    canRestore: boolean;
    canDelete: boolean;
    /** Whether this user may create vault profiles, which key recovery does. */
    canManageVault?: boolean;
    canViewHistory?: boolean;
    /** The column layout of the list of backups this user saved, null for the defaults. */
    initialLayout: TablePreferences | null;
    /** The view of the list of backups this user picked last. */
    initialView: ViewMode;
}

/** The backups of a chain, oldest first, out of the files the page has. */
function chainOf(file: ExplorerFile, files: ExplorerFile[]): ExplorerFile[] | null {
    const id = file.chain?.id;
    if (!id) return null;
    return files.filter((entry) => entry.chain?.id === id).sort((a, b) => (a.chain?.index ?? 0) - (b.chain?.index ?? 0));
}

function PageSkeleton() {
    return (
        <div className="space-y-4 md:space-y-6" aria-busy="true">
            <span className="sr-only">Loading the backups</span>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-5">
                {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="space-y-2 bg-card px-4 py-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-5 w-20" />
                    </div>
                ))}
            </div>
            <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-8 w-40" />
                </div>
                {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="flex items-center gap-4 py-1.5">
                        <Skeleton className="h-4 w-44" />
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="ml-auto h-4 w-16" />
                        <Skeleton className="h-5 w-40 rounded-md" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-dashed bg-card px-4 py-16 text-center shadow-sm">
            <HardDrive className="mx-auto mb-4 size-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="font-medium">{title}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p>
        </div>
    );
}

/** Switches the backups of a destination between the list and the list under a timeline. */
function DisplaySwitch({ value, onChange }: { value: Display; onChange: (next: Display) => void }) {
    return (
        <Tabs value={value} onValueChange={(next) => onChange(next as Display)}>
            <TabsList aria-label="View">
                <TabsTrigger value="table" aria-label="List view" title="List" className="px-2.5">
                    <List />
                </TabsTrigger>
                <TabsTrigger value="timeline" aria-label="Timeline view" title="Timeline" className="px-2.5">
                    <ChartGantt />
                </TabsTrigger>
            </TabsList>
        </Tabs>
    );
}

/**
 * The Storage Explorer: every backup of every job in one list, with the job and the destination as
 * its filters, and the destinations with their history and alerts. Both come from the lists DBackup
 * keeps of every destination. The filters, the tab and the picked destination live in the address.
 */
export function StorageClient({
    canDownload,
    canRestore,
    canDelete,
    canManageVault = false,
    canViewHistory = false,
    initialLayout,
    initialView,
}: StorageClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const index = useExplorerData<ExplorerIndex>("/api/storage/explorer");
    const historyRef = useRef<StorageHistoryTabRef>(null);
    const settingsRef = useRef<StorageSettingsTabRef>(null);
    const columnLayout = useTableLayout(BACKUPS_TABLE_ID, initialLayout);
    const [view, setView] = useState<ViewMode>(VIEWS.includes(initialView) ? initialView : "table");
    // A phone has no room for the table, so it always gets the cards and no switch. The list
    // waits until the screen is measured, so a phone never flashes the table first.
    const isMobile = useIsMobileState();
    const shownView: ViewMode | undefined = isMobile === undefined ? undefined : isMobile ? "cards" : view;

    const jobs = useMemo(() => index.data?.jobs ?? [], [index.data]);
    const destinations = useMemo(() => index.data?.destinations ?? [], [index.data]);
    const jobsByKey = useMemo(() => new Map(jobs.map((job) => [job.key, job])), [jobs]);
    const destinationsById = useMemo(() => new Map(destinations.map((destination) => [destination.id, destination])), [destinations]);

    // What the address asks for. A link to the backups of a job may name the job by its name, and
    // older links name one of its destinations beside it, which becomes the destination filter.
    const jobParams = searchParams.getAll("job").join("\n");
    const atParams = searchParams.getAll("at").join("\n");
    const byParams = searchParams.getAll("by").join("\n");
    const destinationParam = searchParams.get("destination");
    const pageTab: PageTab = !jobParams && destinationParam ? "destinations" : "backups";
    const scope = useMemo<BackupScope>(() => {
        const named = jobParams ? jobParams.split("\n") : [];
        const at = atParams ? atParams.split("\n") : [];
        return {
            jobs: named.map((value) => (jobsByKey.has(value) ? value : jobs.find((job) => job.kind === "job" && job.name === value)?.key ?? value)),
            at: pageTab === "backups" && destinationParam && !at.includes(destinationParam) ? [...at, destinationParam] : at,
            by: byParams ? byParams.split("\n") : [],
        };
    }, [jobParams, atParams, byParams, destinationParam, pageTab, jobs, jobsByKey]);

    const display: Display = searchParams.get("view") === "timeline" ? "timeline" : "table";
    const tabParam = searchParams.get("tab");
    const tab: DestinationTab = tabParam === "history" || tabParam === "alerts" ? tabParam : "backups";
    const layout: DestinationLayout = searchParams.get("layout") === "all" ? "all" : "folders";
    const folderParam = searchParams.get("folder");
    const destination = pageTab === "destinations" ? destinationsById.get(destinationParam ?? "") ?? destinations[0] ?? null : null;

    const setParams = useCallback((next: Record<string, string | string[] | null>) => {
        const params = new URLSearchParams(searchParams.toString());
        for (const [key, value] of Object.entries(next)) {
            params.delete(key);
            if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
            else if (value !== null) params.set(key, value);
        }
        const query = params.toString();
        router.replace(query ? `/dashboard/storage?${query}` : "/dashboard/storage", { scroll: false });
    }, [router, searchParams]);

    const backups = useExplorerData<ExplorerBackups>(pageTab === "backups" ? "/api/storage/explorer/runs" : null);
    const destinationView = useExplorerData<ExplorerDestinationView>(destination && tab === "backups" ? `/api/storage/explorer/destinations/${destination.id}` : null);
    // What the schedules plan and missed, only while the timeline shows.
    const plan = useExplorerData<ExplorerPlan>(pageTab === "backups" && shownView === "timeline" ? "/api/storage/explorer/plan" : null);

    const { reload: reloadIndex } = index;
    const { reload: reloadBackups } = backups;
    const { reload: reloadDestination } = destinationView;
    const { reload: reloadPlan } = plan;
    const reloadAll = useCallback(() => {
        reloadIndex();
        reloadBackups();
        reloadDestination();
        reloadPlan();
    }, [reloadIndex, reloadBackups, reloadDestination, reloadPlan]);

    const actions = useBackupActions({ canDownload, canRestore, canDelete, canManageVault, destinations: destinationsById, onChanged: reloadAll });
    const { handlersFor: handlersForTarget, askDelete } = actions;
    const handlersFor = useCallback((file: ExplorerFile, destinationId: string) => handlersForTarget({ file, destinationId }), [handlersForTarget]);

    const changeView = useCallback((next: ViewMode) => {
        setView(next);
        saveViewLayout(BACKUPS_PAGE_ID, next)
            .then((result) => result.success)
            .catch(() => false)
            .then((saved) => {
                if (!saved) toast.error("Your view could not be saved.");
            });
    }, []);

    // The panel follows its backup, so a reload after a lock or a check shows the new state.
    const [details, setDetails] = useState<{ open: boolean; key: string; path: string } | null>(null);
    const detailsRun = pageTab === "backups" && details && backups.data ? backups.data.runs.find((run) => runKey(run) === details.key) ?? null : null;
    // History keeps no index by path, so the run that made a backup is asked for when its details open.
    const execution = useExplorerData<RunExecution | null>(detailsRun ? `/api/storage/explorer/execution?path=${encodeURIComponent(detailsRun.path)}` : null);
    const detailsData = useMemo<BackupDetailsData | null>(() => {
        if (!details) return null;
        if (pageTab === "backups") {
            if (!detailsRun || !backups.data) return null;
            // A restore from the panel reads from a copy whose destination answers right now.
            const primary = primaryCopy(detailsRun, scope.at, byAnswer(destinationsById));
            const siblings = backups.data.runs.filter((run) => run.jobKey === detailsRun.jobKey).map((run) => run.file);
            return {
                file: primary.file,
                destinationId: primary.destinationId,
                copies: detailsRun.copies,
                job: jobsByKey.get(detailsRun.jobKey) ?? null,
                chain: chainOf(detailsRun.file, siblings),
                execution: execution.data ?? null,
            };
        }
        if (destinationView.data && destination) {
            const backup = destinationView.data.backups.find((entry) => entry.file.path === details.path);
            if (!backup) return null;
            const siblings = destinationView.data.backups.filter((entry) => entry.jobKey === backup.jobKey).map((entry) => entry.file);
            return {
                file: backup.file,
                destinationId: destination.id,
                copies: [{ destinationId: destination.id, state: "stored" as const, file: backup.file }, ...backup.elsewhere],
                job: jobsByKey.get(backup.jobKey) ?? null,
                chain: chainOf(backup.file, siblings),
                execution: null,
            };
        }
        return null;
    }, [details, pageTab, detailsRun, backups.data, scope.at, execution.data, destinationView.data, destination, jobsByKey, destinationsById]);

    const openPath = details?.open ? details.path : null;
    const openRun = useCallback((run: BackupRun) => setDetails({ open: true, key: runKey(run), path: run.path }), []);
    const openBackup = useCallback((backup: DestinationBackup) => setDetails({ open: true, key: backup.file.path, path: backup.file.path }), []);

    // How fresh the lists are that the page shows: those of the filtered destinations, of the
    // destinations of the filtered jobs, or of every destination.
    const freshnessList = useMemo<ExplorerDestination[]>(() => {
        if (pageTab === "destinations") return destination ? [destination] : [];
        if (scope.at.length > 0) return scope.at.map((id) => destinationsById.get(id)).filter((entry): entry is ExplorerDestination => entry !== undefined);
        if (scope.jobs.length > 0) {
            const ids = new Set(scope.jobs.flatMap((key) => destinationsOf(jobsByKey.get(key) ?? null, destinationsById).map((entry) => entry.id)));
            return destinations.filter((entry) => ids.has(entry.id));
        }
        return destinations;
    }, [pageTab, destination, scope, destinations, destinationsById, jobsByKey]);
    const onCheckNow = useCallback(async () => {
        try {
            await checkNow(freshnessList);
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "The destinations could not be checked");
        }
        reloadAll();
    }, [freshnessList, reloadAll]);
    const onCheckDestination = useCallback(async (destinationId: string) => {
        const target = destinationsById.get(destinationId);
        if (!target) return;
        try {
            await checkNow([target]);
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : `${target.name} could not be checked`);
        }
        reloadAll();
    }, [destinationsById, reloadAll]);

    // While destinations are listed in the background the page asks again, so their backups show
    // up as soon as they are in. A listing that hangs does not keep it asking forever.
    const listingIds = destinations.filter((entry) => entry.listing).map((entry) => entry.id).join(",");
    const polls = useRef(0);
    useEffect(() => {
        if (!listingIds) {
            polls.current = 0;
            return;
        }
        if (polls.current >= MAX_POLLS) return;
        const timer = setTimeout(() => {
            polls.current += 1;
            reloadAll();
        }, POLL_MS);
        return () => clearTimeout(timer);
    }, [listingIds, index.data, reloadAll]);

    const backupCount = jobs.reduce((sum, entry) => sum + entry.runs, 0);

    if (index.loading) {
        return (
            <div className="space-y-4 md:space-y-6">
                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                    <Skeleton className="h-9 w-56" />
                    <Skeleton className="ml-auto h-9 w-40" />
                </div>
                <PageSkeleton />
            </div>
        );
    }

    if (!index.data) {
        return (
            <Empty title="The backups could not be loaded">
                {index.error ?? "Something went wrong."}{" "}
                <Button variant="link" className="h-auto p-0" onClick={reloadIndex}>Try again</Button>
            </Empty>
        );
    }

    if (jobs.length === 0 && destinations.length === 0) {
        return (
            <Empty title="No destinations yet">
                Backups appear here once a job has written to a destination. Add a destination on the Connections page and a job that uses it.
            </Empty>
        );
    }

    return (
        <div className="space-y-4 md:space-y-6">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <Tabs
                    value={pageTab}
                    onValueChange={(next) => {
                        setDetails(null);
                        setParams(next === "backups"
                            ? { destination: null, tab: null, layout: null, folder: null, view: null }
                            : { destination: destination?.id ?? destinations[0]?.id ?? null, job: null, at: null, by: null });
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
                {pageTab === "destinations" && (
                    <div className="order-last w-full min-w-0 md:order-0 md:w-auto">
                        <ExplorerPicker
                            destinations={destinations}
                            value={destination?.id ?? null}
                            onChange={(value) => {
                                setDetails(null);
                                setParams({ destination: value, folder: null });
                            }}
                        />
                    </div>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {(pageTab === "backups" || tab === "backups") && <FreshnessButton destinations={freshnessList} onCheckNow={onCheckNow} />}
                    {pageTab === "destinations" && (
                        <Tabs value={tab} onValueChange={(next) => setParams({ tab: next === "backups" ? null : next, folder: null })}>
                            <TabsList aria-label="About this destination">
                                <TabsTrigger value="backups">Backups</TabsTrigger>
                                <TabsTrigger value="history">History</TabsTrigger>
                                <TabsTrigger value="alerts">Alerts</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    )}
                    {pageTab === "destinations" && tab !== "backups" && (
                        <Button
                            variant="outline"
                            className="size-9 p-0"
                            aria-label="Refresh"
                            onClick={() => (tab === "history" ? historyRef.current?.refresh() : settingsRef.current?.refresh())}
                        >
                            <RotateCw />
                        </Button>
                    )}
                    {/* Hidden by CSS rather than by the measured screen, so neither pops in after loading. */}
                    {pageTab === "destinations" && tab === "backups" && (
                        <div className="hidden md:block">
                            <DisplaySwitch value={display} onChange={(next) => setParams({ view: next === "table" ? null : next })} />
                        </div>
                    )}
                    {pageTab === "backups" && (
                        <div className="hidden md:block">
                            <ViewSwitch value={view} onChange={changeView} views={VIEWS} />
                        </div>
                    )}
                </div>
            </div>

            {pageTab === "backups" && (
                backups.loading || !backups.data || !shownView ? (
                    backups.error ? <Empty title="The backups could not be loaded">{backups.error}</Empty> : <PageSkeleton />
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
                        onOpen={openRun}
                        onRefresh={reloadAll}
                        refreshing={backups.reloading}
                        onChanged={reloadAll}
                    />
                )
            )}

            {pageTab === "destinations" && destination && tab === "backups" && (
                destinationView.loading || !destinationView.data ? (
                    destinationView.error ? <Empty title="The backups could not be loaded">{destinationView.error}</Empty> : <PageSkeleton />
                ) : (
                    <DestinationBackups
                        key={destinationView.data.destination.id}
                        view={destinationView.data}
                        jobs={jobsByKey}
                        destinations={destinationsById}
                        display={display}
                        layout={layout}
                        onLayout={(next) => setParams({ layout: next === "folders" ? null : next, folder: null })}
                        folder={folderParam}
                        onFolder={(key) => setParams({ folder: key })}
                        canDelete={canDelete}
                        handlersFor={handlersFor}
                        askDelete={askDelete}
                        onOpen={openBackup}
                        onOpenJob={(key) => {
                            setDetails(null);
                            setParams({ job: key, destination: null, at: null, by: null, folder: null, tab: null, layout: null, view: null });
                        }}
                        openPath={openPath}
                        onChanged={reloadAll}
                    />
                )
            )}
            {pageTab === "destinations" && destination && tab === "history" && (
                <StorageHistoryTab ref={historyRef} configId={destination.id} adapterName={destination.name} />
            )}
            {pageTab === "destinations" && destination && tab === "alerts" && (
                <StorageSettingsTab ref={settingsRef} configId={destination.id} adapterName={destination.name} />
            )}
            {pageTab === "destinations" && !destination && (
                <Empty title="No destinations yet">Add a destination on the Connections page, then its backups show here.</Empty>
            )}

            <BackupDetailsSheet
                open={details?.open ?? false}
                data={detailsData}
                onClose={() => setDetails((current) => (current ? { ...current, open: false } : null))}
                destinations={destinationsById}
                handlersFor={handlersFor}
                onCheckDestination={(id) => void onCheckDestination(id)}
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
