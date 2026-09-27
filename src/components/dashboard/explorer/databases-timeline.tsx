"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Database } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { useTimelineFormat, type TimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import { TimelineAheadCaption, TimelineAxis, TimelineBands, gridTemplate, useColumns, useTimelineWindow } from "@/components/dashboard/storage/explorer/timeline-frame";
import type { DayKey } from "@/components/dashboard/storage/explorer/timeline-model";
import { AHEAD, TimelineNav, toDate } from "@/components/dashboard/storage/explorer/timeline-nav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipHead, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DatabaseRuns, ExplorerDatabase, ExplorerDbJob, ExplorerServer, VersionChange } from "@/services/databases/database-explorer-types";
import { engineOf } from "./database-columns";
import { useDatabaseData } from "./database-data";
import { buildTimeline, databaseHref, markOf, runsSpan, type DatabaseCell, type TimelineGroup } from "./database-model";

const KINDS: Record<DatabaseCell["kind"], string> = {
    none: "",
    ok: "bg-foreground/55 text-card",
    mixed: "bg-foreground/55 text-card",
    failed: "bg-destructive text-destructive-foreground",
    running: "animate-pulse bg-foreground/25",
    planned: "border-[1.5px] border-dashed border-foreground/45 text-muted-foreground",
};

function CellTip({ cell, database, jobsById, format }: { cell: DatabaseCell; database: ExplorerDatabase; jobsById: Map<string, ExplorerDbJob>; format: TimelineFormat }) {
    const ok = cell.runs.filter((run) => run.status === "Success" || run.status === "Partial");
    const failed = cell.runs.filter((run) => run.status === "Failed");
    const jobName = (id: string) => jobsById.get(id)?.name ?? "A deleted job";
    return (
        <>
            {failed.length > 0 && <TooltipHead tone="destructive">{failed.length === 1 ? "A run failed" : `${failed.length} runs failed`}</TooltipHead>}
            <p className={cn(failed.length === 0 && "font-medium")}>{database.name}, {format.date(cell.day)}</p>
            <div className="mt-1 space-y-1 text-muted-foreground">
                {ok.length > 0 && <p>{count(ok.length, "backup")} of it.</p>}
                {cell.runs.slice(0, 3).map((run) => (
                    <p key={run.id} className="truncate">{format.time(run.startedAt)} · {jobName(run.jobId)} · {run.status === "Partial" ? "a copy failed" : run.status.toLowerCase()}</p>
                ))}
                {cell.runs.length > 3 && <p>and {count(cell.runs.length - 3, "more run")}.</p>}
                {cell.planned.length > 0 && (
                    <p>{count(cell.planned.length, "run")} planned, the first at {format.time(cell.planned[0].at)} by {jobName(cell.planned[0].jobId)}.</p>
                )}
            </div>
        </>
    );
}

/** A day of a database, which opens its page with the runs of that day. */
function Cell({ cell, database, jobsById, format }: {
    cell: DatabaseCell;
    database: ExplorerDatabase;
    jobsById: Map<string, ExplorerDbJob>;
    format: TimelineFormat;
}) {
    const failed = cell.runs.filter((run) => run.status === "Failed").length;
    const ok = cell.runs.length - failed;
    const number = cell.kind === "failed" ? (failed > 1 ? failed : null) : cell.kind === "planned" ? (cell.planned.length > 1 ? cell.planned.length : null) : ok > 1 ? ok : null;
    const button = (
        <Link
            href={databaseHref(database, { day: cell.day })}
            aria-label={`${database.name}, ${format.date(cell.day)}`}
            className={cn(
                "relative flex h-7 w-full min-w-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums outline-none transition-shadow hover:ring-2 hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/50",
                KINDS[cell.kind],
                cell.kind === "ok" && ok > 1 && "bg-foreground/85"
            )}
        >
            {cell.kind === "none" ? <span className="size-1 rounded-full bg-foreground/20" /> : number}
            {cell.kind === "mixed" && <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-card bg-destructive" aria-hidden="true" />}
        </Link>
    );
    if (cell.kind === "none") return button;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
                <CellTip cell={cell} database={database} jobsById={jobsById} format={format} />
            </TooltipContent>
        </Tooltip>
    );
}

