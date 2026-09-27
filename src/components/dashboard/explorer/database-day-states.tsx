"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarClock, CircleX, Clock, Loader2, Play, Unlink } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Banner } from "@/components/dashboard/storage/explorer/backup-details";
import type { TimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatBytes } from "@/lib/utils";
import type { DatabaseRun } from "@/services/databases/database-explorer-types";
import type { DayEntry } from "./database-day-model";
import { runHref } from "@/components/dashboard/history/run-links";

/**
 * What the panel of a day shows for a run without a backup to open: one that failed, one still
 * running, one only planned, or one whose backup is gone or may not be seen. Each points to the
 * kept backups around it.
 */

interface Nearby {
    before: DatabaseRun | null;
    after: DatabaseRun | null;
}

interface StateProps {
    entry: DayEntry;
    jobName: (id: string) => string;
    format: TimelineFormat;
    nearby: Nearby;
    canViewHistory: boolean;
    onShow: (run: DatabaseRun) => void;
}

function HistoryLink({ runId }: { runId: string }) {
    return (
        <Button variant="outline" size="sm" className="mt-1" asChild>
            <Link href={runHref(runId, "explorer")}>
                <ArrowUpRight />
                Open in History
            </Link>
        </Button>
    );
}

/** A kept backup around the entry, which a click shows in the panel instead. */
function NearbyBackup({ title, run, jobName, format, onShow }: { title: string; run: DatabaseRun; jobName: string; format: TimelineFormat; onShow: () => void }) {
    return (
        <section className="space-y-2">
            <p className="text-sm font-semibold">{title}</p>
            <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                    <CalendarClock className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{format.dateOf(run.startedAt)}, {format.time(run.startedAt)}</p>
                    <p className="truncate text-xs text-muted-foreground">{jobName}{run.size !== null ? ` · ${formatBytes(run.size)}` : ""}</p>
                </div>
                <Button variant="outline" size="sm" onClick={onShow}>Show</Button>
            </div>
        </section>
    );
}

/** The head of a state, in the place the title of a backup takes. */
function StateHead({ entry, jobName, format, state }: { entry: DayEntry; jobName: string; format: TimelineFormat; state: string }) {
    return (
        <div className="flex items-start gap-3 border-b p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                <CalendarClock className="size-5 text-muted-foreground" />
            </span>
            <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{format.dateOf(entry.at)}, {format.time(entry.at)}</h2>
                <p className="truncate text-sm text-muted-foreground">{jobName} · {state}</p>
            </div>
        </div>
    );
}

/** Where a run uploaded to and whether each upload worked. */
function Uploads({ run }: { run: DatabaseRun }) {
    if (run.destinations.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5">
            {run.destinations.map((destination) => (
                <span
                    key={destination.name}
                    className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium", destination.ok ? "bg-muted" : "border border-dashed border-warning/70 text-warning")}
                    title={destination.ok ? undefined : "The upload failed"}
                >
                    {destination.adapterId && <AdapterIcon adapterId={destination.adapterId} className="size-3" />}
                    {destination.name}
                </span>
            ))}
        </div>
    );
}

function Body({ children, nearby, jobName, format, onShow, skipAfter = false }: {
    children: React.ReactNode;
    nearby: Nearby;
    jobName: (id: string) => string;
    format: TimelineFormat;
    onShow: (run: DatabaseRun) => void;
    skipAfter?: boolean;
}) {
    return (
        <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-6 p-5">
                {children}
                {nearby.before && <NearbyBackup title="The backup before it" run={nearby.before} jobName={jobName(nearby.before.jobId)} format={format} onShow={() => onShow(nearby.before!)} />}
                {!skipAfter && nearby.after && <NearbyBackup title="The backup after it" run={nearby.after} jobName={jobName(nearby.after.jobId)} format={format} onShow={() => onShow(nearby.after!)} />}
            </div>
        </ScrollArea>
    );
}

export function FailedState({ entry, jobName, format, nearby, canViewHistory, onShow }: StateProps) {
    const run = entry.run!;
    return (
        <>
            <StateHead entry={entry} jobName={jobName(entry.jobId)} format={format} state="the run failed" />
            <Body nearby={nearby} jobName={jobName} format={format} onShow={onShow}>
                <Banner tone="warning" icon={CircleX} title="No backup was made" action={canViewHistory ? <HistoryLink runId={run.id} /> : undefined}>
                    <span className="break-words">{run.error ?? "The run logged no error message."}</span>
                </Banner>
            </Body>
        </>
    );
}

export function RunningState({ entry, jobName, format, nearby, canViewHistory, onShow }: StateProps) {
    const run = entry.run!;
    return (
        <>
            <StateHead entry={entry} jobName={jobName(entry.jobId)} format={format} state={run.status === "Pending" ? "waiting for its turn" : "running"} />
            <Body nearby={nearby} jobName={jobName} format={format} onShow={onShow} skipAfter>
                <Banner tone="neutral" icon={Loader2} title={run.status === "Pending" ? "The run waits in the queue" : `Running since ${format.time(run.startedAt)}`} action={canViewHistory ? <HistoryLink runId={run.id} /> : undefined}>
                    Its backup shows here once the run is done.
                </Banner>
            </Body>
        </>
    );
}

export function PlannedState({ entry, jobName, format, nearby, onShow, onRunNow, starting }: StateProps & { onRunNow?: () => void; starting: boolean }) {
    return (
        <>
            <StateHead entry={entry} jobName={jobName(entry.jobId)} format={format} state="planned" />
            <Body nearby={nearby} jobName={jobName} format={format} onShow={onShow} skipAfter>
                <Banner
                    tone="neutral"
                    icon={Clock}
                    title={`Planned at ${format.time(entry.at)}`}
                    action={(
                        <div className="flex flex-wrap gap-2 pt-1">
                            {onRunNow && (
                                <Button variant="outline" size="sm" onClick={onRunNow} disabled={starting}>
                                    {starting ? <Loader2 className="animate-spin" /> : <Play />}
                                    Run now
                                </Button>
                            )}
                            <Button variant="outline" size="sm" asChild>
                                <Link href={`/dashboard/jobs?job=${encodeURIComponent(entry.jobId)}`}>
                                    <CalendarClock />
                                    Open job
                                </Link>
                            </Button>
                        </div>
                    )}
                >
                    {jobName(entry.jobId)} backs it up then, as its schedule says.
                </Banner>
            </Body>
        </>
    );
}

/** A run that made a backup the panel cannot open: gone from every destination, or hidden from this viewer. */
export function FactsState({ entry, jobName, format, nearby, canViewHistory, onShow, reason }: StateProps & { reason: "gone" | "hidden" }) {
    const run = entry.run!;
    return (
        <>
            <StateHead entry={entry} jobName={jobName(entry.jobId)} format={format} state={run.size !== null ? formatBytes(run.size) : "backed up"} />
            <Body nearby={nearby} jobName={jobName} format={format} onShow={onShow}>
                <Banner
                    tone="neutral"
                    icon={Unlink}
                    title={reason === "gone" ? "No destination holds this backup anymore" : "Its backup is on the Backups page"}
                    action={canViewHistory ? <HistoryLink runId={run.id} /> : undefined}
                >
                    {reason === "gone"
                        ? "Retention or a deletion removed it. The run stays in History."
                        : "Restoring and downloading it needs the permission to see backups."}
                </Banner>
                <Uploads run={run} />
            </Body>
        </>
    );
}
