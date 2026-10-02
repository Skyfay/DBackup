"use client";

import { useMemo } from "react";
import { Layers, Scissors } from "lucide-react";
import { signedBytes } from "@/components/dashboard/widgets/storage-history-data";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatBytes } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerJob, ExplorerPlan } from "@/services/storage/explorer-types";
import { AnswerDot, DestinationTile, answerOf } from "./explorer-cells";
import { count } from "./explorer-format";
import { useTimelineFormat } from "./timeline-cells";
import { DestinationDayCell, type DayCell, type Kind } from "./destinations-timeline-cells";
import { TimelineAheadCaption, TimelineAxis, TimelineBands, gridTemplate, useColumns, useTimelineWindow } from "./timeline-frame";
import type { DayKey } from "./timeline-model";
import { AHEAD, TimelineNav, toDate } from "./timeline-nav";

interface Tally {
    arrived: number;
    missing: number;
    away: number;
    leaving: number;
    jobs: Set<string>;
}

const add = (map: Map<string, Tally>, key: string) => {
    let tally = map.get(key);
    if (!tally) {
        tally = { arrived: 0, missing: 0, away: 0, leaving: 0, jobs: new Set() };
        map.set(key, tally);
    }
    return tally;
};

interface DestinationsTimelineProps {
    /** The destinations the filters leave. */
    destinations: ExplorerDestination[];
    runs: BackupRun[];
    jobs: ExplorerJob[];
    /** What the schedules plan, null while it loads. */
    plan: ExplorerPlan | null;
    picked: string | null;
    onPick: (destinationId: string) => void;
}

/**
 * The timeline of the Destinations tab: a row per destination and a column per day, with what
 * arrived, what is missing and whether it answers today. At today the arrow on the right adds the
 * next days with what the schedules send there and what the retention removes. A click on a
 * destination shows its details below.
 */