/**
 * The version a server was updated to on a day, small enough for the column of that day, so updates
 * on days in a row sit beside each other. More than one change that day shows as a count, the
 * hover names each.
 */
function VersionMark({ changes, format }: { changes: VersionChange[]; format: TimelineFormat }) {
    const { latest, earlier } = markOf(changes);
    const Arrow = latest.downgrade ? ArrowDown : ArrowUp;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    tabIndex={0}
                    aria-label={`${latest.downgrade ? "Downgraded" : "Updated"} to ${latest.newVersion}`}
                    className={cn(
                        "inline-flex h-5 max-w-full min-w-0 items-center gap-0.5 rounded-md border bg-card px-1 text-[10.5px] font-semibold tabular-nums shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        latest.downgrade && "border-warning/60 text-warning"
                    )}
                >
                    <Arrow className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{latest.newVersion}</span>
                    {earlier > 0 && <span className="shrink-0 text-muted-foreground">+{earlier}</span>}
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
                {latest.downgrade && <TooltipHead tone="warning">An older version than before</TooltipHead>}
                <p className={cn(!latest.downgrade && "font-medium")}>{changes.length === 1 ? "A new version" : `${changes.length} new versions`}, {format.dateOf(latest.detectedAt)}</p>
                <div className="mt-1 space-y-1 text-muted-foreground">
                    {changes.map((change) => (
                        <p key={change.detectedAt}>{change.previousVersion} → {change.newVersion}, read at {format.time(change.detectedAt)}</p>
                    ))}
                    <p>Backups made after it are only restored onto this version or a newer one.</p>
                </div>
            </TooltipContent>
        </Tooltip>
    );
}

