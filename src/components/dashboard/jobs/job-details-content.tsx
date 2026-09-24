"use client";

import Link from "next/link";
import { CalendarClock, CircleAlert, FolderInput, Loader2, Pencil, Play, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { DetailStats, FactList, Section, type DetailStat } from "@/components/adapter/connection-details-sections";
import { getStatusStyle } from "@/components/dashboard/widgets/execution-status";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { DateDisplay } from "@/components/utils/date-display";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { destinationsText, NextRun, sourceOf } from "./job-cells";
import { retentionLabel } from "./job-retention";
import { JobRunChart, typicalLength, useJobRuns } from "./job-run-chart";
import { describeSchedule } from "./job-schedule";

const COMPRESSION: Record<string, string> = { NONE: "None", GZIP: "Gzip", BROTLI: "Brotli" };
const DAY_MS = 24 * 60 * 60 * 1000;
const typeName = (adapterId: string) => getAdapterDefinition(adapterId)?.name ?? adapterId;
const soon = (date: string) => new Date(date).getTime() - Date.now() < DAY_MS;

const HEALTH: Record<string, { label: string; dot: string; text: string }> = {
    ONLINE: { label: "Online", dot: "bg-success", text: "text-muted-foreground" },
    DEGRADED: { label: "Degraded", dot: "bg-warning", text: "text-warning" },
    OFFLINE: { label: "Offline", dot: "bg-destructive", text: "text-destructive" },
};

/** Who compresses: DBackup, PostgreSQL itself for a dump on its own, or nobody. */
function compressionOf(job: JobListItem): string {
    const byPostgres = job.source?.adapterId === "postgres" && job.sources.length === 0 && job.compression === "NONE" && job.pgCompression !== "NONE";
    return byPostgres ? "By PostgreSQL" : COMPRESSION[job.compression] ?? job.compression;
}

function databasesOf(job: JobListItem): string {
    try {
        const parsed: unknown = JSON.parse(job.databases);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.join(", ");
    } catch {
        // An unreadable list backs up everything, like an empty one.
    }
    return "All databases";
}

function Row({ icon, title, detail, aside }: { icon: React.ReactNode; title: string; detail: string; aside?: React.ReactNode }) {
    return (
        <li className="flex items-center gap-3 px-3 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">{icon}</span>
            <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{title}</span>
                <span className="block truncate text-xs text-muted-foreground" title={detail}>{detail}</span>
            </div>
            {aside}
        </li>
    );
}

/** Why the job needs a look, with the error of its last run. */
function RunIssue({ job, canViewHistory }: { job: JobListItem; canViewHistory: boolean }) {
    const failed = job.overview.status === "Failed";
    const Icon = failed ? CircleAlert : TriangleAlert;
    const lastRun = job.overview.lastRun;
    return (
        <div className={cn("relative flex gap-3 overflow-hidden rounded-lg border p-3 pl-4", failed ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5")}>
            <span className={cn("absolute inset-y-0 left-0 w-1", failed ? "bg-destructive" : "bg-warning")} aria-hidden="true" />
            <Icon className={cn("mt-0.5 size-4 shrink-0", failed ? "text-destructive" : "text-warning")} aria-hidden="true" />
            <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium">{failed ? "The last run failed" : "The last run reached only some destinations"}</p>
                <p className="text-muted-foreground wrap-anywhere">{job.overview.error}</p>
                {canViewHistory && lastRun && (
                    <Link href={`/dashboard/history?executionId=${lastRun.id}`} className="inline-block font-medium hover:underline hover:underline-offset-4">
                        Open the run
                    </Link>
                )}
            </div>
        </div>
    );
}

function LiveRunBox({ job, canViewHistory }: { job: JobListItem; canViewHistory: boolean }) {
    const live = job.overview.live!;
    return (
        <div className="rounded-lg border border-info/30 bg-info/5 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{live.status === "Pending" ? "Waiting for its turn" : `Running · ${live.stage ?? "Starting"}`}</span>
                {canViewHistory && (
                    <Link href={`/dashboard/history?executionId=${live.executionId}`} className="shrink-0 font-medium hover:underline hover:underline-offset-4">
                        Open the run
                    </Link>
                )}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-info transition-[width]" style={{ width: `${live.progress ?? 0}%` }} />
            </div>
        </div>
    );
}

export interface JobDetailsProps {
    job: JobListItem;
    canViewHistory: boolean;
    onRun?: () => void;
    starting?: boolean;
    onEdit?: () => void;
    /** The rest of the actions, behind the button at the end of the header. */
    menu: React.ReactNode;
}

/** The details of one job, for the panel that a click on a job opens. */
export function JobDetailsContent({ job, canViewHistory, onRun, starting = false, onEdit, menu }: JobDetailsProps) {
    const history = useJobRuns(job.id, job.overview.lastRun?.id);
    const schedule = describeSchedule(job.schedulePreset?.schedule ?? job.schedule).text;
    const source = sourceOf(job);
    const style = getStatusStyle(job.overview.status);
    const typical = history ? typicalLength(history.runs) : null;
    const rate = history?.successRate;

    const stats: DetailStat[] = [
        {
            label: "Last run",
            value: job.overview.status ? style.label : "Never ran",
            extra: job.overview.lastRun ? <RelativeTime date={job.overview.lastRun.startedAt} /> : undefined,
            className: job.overview.status ? style.text : "text-muted-foreground",
        },
        {
            label: "Success, 30 days",
            value: rate && rate.total > 0 ? `${Math.round((rate.succeeded / rate.total) * 100)}%` : "-",
            extra: rate ? `${rate.succeeded} of ${rate.total} runs` : undefined,
        },
        {
            label: "Next run",
            value: job.enabled && job.overview.nextRunAt ? <DateDisplay date={job.overview.nextRunAt} format={soon(job.overview.nextRunAt) ? "p" : "P"} /> : <NextRun job={job} />,
            extra: job.enabled && job.overview.nextRunAt ? <RelativeTime date={job.overview.nextRunAt} /> : undefined,
        },
        {
            label: "Last backup",
            value: history?.lastSuccess?.size != null ? formatBytes(history.lastSuccess.size, 1) : "-",
            extra: history?.lastSuccess ? <RelativeTime date={history.lastSuccess.at} /> : undefined,
        },
    ];

    const facts: { label: string; value: React.ReactNode }[] = [
        { label: "Encryption", value: job.encryptionProfile?.name ?? "Not encrypted" },
        { label: "Compression", value: compressionOf(job) },
        {
            label: "Notifies",
            value: job.notificationTemplates.length > 0
                ? job.notificationTemplates.map((entry) => entry.template.name).join(", ")
                : job.notifications.length > 0 ? job.notifications.map((channel) => channel.name).join(", ") : "Nobody",
        },
        { label: "File names", value: job.namingTemplate?.name ?? "Default template" },
        { label: "Integrity checks", value: job.skipVerification ? "Left out" : "Included" },
        ...(job.sources.length > 0 ? [{ label: "Incremental", value: job.backupMode === "INCREMENTAL" ? `Full every ${job.fullEveryDays} days` : "Off" }] : []),
        { label: "Added", value: <DateDisplay date={job.createdAt} format="P" /> },
    ];

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                        <CalendarClock className="size-5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                        <SheetTitle className="truncate text-lg font-semibold">{job.name}</SheetTitle>
                        <SheetDescription className="truncate text-sm text-muted-foreground">
                            {job.enabled ? schedule : `Paused · ${schedule}`} · {source.name} → {destinationsText(job)}
                        </SheetDescription>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {onRun && (
                        <Button variant="outline" size="sm" onClick={onRun} disabled={starting}>
                            {starting ? <Loader2 className="animate-spin" /> : <Play />}
                            Run now
                        </Button>
                    )}
                    {onEdit && (
                        <Button variant="outline" size="sm" onClick={onEdit}>
                            <Pencil />
                            Edit
                        </Button>
                    )}
                    {menu}
                </div>
            </SheetHeader>

            {/* Block instead of Radix's `display: table` wrapper, so long names and errors are cut off or wrap. */}
            <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
                <div className="space-y-6 p-5">
                    {job.overview.live ? <LiveRunBox job={job} canViewHistory={canViewHistory} /> : job.overview.error && <RunIssue job={job} canViewHistory={canViewHistory} />}

                    <DetailStats stats={stats} surface="bg-background" />

                    <Section title={history ? `Last ${history.runs.length} runs` : "Last runs"} aside={typical !== null ? `about ${formatDuration(typical)} each` : undefined}>
                        {history === undefined ? <Skeleton className="h-24 w-full" /> : history === null ? (
                            <p className="text-sm text-destructive">The runs could not be loaded.</p>
                        ) : (
                            <JobRunChart runs={history.runs} />
                        )}
                    </Section>

                    <Section title="Source">
                        <ul className="divide-y rounded-lg border">
                            {job.source && (
                                <Row
                                    icon={<AdapterIcon adapterId={job.source.adapterId} className="size-4" />}
                                    title={job.source.name}
                                    detail={`${typeName(job.source.adapterId)} · ${databasesOf(job)}`}
                                />
                            )}
                            {job.sources.map((folder) => (
                                <Row
                                    key={`${folder.configId}:${folder.path}`}
                                    icon={<FolderInput className="size-4 text-muted-foreground" />}
                                    title={folder.config.name}
                                    detail={folder.path}
                                />
                            ))}
                        </ul>
                    </Section>

                    <Section title="Destinations" aside={job.destinations.length > 1 ? "in this order" : undefined}>
                        <ul className="divide-y rounded-lg border">
                            {job.destinations.map((destination) => {
                                const health = destination.config.lastStatus ? HEALTH[destination.config.lastStatus] : undefined;
                                return (
                                    <Row
                                        key={destination.configId}
                                        icon={<AdapterIcon adapterId={destination.config.adapterId} className="size-4" />}
                                        title={destination.config.name}
                                        detail={`${typeName(destination.config.adapterId)} · Retention: ${retentionLabel(destination)}`}
                                        aside={
                                            health && (
                                                <span className={cn("flex shrink-0 items-center gap-1.5 text-xs", health.text)}>
                                                    <span className={cn("size-1.5 rounded-full", health.dot)} aria-hidden="true" />
                                                    {health.label}
                                                </span>
                                            )
                                        }
                                    />
                                );
                            })}
                        </ul>
                    </Section>

                    <Section title="Settings">
                        <FactList facts={facts} />
                    </Section>
                </div>
            </ScrollArea>
        </>
    );
}
