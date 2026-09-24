"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, HardDrive, List, RotateCw, ChartGantt } from "lucide-react";
import { StorageHistoryTab, type StorageHistoryTabRef } from "@/components/dashboard/storage/storage-history-tab";
import { StorageSettingsTab, type StorageSettingsTabRef } from "@/components/dashboard/storage/storage-settings-tab";
import { BackupDetailsSheet, type BackupDetailsData } from "@/components/dashboard/storage/explorer/backup-details";
import { DestinationBackups } from "@/components/dashboard/storage/explorer/destination-backups";
import { checkNow, destinationsOf, useExplorerData } from "@/components/dashboard/storage/explorer/explorer-data";
import { ExplorerPicker, type ExplorerMode } from "@/components/dashboard/storage/explorer/explorer-picker";
import { FreshnessButton } from "@/components/dashboard/storage/explorer/freshness-button";
import { JobBackups, primaryCopy } from "@/components/dashboard/storage/explorer/job-backups";
import { useBackupActions } from "@/components/dashboard/storage/explorer/use-backup-actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
    DestinationBackup,
    ExplorerDestination,
    ExplorerDestinationView,
    ExplorerFile,
    ExplorerIndex,
    ExplorerJob,
    ExplorerJobView,
} from "@/services/storage/explorer-types";

type DestinationTab = "backups" | "history" | "alerts";
type Display = "table" | "timeline";

/** How often the page asks again while destinations are listed in the background, and for how long at most. */
const POLL_MS = 3_000;
const MAX_POLLS = 60;

interface StorageClientProps {
    canDownload: boolean;
    canRestore: boolean;
    canDelete: boolean;
    /** Whether this user may create vault profiles, which key recovery does. */
    canManageVault?: boolean;
    canViewHistory?: boolean;
}

