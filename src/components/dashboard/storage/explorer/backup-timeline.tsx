"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Lock } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn } from "@/lib/utils";

export const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

export interface TimelinePoint {
    /** The path of the backup. */
    id: string;
    time: number;
    /** Points of one chain are joined by a line. */
    chainId?: string;
    /** The full backup a chain starts with. */
    full?: boolean;
    incremental?: boolean;
    /** A copy missing at a destination, or a failed integrity check. */
    state: "ok" | "missing" | "failed";
    locked?: boolean;
    label: string;
}

export interface TimelineLane {
    key: string;
    title: string;
    note: string;
    icon: React.ReactNode;
    points: TimelinePoint[];
    /** A lane that no longer grows, like the one of a deleted job. */
    muted?: boolean;
    /** What the empty days after the last point mean, like "The job was deleted". */
    endNote?: string;
}

/** A day of a lane, as the start of that day. */
export interface TimelineDay {
    lane: string;
    day: number;
}

interface BackupTimelineProps {
    title: string;
    /** What a click does here, under the title. */
    hint?: string;
    lanes: TimelineLane[];
    selectedLane?: string | null;
    /** The day whose backups are listed below the timeline. */
    selectedDay?: TimelineDay | null;
    onLaneClick?: (key: string) => void;
    /** A click on a point or a bar hands back its day, whose backups the list below then shows. */
    onDayClick?: (day: TimelineDay) => void;
    /** The backup whose details are open, drawn with a ring. */
    markedPointId?: string | null;
}

interface Day {
    index: number;
    points: TimelinePoint[];
}

function startOfToday(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** The start of the day a backup falls on, the same way the timeline puts it on a day. */
export function dayStartOf(time: number): number {
    const today = startOfToday();
    return today + Math.floor((time - today) / DAY_MS) * DAY_MS;
}

function position(index: number, days: number): string {
    return `${((index + 0.5) / days) * 100}%`;
}

function Legend() {
    const item = "inline-flex items-center gap-1.5";
    return (
        <span className="hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground lg:flex">
            <span className={item}><span className="size-2 rounded-full bg-foreground/80" />Backup</span>
            <span className={item}><span className="size-2 rounded-full border-2 border-foreground" />Incremental</span>
            <span className={item}><span className="size-2.5 rounded-full border-2 border-warning" />Copy missing</span>
            <span className={item}><span className="size-2 rounded-full bg-destructive" />Check failed</span>
            <span className={item}><Lock className="size-3 text-warning" />Locked</span>
        </span>
    );
}

function Marker({ day, days, peak, marked, onClick }: { day: Day; days: number; peak: number; marked: boolean; onClick?: () => void }) {
    const newest = day.points.reduce((latest, point) => (point.time > latest.time ? point : latest));
    const failed = day.points.some((point) => point.state === "failed");
    const missing = day.points.some((point) => point.state === "missing");
    const left = position(day.index, days);
    const label = day.points.length === 1 ? newest.label : `${day.points.length} backups · the newest ${newest.label}`;

    // Many backups on one day, like an hourly job, become a bar as high as their number.
    if (day.points.length > 1) {
        const height = Math.max(6, Math.round((day.points.length / peak) * 26));
        return (
            <button
                type="button"
                title={label}
                aria-label={label}
                onClick={onClick}
                className="absolute top-1/2 flex -translate-x-1/2 flex-col items-center"
                style={{ left, marginTop: 13 - height }}
            >
                {failed && <span className="mb-1 size-1.5 rounded-full bg-destructive" />}
                <span className={cn("w-3 rounded-sm bg-foreground/70", missing && "ring-2 ring-warning")} style={{ height }} />
            </button>
        );
    }

    const point = newest;
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className={cn(
                "absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                marked && "ring-2 ring-foreground ring-offset-2 ring-offset-card"
            )}
            style={{ left }}
        >
            {point.locked ? (
                <Lock className="size-3.5 text-warning" />
            ) : point.state === "missing" ? (
                <span className="size-3.5 rounded-full border-2 border-warning bg-card" />
            ) : point.state === "failed" ? (
                <span className="size-3 rounded-full bg-destructive ring-3 ring-destructive/20" />
            ) : point.full ? (
                <span className="size-3.5 rounded-full bg-foreground" />
            ) : point.incremental ? (
                <span className="size-3 rounded-full border-2 border-foreground bg-card" />
            ) : (
                <span className="size-2.5 rounded-full bg-foreground/80" />
            )}
        </button>
    );
}

