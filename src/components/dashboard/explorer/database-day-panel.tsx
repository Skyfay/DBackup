"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { BackupDetails, type BackupDetailsData } from "@/components/dashboard/storage/explorer/backup-details";
import { byAnswer, primaryCopy, targetsOf } from "@/components/dashboard/storage/explorer/backup-filters";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { useTimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import type { DayKey } from "@/components/dashboard/storage/explorer/timeline-model";
import { useBackupActions } from "@/components/dashboard/storage/explorer/use-backup-actions";
import { needsRestoreScopeChoice } from "@/components/dashboard/storage/restore-scope";
import { useRunJob } from "@/components/dashboard/widgets/use-run-job";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DatabaseOverview, DatabaseRun } from "@/services/databases/database-explorer-types";
import type { ExplorerBackup } from "@/services/storage/explorer-types";
import { useDatabaseData, useDatabaseRuns } from "./database-data";
import { dayEntries, dayTarget, nearbyBackups, panelSpan, pickEntry, runsOf, type DayEntry } from "./database-day-model";
import { FactsState, FailedState, PlannedState, RunningState } from "./database-day-states";

/** What the viewer may do with the backups of a day, resolved on the server. */
export interface DayPanelAccess {
    canOpenBackups: boolean;
    canRestore: boolean;
    canDownload: boolean;
    canDelete: boolean;
    canManageVault: boolean;
    canViewHistory: boolean;
    canExecute: boolean;
}

/** A database, instance or folded server, a day of it and the run the dropdown shows. */
export interface DayPick {
    key: string;
    day: DayKey;
    run: string | null;
}

const DOTS: Record<string, string> = {
    Success: "bg-success",
    Partial: "bg-warning",
    Failed: "bg-destructive",
    // Pulsing gray like a running day on the timeline.
    Running: "animate-pulse bg-foreground/40",
    Pending: "bg-muted-foreground",
};

function PanelSkeleton() {
    return (
        <div className="space-y-4 p-5" aria-busy="true">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
        </div>
    );
}

/** The backup a kept run made, with the details and actions of the side panel of the Backups page. */
function DayBackup({ run, picked, access, fallback }: {
    run: DatabaseRun & { path: string };
    /** The database the day was picked for, null for an instance or a server. */
    picked: string | null;
    access: DayPanelAccess;
    /** What shows when no destination holds the backup anymore. */
    fallback: React.ReactNode;
}) {
    const loaded = useDatabaseData<ExplorerBackup>(`/api/storage/explorer/backup?path=${encodeURIComponent(run.path)}`, "The backup could not be loaded.");
    const destinations = useMemo(() => new Map((loaded.data?.destinations ?? []).map((destination) => [destination.id, destination])), [loaded.data]);
    const backup = loaded.data?.run ?? null;
    const actions = useBackupActions({
        canDownload: access.canDownload,
        canRestore: access.canRestore,
        canDelete: access.canDelete,
        canManageVault: access.canManageVault,
        destinations,
        onChanged: loaded.reload,
        canViewHistory: access.canViewHistory,
        copiesOf: () => backup?.copies ?? [],
    });

    if (loaded.loading) return <PanelSkeleton />;
    if (!loaded.data) return <p className="p-5 text-sm text-muted-foreground">{loaded.error ?? "The backup could not be loaded."}</p>;
    if (!backup) return <>{fallback}</>;

    const primary = primaryCopy(backup, [], byAnswer(destinations));
    const data: BackupDetailsData = {
        file: primary.file,
        destinationId: primary.destinationId,
        copies: backup.copies,
        job: loaded.data.job,
        chain: loaded.data.chain,
        execution: { id: run.id, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt },
    };
    return (
        <>
            <BackupDetails
                frame="panel"
                data={data}
                destinations={destinations}
                handlersFor={(file, destinationId) => actions.handlersFor({ file, destinationId })}
                onDeleteEverywhere={access.canDelete ? () => actions.askDelete(targetsOf(backup, []), "Delete this backup everywhere?") : undefined}
                canViewHistory={access.canViewHistory}
                picked={picked ? {
                    name: picked,
                    onRestore: access.canRestore ? () => actions.restore(primary, needsRestoreScopeChoice(primary.file.combined) ? "databases" : undefined, [picked]) : undefined,
                } : null}
            />
            {actions.dialogs}
        </>
    );
}

interface DatabaseDayPanelProps {
    /** A card beside the timeline, or the whole of a Sheet on screens too narrow for both. */
    frame?: "docked" | "sheet";
    pick: DayPick;
    overview: DatabaseOverview;
    access: DayPanelAccess;
    /** Shows another run of the same day. */
    onRun: (runId: string) => void;
    /** Shows a run of another day, like the backup before a failed run. */
    onShow: (day: DayKey, runId: string) => void;
    onClose: () => void;
}