function ServerGroup({ group, days, template, jobsById, format }: {
    group: TimelineGroup;
    days: DayKey[];
    template: React.CSSProperties;
    jobsById: Map<string, ExplorerDbJob>;
    format: TimelineFormat;
}) {
    const { server, rows, marks } = group;
    const covered = rows.filter((row) => row.database.jobIds.length > 0).length;
    return (
        <div role="group" aria-label={server.name}>
            <div className="grid items-center border-b bg-foreground/[0.025] px-5 py-1.5" style={template}>
                <div className="flex min-w-0 items-center gap-2 pr-3">
                    <AdapterIcon adapterId={server.adapterId} className="size-4 shrink-0" />
                    <span className="truncate text-sm font-semibold">{server.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{engineOf(server)} · {covered} of {rows.length} in a job</span>
                </div>
                {days.map((day) => (
                    <span key={day} className="flex min-w-0 justify-center">
                        {marks.has(day) && <VersionMark changes={marks.get(day) ?? []} format={format} />}
                    </span>
                ))}
            </div>
            <div className="relative">
                {marks.size > 0 && (
                    // A dashed line down through the databases of the server on the day it changed.
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid px-5" style={template}>
                        <span />
                        {days.map((day) => <span key={day} className={cn(marks.has(day) && "border-l border-dashed border-foreground/40")} />)}
                    </div>
                )}
                {rows.map(({ database, cells }) => {
                    const names = database.jobIds.map((id) => jobsById.get(id)?.name ?? "A deleted job");
                    return (
                        <div key={database.key} className="relative grid items-center border-b px-5 py-1.5" style={template}>
                            <Link
                                href={databaseHref(database)}
                                className="flex min-w-0 items-center gap-2.5 rounded-md pr-3 text-left outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                                <Database className={cn("size-4 shrink-0", names.length === 0 ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{database.name}</span>
                                    <span className={cn("block truncate text-xs", names.length === 0 ? "text-warning" : "text-muted-foreground")}>
                                        {names.length === 0 ? "In no job" : names.join(", ")}
                                    </span>
                                </span>
                            </Link>
                            {cells.map((cell) => <Cell key={cell.day} cell={cell} database={database} jobsById={jobsById} format={format} />)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

interface DatabasesTimelineProps {
    /** The databases the search and the filters leave. */
    databases: ExplorerDatabase[];
    servers: ExplorerServer[];
    jobs: ExplorerDbJob[];
}

/**
 * The timeline of the Databases tab: the databases by server, a column per day with the runs
 * that backed each up or failed, and at today the next days with what the schedules plan. A new
 * version of a server shows as a mark over its databases on the day it was read.
 */
export function DatabasesTimeline({ databases, servers, jobs }: DatabasesTimelineProps) {
    const format = useTimelineFormat();
    const { ref, cols } = useColumns();
    const today = format.dayOf(new Date().toISOString());
    const { days, last, ahead, toToday, back, forward, center } = useTimelineWindow(cols, today);
    const span = cols > 0 ? runsSpan(days[0], last) : null;
    const runs = useDatabaseData<DatabaseRuns>(span ? `/api/databases/runs?from=${encodeURIComponent(span.from)}&until=${encodeURIComponent(span.until)}` : null, "The runs could not be loaded.");
    const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

    const groups = useMemo(() => (runs.data
        ? buildTimeline({ databases, servers, jobs, runs: runs.data.runs, planned: runs.data.planned, versionChanges: runs.data.versionChanges, days, now: Date.now(), dayOf: format.dayOf })
        : []), [runs.data, databases, servers, jobs, days, format]);
    const problems = useMemo(() => {
        const failed = new Set((runs.data?.runs ?? []).filter((run) => run.status === "Failed").map((run) => format.dayOf(run.startedAt)));
        return [...failed].map(toDate);
    }, [runs.data, format]);

    const template = gridTemplate(cols);
    const sub = ahead
        ? `The last ${cols - AHEAD} days and the next ${AHEAD}, with the runs the schedules plan`
        : `${format.short(days[0])} to ${last === today ? "today" : format.short(last)} · a click opens a database`;

    return (
        <div ref={ref} className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                    <p className="font-semibold">Timeline</p>
                    <p className="truncate text-sm text-muted-foreground">{cols > 0 ? sub : " "}</p>
                </div>
                <TimelineNav days={days} today={today} last={last} ahead={ahead} ready={cols > 0} pickedDay={null} problems={problems} onToday={toToday} onBack={back} onForward={forward} onJump={center} />
            </div>

            {cols === 0 || (runs.loading && !runs.error) ? (
                <div className="px-5 pb-4"><Skeleton className="h-40 w-full" /></div>
            ) : runs.error && !runs.data ? (
                <div className="mx-5 mb-4 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-10 text-center text-sm">
                    <p className="font-medium">The runs could not be loaded</p>
                    <p className="text-muted-foreground">
                        {runs.error}{" "}
                        <Button variant="link" className="h-auto p-0" onClick={runs.reload}>Try again</Button>
                    </p>
                </div>
            ) : groups.length === 0 ? (
                <p className="border-t px-5 py-10 text-center text-sm text-muted-foreground">No databases with these filters.</p>
            ) : (
                <div className="relative">
                    <TimelineBands days={days} today={today} pickedDay={null} template={template} />
                    <TimelineAheadCaption days={days} today={today} template={template}>Next {AHEAD} days, what the schedules plan</TimelineAheadCaption>
                    <TimelineAxis days={days} today={today} pickedDay={null} template={template} format={format} />
                    {groups.map((group) => (
                        <ServerGroup key={group.server.id} group={group} days={days} template={template} jobsById={jobsById} format={format} />
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-page/60 px-5 py-2.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] bg-foreground/55" />Backed up</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] bg-destructive" />Failed</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] border-[1.5px] border-dashed border-foreground/55" />Planned</span>
                <span className="inline-flex items-center gap-1.5"><ArrowUp className="size-3.5" aria-hidden="true" />A new version of the server</span>
                <span className="ml-auto">A click on a day opens the database with the runs of that day</span>
            </div>
        </div>
    );
}