export function DestinationsTimeline({ destinations, runs, jobs, plan, picked, onPick }: DestinationsTimelineProps) {
    const format = useTimelineFormat();
    const { ref, cols } = useColumns();
    const today = format.dayOf(new Date().toISOString());
    const { days, last, ahead, toToday, back, forward, center } = useTimelineWindow(cols, today);

    // What arrived and went missing at every destination by day, and what the schedules plan there.
    const tallies = useMemo(() => {
        const byKey = new Map<string, Tally>();
        const jobsByKey = new Map(jobs.map((job) => [job.key, job]));
        // An air-gapped destination has no missing copies. A run without it counts as a day it was
        // away, from its first backup on, so its gray days show when it was not connected.
        const airGapped = new Set(destinations.filter((destination) => destination.airGapped).map((destination) => destination.id));
        const firstArrival = new Map<string, number>();
        for (const run of runs) {
            for (const copy of run.copies) {
                if (copy.state !== "stored" || !airGapped.has(copy.destinationId)) continue;
                const at = Date.parse(run.createdAt);
                if (at < (firstArrival.get(copy.destinationId) ?? Infinity)) firstArrival.set(copy.destinationId, at);
            }
        }
        for (const run of runs) {
            const day = format.dayOf(run.createdAt);
            for (const copy of run.copies) {
                const tally = add(byKey, `${copy.destinationId}|${day}`);
                if (copy.state === "stored") tally.arrived++;
                else tally.missing++;
            }
            for (const destinationId of jobsByKey.get(run.jobKey)?.configuredDestinationIds ?? []) {
                if (!airGapped.has(destinationId) || run.copies.some((copy) => copy.destinationId === destinationId)) continue;
                if (Date.parse(run.createdAt) > (firstArrival.get(destinationId) ?? Infinity)) add(byKey, `${destinationId}|${day}`).away++;
            }
        }
        for (const entry of plan?.jobs ?? []) {
            const job = jobsByKey.get(entry.jobKey);
            if (!job) continue;
            for (const planned of entry.planned) {
                const day = format.dayOf(planned.at);
                if (day <= today) continue;
                for (const destinationId of job.configuredDestinationIds) {
                    const tally = add(byKey, `${destinationId}|${day}`);
                    tally.arrived++;
                    tally.jobs.add(job.key);
                }
                for (const gone of planned.agesOut ?? []) add(byKey, `${gone.destinationId}|${day}`).leaving += gone.count;
            }
        }
        return byKey;
    }, [runs, jobs, destinations, plan, today, format]);

    const rows = useMemo(() => destinations.map((destination) => ({
        destination,
        cells: days.map((day): DayCell => {
            const tally = tallies.get(`${destination.id}|${day}`);
            const arrived = tally?.arrived ?? 0;
            const missing = tally?.missing ?? 0;
            const away = tally?.away ?? 0;
            const future = day > today;
            const answer = answerOf(destination);
            const kind: Kind = future
                ? arrived > 0 ? "planned" : "none"
                : day === today && answer === "offline" ? "offline"
                    : day === today && answer === "away" && arrived === 0 ? "away"
                        : missing > 0 ? "missing" : arrived > 0 ? "in" : away > 0 ? "away" : "none";
            return { day, kind, arrived, missing, away, leaving: tally?.leaving ?? 0, jobs: tally?.jobs.size ?? 0 };
        }),
    })), [destinations, days, tallies, today]);

    const totals = days.map((day, index) => ({
        day,
        count: rows.reduce((sum, row) => sum + row.cells[index].arrived, 0),
        worst: rows.some((row) => row.cells[index].kind === "offline") ? "destructive" : rows.some((row) => row.cells[index].kind === "missing") ? "warning" : "ok",
        planned: day > today,
    }));
    const peak = Math.max(...totals.map((total) => total.count), 1);
    const problems = useMemo(() => {
        const marked = new Set<DayKey>();
        for (const [key, tally] of tallies) if (tally.missing > 0) marked.add(key.split("|")[1]);
        return [...marked].map(toDate);
    }, [tallies]);

    const template = gridTemplate(cols);
    const sub = ahead
        ? `The last ${cols - AHEAD} days and the next ${AHEAD}, what arrives and what the retention removes`
        : `${format.short(days[0])} to ${last === today ? "today" : format.short(last)} · a destination shows its details below`;

    return (
        <div ref={ref} className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                    <p className="font-semibold">Timeline</p>
                    <p className="truncate text-sm text-muted-foreground">{cols > 0 ? sub : " "}</p>
                </div>
                <TimelineNav days={days} today={today} last={last} ahead={ahead} ready={cols > 0} pickedDay={null} problems={problems} onToday={toToday} onBack={back} onForward={forward} onJump={center} />
            </div>

            {cols === 0 ? (
                <div className="px-5 pb-4"><Skeleton className="h-40 w-full" /></div>
            ) : rows.length === 0 ? (
                <p className="border-t px-5 py-10 text-center text-sm text-muted-foreground">No destinations with these filters.</p>
            ) : (
                <div className="relative">
                    <TimelineBands days={days} today={today} pickedDay={null} template={template} />
                    <TimelineAheadCaption days={days} today={today} template={template}>Next {AHEAD} days, what arrives and what the retention removes</TimelineAheadCaption>
                    <TimelineAxis days={days} today={today} pickedDay={null} template={template} format={format} />

                    <div className="relative grid items-end border-b px-5 py-1.5" style={template}>
                        <div className="flex min-w-0 items-center gap-2.5 self-center pr-3">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
                                <Layers className="size-4 text-muted-foreground" />
                            </span>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">Every destination</p>
                                <p className="truncate text-xs text-muted-foreground">Backups that arrived each day</p>
                            </div>
                        </div>
                        {totals.map((total) => {
                            const height = total.count === 0 ? 0 : Math.max(4, Math.round((total.count / peak) * 26));
                            return (
                                <div key={total.day} className="flex h-10 min-w-0 flex-col items-center justify-end gap-0.5" aria-label={`${count(total.count, "backup")}, ${format.date(total.day)}`}>
                                    <span className={cn("text-[10px] tabular-nums", total.planned ? "text-muted-foreground/70" : "text-muted-foreground")}>{total.count || ""}</span>
                                    {height > 0 && (
                                        <span
                                            className={cn(
                                                "w-3/4 rounded-t-sm",
                                                total.planned
                                                    ? "border-[1.5px] border-b-0 border-dashed border-foreground/45"
                                                    : total.worst === "destructive" ? "bg-destructive" : total.worst === "warning" ? "bg-warning" : "bg-foreground/55"
                                            )}
                                            style={{ height }}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {rows.map(({ destination, cells }) => (
                        <div key={destination.id} className={cn("relative grid items-center border-b px-5 py-2 last:border-b-0", picked === destination.id && "bg-foreground/[0.045]")} style={template}>
                            <button
                                type="button"
                                onClick={() => onPick(destination.id)}
                                aria-pressed={picked === destination.id}
                                className="flex min-w-0 items-center gap-2.5 rounded-md pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                                <DestinationTile destination={destination} size="sm" />
                                <span className="min-w-0">
                                    <span className="flex min-w-0 items-center gap-2">
                                        <span className="truncate text-sm font-medium">{destination.name}</span>
                                        <AnswerDot answer={answerOf(destination)} />
                                    </span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                        {formatBytes(destination.size)}
                                        {destination.growth !== null && ` · ${signedBytes(destination.growth)} in 7 days`}
                                    </span>
                                </span>
                            </button>
                            {cells.map((cell) => (
                                <DestinationDayCell key={cell.day} cell={cell} destination={destination} format={format} picked={picked === destination.id} onPick={() => onPick(destination.id)} />
                            ))}
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-page/60 px-5 py-2.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] bg-foreground/55" />Backups arrived</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] border-2 border-warning bg-warning/20" />A copy is missing</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] border-2 border-dashed border-destructive" />Does not answer today</span>
                {destinations.some((destination) => destination.airGapped) && (
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] border border-dashed border-muted-foreground/60" />Air-gapped, not connected</span>
                )}
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] border-[1.5px] border-dashed border-foreground/55" />Planned</span>
                <span className="inline-flex items-center gap-1.5"><Scissors className="size-3.5" aria-hidden="true" />Retention removes backups</span>
                <span className="ml-auto">A click on a destination shows its details</span>
            </div>
        </div>
    );
}
