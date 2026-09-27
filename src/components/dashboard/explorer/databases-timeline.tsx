"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { useTimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import { TimelineAheadCaption, TimelineAxis, TimelineBands, gridTemplate, useColumns, useTimelineWindow } from "@/components/dashboard/storage/explorer/timeline-frame";
import type { DayKey } from "@/components/dashboard/storage/explorer/timeline-model";
import { AHEAD, TimelineNav, toDate } from "@/components/dashboard/storage/explorer/timeline-nav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTableDefaults } from "@/components/ui/table-defaults";
import type { ExplorerDatabase, ExplorerDbJob, ExplorerServer } from "@/services/databases/database-explorer-types";
import { useDatabaseRuns } from "./database-data";
import { FOLD_FROM, buildTimeline, pageGroups, runsSpan, timelineUnits, type TimelineGroup } from "./database-model";
import { ServerGroup, type TimelinePick } from "./database-timeline-group";
import { TimelinePager } from "./database-timeline-parts";

interface DatabasesTimelineProps {
    /** The databases the search and the filters leave. */
    databases: ExplorerDatabase[];
    servers: ExplorerServer[];
    jobs: ExplorerDbJob[];
    /** The day whose backups show beside the timeline. */
    picked: TimelinePick | null;
    onPick: (key: string, day: DayKey) => void;
}

/**
 * The timeline of the Databases tab: the databases by server, a column per day with the runs
 * that backed each up or failed, and at today the next days with what the schedules plan. A new
 * version of a server shows as a mark over its databases on the day it was read. A server with
 * many databases folds into one row, and the rows come in pages as long as the ones of the tables.
 */
export function DatabasesTimeline({ databases, servers, jobs, picked, onPick }: DatabasesTimelineProps) {
    const format = useTimelineFormat();
    const defaults = useTableDefaults();
    const { ref, cols } = useColumns();
    const today = format.dayOf(new Date().toISOString());
    const { days, last, ahead, toToday, back, forward, center } = useTimelineWindow(cols, today);
    const span = cols > 0 ? runsSpan(days[0], last) : null;
    const runs = useDatabaseRuns(span ? `/api/databases/runs?from=${encodeURIComponent(span.from)}&until=${encodeURIComponent(span.until)}` : null);
    const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
    const [folds, setFolds] = useState<Record<string, boolean>>({});
    const [page, setPage] = useState(0);
    const [size, setSize] = useState(defaults.pageSize);

    const groups = useMemo(() => (runs.data
        ? buildTimeline({ databases, servers, jobs, runs: runs.data.runs, planned: runs.data.planned, versionChanges: runs.data.versionChanges, days, now: Date.now(), dayOf: format.dayOf })
        : []), [runs.data, databases, servers, jobs, days, format]);
    const isFolded = useCallback((group: TimelineGroup) => folds[group.server.id] ?? group.rows.length > FOLD_FROM, [folds]);
    const units = useMemo(() => timelineUnits(groups, isFolded), [groups, isFolded]);
    const pages = Math.max(1, Math.ceil(units.length / size));
    const current = Math.min(page, pages - 1);
    const shown = useMemo(() => pageGroups(units, current, size), [units, current, size]);
    const problems = useMemo(() => {
        const failed = new Set((runs.data?.runs ?? []).filter((run) => run.status === "Failed").map((run) => format.dayOf(run.startedAt)));
        return [...failed].map(toDate);
    }, [runs.data, format]);

    // The panel of a picked day takes room beside the timeline, which then shows fewer days. A
    // picked day that falls out of them is brought back when it is picked or the width changes,
    // never while the arrows move away from it.
    const pickedDay = picked?.day ?? null;
    const view = useRef({ days, center });
    useEffect(() => {
        view.current = { days, center };
    });
    useEffect(() => {
        if (!pickedDay || cols === 0) return;
        if (!view.current.days.includes(pickedDay)) view.current.center(pickedDay);
    }, [pickedDay, cols]);

    const template = gridTemplate(cols);
    const sub = ahead
        ? `The last ${cols - AHEAD} days and the next ${AHEAD}, with the runs the schedules plan`
        : `${format.short(days[0])} to ${last === today ? "today" : format.short(last)} · a click on a day shows its backups`;

    return (
        <div ref={ref} className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                    <p className="font-semibold">Timeline</p>
                    <p className="truncate text-sm text-muted-foreground">{cols > 0 ? sub : " "}</p>
                </div>
                <TimelineNav days={days} today={today} last={last} ahead={ahead} ready={cols > 0} pickedDay={picked?.day ?? null} problems={problems} onToday={toToday} onBack={back} onForward={forward} onJump={center} />
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
                <>
                    <div className="relative">
                        <TimelineBands days={days} today={today} pickedDay={picked?.day ?? null} template={template} />
                        <TimelineAheadCaption days={days} today={today} template={template}>Next {AHEAD} days, what the schedules plan</TimelineAheadCaption>
                        <TimelineAxis days={days} today={today} pickedDay={picked?.day ?? null} template={template} format={format} />
                        {shown.map(({ group, folded, rows }, index) => (
                            <ServerGroup
                                // A server cut by a page shows up twice, once on each side of the cut.
                                key={`${group.server.id}-${index}`}
                                group={group}
                                rows={rows}
                                folded={folded}
                                onFold={(next) => setFolds((state) => ({ ...state, [group.server.id]: next }))}
                                days={days}
                                template={template}
                                jobsById={jobsById}
                                format={format}
                                picked={picked}
                                onPick={onPick}
                            />
                        ))}
                    </div>
                    <TimelinePager
                        first={current * size + 1}
                        last={Math.min((current + 1) * size, units.length)}
                        total={count(units.length, "row")}
                        page={current}
                        pages={pages}
                        size={size}
                        onPage={setPage}
                        onSize={(next) => {
                            setSize(next);
                            setPage(0);
                        }}
                    />
                </>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-page/60 px-5 py-2.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] bg-foreground/55" />Backed up</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] bg-destructive" />Failed</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] border-[1.5px] border-dashed border-foreground/55" />Planned</span>
                <span className="inline-flex items-center gap-1.5"><ArrowUp className="size-3.5" aria-hidden="true" />A new version of the server</span>
                <span className="ml-auto">A click on a day shows its backups beside, a click on a name opens the database</span>
            </div>
        </div>
    );
}