/** The job the page opens on: the one with the newest backup. */
function defaultJob(jobs: ExplorerJob[]): ExplorerJob | null {
    const withBackups = jobs.filter((job) => job.newest !== null);
    if (withBackups.length === 0) return jobs.find((job) => job.kind === "job") ?? null;
    return withBackups.reduce((latest, job) => (Date.parse(job.newest!) > Date.parse(latest.newest!) ? job : latest));
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

/** Switches between the list and the list under a timeline. */
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
 * The Storage Explorer: the backups by job, with every copy of a run side by side, or by
 * destination, grouped by the job that made them. Both come from the lists DBackup keeps of every
 * destination. The picked job or destination, the tab and the view live in the address.
 */
export function StorageClient({ canDownload, canRestore, canDelete, canManageVault = false, canViewHistory = false }: StorageClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const index = useExplorerData<ExplorerIndex>("/api/storage/explorer");
    const historyRef = useRef<StorageHistoryTabRef>(null);
    const settingsRef = useRef<StorageSettingsTabRef>(null);

    const jobs = useMemo(() => index.data?.jobs ?? [], [index.data]);
    const destinations = useMemo(() => index.data?.destinations ?? [], [index.data]);
    const jobsByKey = useMemo(() => new Map(jobs.map((job) => [job.key, job])), [jobs]);
    const destinationsById = useMemo(() => new Map(destinations.map((destination) => [destination.id, destination])), [destinations]);

    // What the address asks for. A job may come by its name from older links, like the ones the
    // Jobs page used to make.
    const jobParam = searchParams.get("job");
    const destinationParam = searchParams.get("destination");
    const display: Display = searchParams.get("view") === "timeline" ? "timeline" : "table";
    const tabParam = searchParams.get("tab");
    const tab: DestinationTab = tabParam === "history" || tabParam === "alerts" ? tabParam : "backups";
    const jobByParam = jobParam ? jobsByKey.get(jobParam) ?? jobs.find((job) => job.kind === "job" && job.name === jobParam) ?? null : null;
    const mode: ExplorerMode = jobParam && (jobByParam || !destinationParam) ? "jobs" : destinationParam ? "destinations" : defaultJob(jobs) ? "jobs" : "destinations";
    const job = mode === "jobs" ? jobByParam ?? (jobParam ? null : defaultJob(jobs)) : null;
    const destination = mode === "destinations" ? destinationsById.get(destinationParam ?? "") ?? destinations[0] ?? null : null;

    const setParams = useCallback((next: Record<string, string | null>) => {
        const params = new URLSearchParams(searchParams.toString());
        for (const [key, value] of Object.entries(next)) {
            if (value === null) params.delete(key);
            else params.set(key, value);
        }
        router.replace(`/dashboard/storage?${params.toString()}`, { scroll: false });
    }, [router, searchParams]);

    const jobView = useExplorerData<ExplorerJobView>(job ? `/api/storage/explorer/jobs/${encodeURIComponent(job.key)}` : null);
    const destinationView = useExplorerData<ExplorerDestinationView>(destination && tab === "backups" ? `/api/storage/explorer/destinations/${destination.id}` : null);

    const { reload: reloadIndex } = index;
    const { reload: reloadJob } = jobView;
    const { reload: reloadDestination } = destinationView;
    const reloadAll = useCallback(() => {
        reloadIndex();
        reloadJob();
        reloadDestination();
    }, [reloadIndex, reloadJob, reloadDestination]);

    const actions = useBackupActions({ canDownload, canRestore, canDelete, canManageVault, destinations: destinationsById, onChanged: reloadAll });
    const { handlersFor: handlersForTarget, askDelete } = actions;
    const handlersFor = useCallback((file: ExplorerFile, destinationId: string) => handlersForTarget({ file, destinationId }), [handlersForTarget]);

    // The panel follows the path of its backup, so a reload after a lock or a check shows the new state.
    const [details, setDetails] = useState<{ open: boolean; path: string } | null>(null);
    const detailsData = useMemo<BackupDetailsData | null>(() => {
        if (!details) return null;
        if (mode === "jobs" && jobView.data) {
            const run = jobView.data.runs.find((entry) => entry.path === details.path);
            if (!run) return null;
            const primary = primaryCopy(run);
            return {
                file: primary.file,
                destinationId: primary.destinationId,
                copies: run.copies,
                job: jobView.data.job,
                chain: chainOf(run.file, jobView.data.runs.map((entry) => entry.file)),
                execution: run.execution,
            };
        }
        if (mode === "destinations" && destinationView.data && destination) {
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
    }, [details, mode, jobView.data, destinationView.data, destination, jobsByKey]);

    const openPath = details?.open ? details.path : null;
    const openRun = useCallback((run: { path: string }) => setDetails({ open: true, path: run.path }), []);
    const openBackup = useCallback((backup: DestinationBackup) => setDetails({ open: true, path: backup.file.path }), []);

    const freshnessList = useMemo<ExplorerDestination[]>(
        () => (mode === "jobs" ? destinationsOf(job, destinationsById) : destination ? [destination] : []),
        [mode, job, destination, destinationsById]
    );
    const onCheckNow = useCallback(async () => {
        try {
            await checkNow(freshnessList);
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "The destinations could not be checked");
        }
        reloadAll();
    }, [freshnessList, reloadAll]);

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

    const jobCount = jobs.filter((entry) => entry.kind === "job" || entry.kind === "deleted").length;

    if (index.loading) {
        return (
            <div className="space-y-4 md:space-y-6">
                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                    <Skeleton className="h-9 w-56" />
                    <Skeleton className="h-9 w-full md:w-104" />
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
                    value={mode}
                    onValueChange={(next) =>
                        setParams(next === "jobs"
                            ? { job: job?.key ?? defaultJob(jobs)?.key ?? null, destination: null, tab: null }
                            : { job: null, destination: destination?.id ?? destinations[0]?.id ?? null })}
                >
                    <TabsList aria-label="Show backups">
                        <TabsTrigger value="jobs">
                            <span className="flex items-center gap-2">
                                Jobs
                                <span className="text-xs font-normal text-muted-foreground tabular-nums">{jobCount}</span>
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
                <div className="order-last w-full min-w-0 md:order-0 md:w-auto">
                    <ExplorerPicker
                        mode={mode}
                        jobs={jobs}
                        destinations={destinations}
                        destinationsById={destinationsById}
                        value={mode === "jobs" ? job?.key ?? null : destination?.id ?? null}
                        onChange={(value) => {
                            setDetails(null);
                            setParams(mode === "jobs" ? { job: value } : { destination: value });
                        }}
                    />
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {(mode === "jobs" || tab === "backups") && <FreshnessButton destinations={freshnessList} onCheckNow={onCheckNow} />}
                    {mode === "destinations" && (
                        <Tabs value={tab} onValueChange={(next) => setParams({ tab: next === "backups" ? null : next })}>
                            <TabsList aria-label="About this destination">
                                <TabsTrigger value="backups">Backups</TabsTrigger>
                                <TabsTrigger value="history">History</TabsTrigger>
                                <TabsTrigger value="alerts">Alerts</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    )}
                    {mode === "destinations" && tab !== "backups" && (
                        <Button
                            variant="outline"
                            className="size-9 p-0"
                            aria-label="Refresh"
                            onClick={() => (tab === "history" ? historyRef.current?.refresh() : settingsRef.current?.refresh())}
                        >
                            <RotateCw />
                        </Button>
                    )}
                    {(mode === "jobs" || tab === "backups") && (
                        // A phone has no room for the timeline, so it always gets the list and no switch.
                        <div className="hidden md:block">
                            <DisplaySwitch value={display} onChange={(next) => setParams({ view: next === "table" ? null : next })} />
                        </div>
                    )}
                    {mode === "jobs" && job?.kind === "job" && (
                        <Button variant="outline" asChild className="hidden sm:inline-flex">
                            <Link href={`/dashboard/jobs?job=${encodeURIComponent(job.key)}`}>
                                <ArrowUpRight />
                                Open job
                            </Link>
                        </Button>
                    )}
                </div>
            </div>

            {mode === "jobs" && (
                !job ? (
                    <Empty title="This job has no backups">
                        It was deleted and none of its backups are left. Pick another job above.
                    </Empty>
                ) : jobView.loading || !jobView.data ? (
                    jobView.error ? <Empty title="The backups could not be loaded">{jobView.error}</Empty> : <PageSkeleton />
                ) : (
                    <JobBackups
                        view={jobView.data}
                        destinations={destinationsById}
                        display={display}
                        canDelete={canDelete}
                        handlersFor={handlersFor}
                        askDelete={askDelete}
                        onOpen={openRun}
                        openPath={openPath}
                        onChanged={reloadAll}
                    />
                )
            )}

            {mode === "destinations" && destination && tab === "backups" && (
                destinationView.loading || !destinationView.data ? (
                    destinationView.error ? <Empty title="The backups could not be loaded">{destinationView.error}</Empty> : <PageSkeleton />
                ) : (
                    <DestinationBackups
                        view={destinationView.data}
                        jobs={jobsByKey}
                        destinations={destinationsById}
                        display={display}
                        canDelete={canDelete}
                        handlersFor={handlersFor}
                        askDelete={askDelete}
                        onOpen={openBackup}
                        onOpenJob={(key) => {
                            setDetails(null);
                            setParams({ job: key, destination: null, tab: null });
                        }}
                        openPath={openPath}
                        onChanged={reloadAll}
                    />
                )
            )}
            {mode === "destinations" && destination && tab === "history" && (
                <StorageHistoryTab ref={historyRef} configId={destination.id} adapterName={destination.name} />
            )}
            {mode === "destinations" && destination && tab === "alerts" && (
                <StorageSettingsTab ref={settingsRef} configId={destination.id} adapterName={destination.name} />
            )}
            {mode === "destinations" && !destination && (
                <Empty title="No destinations yet">Add a destination on the Connections page, then its backups show here.</Empty>
            )}

            <BackupDetailsSheet
                open={details?.open ?? false}
                data={detailsData}
                onClose={() => setDetails((current) => (current ? { ...current, open: false } : null))}
                destinations={destinationsById}
                handlersFor={handlersFor}
                onDeleteEverywhere={mode === "jobs" && canDelete && detailsData
                    ? () => askDelete(
                        detailsData.copies.flatMap((copy) => (copy.state === "stored" && copy.file ? [{ file: copy.file, destinationId: copy.destinationId }] : [])),
                        detailsData.copies.filter((copy) => copy.state === "stored").length > 1 ? "Delete this backup at every destination?" : "Delete this backup?"
                    )
                    : undefined}
                canViewHistory={canViewHistory}
            />
            {actions.dialogs}
        </div>
    );
}