/**
 * The backups of a day picked on the timeline, beside it. A dropdown in the top right lists the
 * runs of that day by time, however many there are, and the panel shows the one picked: its
 * backup like the side panel of the Backups page, or why there is none.
 */
export function DatabaseDayPanel({ frame = "docked", pick, overview, access, onRun, onShow, onClose }: DatabaseDayPanelProps) {
    const format = useTimelineFormat();
    const { runJob, startingJobId } = useRunJob("explorer");
    const target = useMemo(() => dayTarget(pick.key, overview), [pick.key, overview]);
    const span = panelSpan(pick.day);
    const runs = useDatabaseRuns(target ? `/api/databases/runs?from=${encodeURIComponent(span.from)}&until=${encodeURIComponent(span.until)}&errors=1` : null);
    const jobsById = useMemo(() => new Map(overview.jobs.map((job) => [job.id, job])), [overview.jobs]);
    const jobName = (id: string) => jobsById.get(id)?.name ?? "A deleted job";

    const mine = useMemo(() => (target && runs.data ? runsOf(target, runs.data.runs) : []), [target, runs.data]);
    const entries = useMemo(
        () => (target && runs.data ? dayEntries(target, mine, runs.data.planned, pick.day, format.dayOf, Date.now()) : []),
        [target, runs.data, mine, pick.day, format],
    );
    const entry = pickEntry(entries, pick.run);
    const done = entries.filter((item) => item.run !== null).length;
    const planned = entries.length - done;
    const summary = runs.data ? `${count(done, "run")}${planned > 0 ? `, ${planned} planned` : ""}` : " ";

    const show = (run: DatabaseRun) => onShow(format.dayOf(run.startedAt), run.id);
    const nearby = entry ? nearbyBackups(mine, entry.at) : { before: null, after: null };
    const stateProps = entry ? { entry, jobName, format, nearby, canViewHistory: access.canViewHistory, onShow: show } : null;

    let content: React.ReactNode;
    if (!target) {
        content = <p className="p-5 text-sm text-muted-foreground">This database is no longer listed.</p>;
    } else if (runs.loading) {
        content = <PanelSkeleton />;
    } else if (!runs.data) {
        content = <p className="p-5 text-sm text-muted-foreground">{runs.error ?? "The runs could not be loaded."}</p>;
    } else if (!entry || !stateProps) {
        content = <p className="p-5 text-sm text-muted-foreground">Nothing ran that day.</p>;
    } else if (!entry.run) {
        const job = jobsById.get(entry.jobId);
        content = (
            <PlannedState
                {...stateProps}
                starting={startingJobId === entry.jobId}
                onRunNow={access.canExecute && job ? () => void runJob(job.id, job.name) : undefined}
            />
        );
    } else if (entry.run.status === "Failed") {
        content = <FailedState {...stateProps} />;
    } else if (entry.run.status === "Running" || entry.run.status === "Pending") {
        content = <RunningState {...stateProps} />;
    } else if (!access.canOpenBackups || !entry.run.path) {
        content = <FactsState {...stateProps} reason={access.canOpenBackups ? "gone" : "hidden"} />;
    } else {
        content = (
            <DayBackup
                key={entry.run.id}
                run={{ ...entry.run, path: entry.run.path }}
                picked={target.database}
                access={access}
                fallback={<FactsState {...stateProps} reason="gone" />}
            />
        );
    }

    return (
        <div className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground", frame === "docked" && "rounded-xl border shadow-sm")}>
            <div className="flex shrink-0 items-center gap-3 border-b bg-page/60 px-4 py-3">
                {target && <AdapterIcon adapterId={target.adapterId} className="size-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{target?.name ?? "Database"}</p>
                    <p className="truncate text-xs text-muted-foreground">{format.date(pick.day)} · {summary}</p>
                </div>
                {entries.length > 0 && entry && (
                    <Select value={entry.id} onValueChange={onRun}>
                        <SelectTrigger size="sm" className="h-8 w-44 shrink-0" aria-label="Run of that day">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                            {entries.map((item: DayEntry) => (
                                <SelectItem key={item.id} value={item.id}>
                                    <span className="flex min-w-0 items-center gap-2">
                                        <span
                                            className={cn("size-2 shrink-0 rounded-full", item.run ? DOTS[item.run.status] : "border border-dashed border-muted-foreground")}
                                            aria-hidden="true"
                                        />
                                        <span className="tabular-nums">{format.time(item.at)}</span>
                                        <span className="truncate text-muted-foreground">{jobName(item.jobId)}</span>
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Close the day" onClick={onClose}>
                    <X />
                </Button>
            </div>
            {content}
        </div>
    );
}