function LaneRow({ lane, days, start, selected, selectedDay, onLaneClick, onDayClick, markedPointId }: {
    lane: TimelineLane;
    days: number;
    start: number;
    selected: boolean;
    /** The start of the picked day of this lane. */
    selectedDay: number | null;
    onLaneClick?: (key: string) => void;
    onDayClick?: (day: TimelineDay) => void;
    markedPointId?: string | null;
}) {
    const { inRange, older, dayList, chains, peak, lastIndex } = useMemo(() => {
        const byDay = new Map<number, TimelinePoint[]>();
        let olderCount = 0;
        for (const point of lane.points) {
            const index = Math.floor((point.time - start) / DAY_MS);
            if (index < 0) {
                olderCount++;
                continue;
            }
            if (index >= days) continue;
            const list = byDay.get(index) ?? [];
            list.push(point);
            byDay.set(index, list);
        }
        const list: Day[] = [...byDay.entries()].map(([index, points]) => ({ index, points }));
        // A chain is drawn from its first point in the range to its last, or from the left edge
        // when it started before the range.
        const spans = new Map<string, { from: number; to: number; before: boolean }>();
        for (const point of lane.points) {
            if (!point.chainId) continue;
            const index = Math.floor((point.time - start) / DAY_MS);
            if (index >= days) continue;
            const span = spans.get(point.chainId) ?? { from: Infinity, to: -Infinity, before: false };
            if (index < 0) span.before = true;
            else {
                span.from = Math.min(span.from, index);
                span.to = Math.max(span.to, index);
            }
            spans.set(point.chainId, span);
        }
        return {
            inRange: list.length,
            older: olderCount,
            dayList: list,
            chains: [...spans.values()].filter((span) => Number.isFinite(span.to)),
            peak: Math.max(1, ...list.map((day) => day.points.length)),
            lastIndex: list.reduce((last, day) => Math.max(last, day.index), -1),
        };
    }, [lane.points, start, days]);

    return (
        <div className={cn("relative grid grid-cols-[16rem_2.5rem_minmax(0,1fr)] border-b last:border-b-0", selected && "bg-muted/50")}>
            {selected && <span className="absolute inset-y-2 left-0 w-0.75 rounded-r bg-foreground" aria-hidden="true" />}
            <button
                type="button"
                onClick={onLaneClick ? () => onLaneClick(lane.key) : undefined}
                disabled={!onLaneClick}
                className="flex min-w-0 items-center gap-3 py-2 pr-3 pl-4 text-left outline-none focus-visible:bg-muted/50 disabled:cursor-default"
            >
                {lane.icon}
                <span className="min-w-0">
                    <span className={cn("block truncate text-sm font-medium", lane.muted && "text-muted-foreground")}>{lane.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{lane.note}</span>
                </span>
            </button>
            <span className="flex items-center justify-center text-xs text-muted-foreground/80" title={older > 0 ? `${older} older backups` : undefined}>
                {older > 0 && <><ChevronLeft className="size-3" />{older}</>}
            </span>
            <div className="relative mr-4 h-13">
                {selectedDay !== null && selectedDay >= start && (
                    <span
                        className="absolute inset-y-1.5 -translate-x-1/2 rounded-md bg-foreground/10"
                        style={{ left: position(Math.round((selectedDay - start) / DAY_MS), days), width: `max(1.25rem, ${100 / days}%)` }}
                        aria-hidden="true"
                    />
                )}
                {chains.map((span, index) => {
                    const from = span.before ? 0 : ((span.from + 0.5) / days) * 100;
                    const to = ((span.to + 0.5) / days) * 100;
                    return <span key={index} className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-foreground/50" style={{ left: `${from}%`, width: `${Math.max(0, to - from)}%` }} />;
                })}
                {lane.endNote && lastIndex < days - 1 && (
                    <span
                        className="absolute inset-y-2.5 flex items-center justify-center overflow-hidden rounded-md border border-dashed bg-[repeating-linear-gradient(135deg,var(--muted)_0_6px,transparent_6px_12px)] px-2 text-xs text-muted-foreground"
                        style={{ left: `${((lastIndex + 1) / days) * 100}%`, right: 0 }}
                    >
                        <span className="truncate">{lane.endNote}</span>
                    </span>
                )}
                {dayList.map((day) => (
                    <Marker
                        key={day.index}
                        day={day}
                        days={days}
                        peak={peak}
                        marked={markedPointId !== undefined && markedPointId !== null && day.points.some((point) => point.id === markedPointId)}
                        onClick={onDayClick ? () => onDayClick({ lane: lane.key, day: start + day.index * DAY_MS }) : undefined}
                    />
                ))}
                {inRange === 0 && older === 0 && !lane.endNote && (
                    <span className="absolute inset-0 flex items-center text-xs text-muted-foreground">No backups in this range</span>
                )}
            </div>
        </div>
    );
}

/**
 * The backups of one or more jobs on a time axis: a point per backup, a line through the backups
 * of one incremental chain, a bar for a day with many, and missing copies and failed checks in
 * their status colors. The range switches without loading again.
 */
export function BackupTimeline({ title, hint, lanes, selectedLane, selectedDay, onLaneClick, onDayClick, markedPointId }: BackupTimelineProps) {
    const [range, setRange] = useState<Range>(30);
    const { formatDate } = useDateFormatter();
    const today = startOfToday();
    const start = today - (range - 1) * DAY_MS;
    const step = range === 7 ? 1 : range === 30 ? 7 : 14;
    const ticks: { index: number; label: string }[] = [];
    for (let index = 0; index < range - Math.ceil(step / 2); index += step) ticks.push({ index, label: formatDate(new Date(start + index * DAY_MS), "MMM d") });
    ticks.push({ index: range - 1, label: "Today" });

    return (
        <div className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-5">
                <div className="min-w-0">
                    <h2 className="font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground">
                        {formatDate(new Date(start), "MMM d")} to today{lanes.length > 1 ? ` · ${lanes.length} jobs` : ""}{hint ? ` · ${hint}` : ""}
                    </p>
                </div>
                <div className="ml-auto flex items-center gap-4">
                    <Legend />
                    <Tabs value={String(range)} onValueChange={(next) => setRange(Number(next) as Range)}>
                        <TabsList className="h-8" aria-label="Range">
                            {RANGES.map((value) => (
                                <TabsTrigger key={value} value={String(value)} className="px-2.5 text-xs">{value}d</TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>
            </div>
            <div className="grid grid-cols-[16rem_2.5rem_minmax(0,1fr)] border-y">
                <span />
                <span />
                <div className="relative mr-4 h-7">
                    {Array.from({ length: range }, (_, index) => (
                        <span key={index} className="absolute bottom-0 h-1 w-px bg-border" style={{ left: position(index, range) }} />
                    ))}
                    {ticks.map((tick) => (
                        <span
                            key={tick.index}
                            className={cn("absolute top-1.5 -translate-x-1/2 text-xs whitespace-nowrap tabular-nums", tick.label === "Today" ? "font-medium" : "text-muted-foreground")}
                            style={{ left: position(tick.index, range) }}
                        >
                            {tick.label}
                        </span>
                    ))}
                </div>
            </div>
            <div>
                {lanes.map((lane) => (
                    <LaneRow
                        key={lane.key}
                        lane={lane}
                        days={range}
                        start={start}
                        selected={selectedLane === lane.key}
                        selectedDay={selectedDay?.lane === lane.key ? selectedDay.day : null}
                        onLaneClick={onLaneClick}
                        onDayClick={onDayClick}
                        markedPointId={markedPointId}
                    />
                ))}
            </div>
        </div>
    );
}
