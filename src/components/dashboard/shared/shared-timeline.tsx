"use client";

import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Archive, CalendarDays, Layers } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { TimelineTotal, useTimelineFormat, type TimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import { TimelineAxis, TimelineBands, gridTemplate, useColumns, useTimelineWindow } from "@/components/dashboard/storage/explorer/timeline-frame";
import type { DayKey } from "@/components/dashboard/storage/explorer/timeline-model";
import { TimelineNav, toDate } from "@/components/dashboard/storage/explorer/timeline-nav";
import { PickList, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatBytes } from "@/lib/utils";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { countOf, formerLabel, isFormer, sharedKey, type SharedRow } from "./shared-model";
import { buildSharedRow, pickedRows, sharedTotals, type SharedCell, type SharedPick, type SharedSpan, type SharedTimelineRow } from "./shared-timeline-model";

const CELL = { none: "", ok: "bg-foreground/55 text-card", failed: "bg-destructive text-destructive-foreground" } as const;

function CellButton({ cell, row, format, picked, onPick }: { cell: SharedCell; row: SharedTimelineRow; format: TimelineFormat; picked: boolean; onPick: (anchor: HTMLElement) => void }) {
    const pickable = cell.rows.length > 0;
    const button = (
        <button
            type="button"
            onClick={pickable ? (event) => onPick(event.currentTarget) : undefined}
            aria-disabled={!pickable}
            aria-haspopup={pickable ? "dialog" : undefined}
            aria-expanded={pickable ? picked : undefined}
            aria-label={`${row.database.databaseName}, ${format.date(cell.day)}`}
            className={cn(
                "flex h-7 w-full min-w-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50",
                CELL[cell.kind],
                pickable ? "cursor-pointer hover:ring-2 hover:ring-foreground/30" : "cursor-default",
                picked && "ring-2 ring-foreground ring-offset-2 ring-offset-card hover:ring-foreground"
            )}
        >
            {cell.kind === "none" ? <span className="size-1 rounded-full bg-foreground/20" /> : cell.rows.length > 1 ? cell.rows.length : null}
        </button>
    );
    if (!pickable) return button;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
                <p className="font-medium">{countOf(cell.rows.length, "backup")} of {row.database.databaseName} on {format.date(cell.day)}</p>
                {cell.kind === "failed" && <p className="mt-1 text-destructive">A check failed.</p>}
            </TooltipContent>
        </Tooltip>
    );
}

function SpanBar({ span, database, format }: { span: SharedSpan; database: SharedDatabase; format: TimelineFormat }) {
    const text = span.kind === "before" ? `Yours from ${format.dateOf(database.since)}` : `No longer yours since ${format.dateOf(database.until ?? database.since)}`;
    return (
        <span
            title={text}
            className="flex h-7 min-w-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-input px-2 text-xs whitespace-nowrap text-muted-foreground"
            style={{ gridColumn: `${span.start + 2} / ${span.end + 3}` }}
        >
            {span.end - span.start >= 3 ? <span className="truncate">{text}</span> : <span className="sr-only">{text}</span>}
        </span>
    );
}

interface SharedTimelineProps {
    /** The backups the filters leave. */
    rows: SharedRow[];
    /** The databases to show a row for, in their order. */
    databases: SharedDatabase[];
    onOpen: (row: SharedRow) => void;
}

/**
 * The second view of the tab Shared with you, the timeline of the Backups tab: a row per database
 * and a column per day, as many days as fit. A click on a day of a database or of every database
 * lists its backups right there, and a day with a single backup opens it at once.
 */
export function SharedTimeline({ rows, databases, onOpen }: SharedTimelineProps) {
    const format = useTimelineFormat();
    const { ref, cols } = useColumns();
    const today = format.dayOf(new Date().toISOString());
    const { days, last, ahead, toToday, back, forward, center } = useTimelineWindow(cols, today);
    const [pick, setPick] = useState<SharedPick | null>(null);
    const anchorRef = useRef<HTMLElement | null>(null);

    const lines = useMemo(() => databases.map((database) => buildSharedRow(database, rows, days, format.dayOf)), [databases, rows, days, format]);
    const totals = useMemo(() => sharedTotals(lines, days), [lines, days]);
    const peak = Math.max(...totals.map((total) => total.count), 1);
    const problems = useMemo(() => [...new Set(rows.filter((row) => row.verification?.passed === false).map((row) => format.dayOf(row.createdAt)))].map(toDate), [rows, format]);
    const listed = pick ? pickedRows(lines, days, pick) : [];

    const toggle = (next: SharedPick, anchor: HTMLElement) => {
        if (pick && pick.key === next.key && pick.day === next.day) return setPick(null);
        const found = pickedRows(lines, days, next);
        if (next.key && found.length === 1) {
            setPick(null);
            return onOpen(found[0]);
        }
        anchorRef.current = anchor;
        setPick(next);
    };
    const jump = (day: DayKey) => {
        flushSync(() => center(day));
        const anchor = ref.current?.querySelector<HTMLElement>(`[data-day="${day}"]`);
        if (!anchor) return false;
        toggle({ day }, anchor);
        return true;
    };

    const template = gridTemplate(cols);
    const pickedDay = pick && !pick.key ? pick.day : null;
    const database = pick?.key ? databases.find((entry) => sharedKey(entry) === pick.key) : undefined;
    const entries: PickEntry[] = listed.map((row) => ({
        id: row.id,
        name: pick?.key ? format.time(row.createdAt) : row.database.databaseName,
        meta: [pick?.key ? null : format.time(row.createdAt), row.dump ? formatBytes(row.dump.stored, 1) : null, row.verification?.passed ? "verified" : null].filter(Boolean).join(" · "),
        icon: pick?.key ? undefined : <AdapterIcon adapterId={row.database.adapterId} className="size-4" />,
        value: `${row.database.databaseName} ${row.createdAt} ${row.id}`,
        alert: row.verification?.passed === false ? { text: "Check failed", tone: "destructive" } : undefined,
    }));

    return (
        <div ref={ref} className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                    <p className="font-semibold">Timeline</p>
                    <p className="truncate text-sm text-muted-foreground">{cols > 0 ? `${format.short(days[0])} to ${last === today ? "today" : format.short(last)} · a click lists the backups right there` : " "}</p>
                </div>
                <TimelineNav
                    days={days}
                    today={today}
                    last={last}
                    ahead={ahead}
                    ready={cols > 0}
                    pickedDay={pickedDay}
                    problems={problems}
                    problemLabel="A failed check"
                    future={false}
                    onToday={toToday}
                    onBack={back}
                    onForward={forward}
                    onJump={jump}
                />
            </div>

            {cols === 0 ? (
                <div className="px-5 pb-4"><Skeleton className="h-48 w-full" /></div>
            ) : lines.length === 0 ? (
                <p className="border-t px-5 py-10 text-center text-sm text-muted-foreground">No backups with these filters.</p>
            ) : (
                <div className="relative">
                    <TimelineBands days={days} today={today} pickedDay={pickedDay} template={template} />
                    <TimelineAxis days={days} today={today} pickedDay={pickedDay} template={template} format={format} onPickDay={(day, anchor) => toggle({ day }, anchor)} />
                    <div className="relative grid items-end border-b px-5 py-1.5" style={template}>
                        <div className="flex min-w-0 items-center gap-2.5 self-center pr-3">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
                                <Layers className="size-4 text-muted-foreground" />
                            </span>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">Every database</p>
                                <p className="truncate text-xs text-muted-foreground">A click on a day lists its backups</p>
                            </div>
                        </div>
                        {totals.map((total) => (
                            <TimelineTotal key={total.day} total={total} peak={peak} picked={total.day === pickedDay} onPick={(anchor) => toggle({ day: total.day }, anchor)} format={format} />
                        ))}
                    </div>
                    {lines.map((line) => (
                        <div key={sharedKey(line.database)} className="relative grid items-center border-b px-5 py-2 last:border-b-0" style={template}>
                            <div className="flex min-w-0 items-center gap-2.5 pr-3">
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                                    <AdapterIcon adapterId={line.database.adapterId} className="size-4" />
                                </span>
                                <span className="min-w-0">
                                    <span className={cn("block truncate text-sm font-medium", isFormer(line.database) && "text-muted-foreground")}>{line.database.databaseName}</span>
                                    <span className="block truncate text-xs text-muted-foreground">{isFormer(line.database) ? formerLabel(line.database) : line.database.serverName}</span>
                                </span>
                            </div>
                            {line.cells.map((cell, index) => {
                                if (cell) {
                                    const key = sharedKey(line.database);
                                    return <CellButton key={cell.day} cell={cell} row={line} format={format} picked={pick?.key === key && pick.day === cell.day} onPick={(anchor) => toggle({ key, day: cell.day }, anchor)} />;
                                }
                                const span = line.spans.find((entry) => entry.start === index);
                                return span ? <SpanBar key={`span-${index}`} span={span} database={line.database} format={format} /> : null;
                            })}
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-page/60 px-5 py-2.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] bg-foreground/55" />Backup</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] bg-destructive" />Check failed</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3.5 rounded-[4px] border border-dashed border-input" />Not yours then</span>
            </div>

            <Popover open={pick !== null} onOpenChange={(open) => !open && setPick(null)}>
                <PopoverAnchor virtualRef={anchorRef} />
                <PopoverContent
                    tone="pick"
                    collisionPadding={12}
                    className="w-96 overflow-hidden p-0"
                    onInteractOutside={(event) => {
                        if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault();
                    }}
                >
                    {pick && (
                        <PickList
                            icon={database ? Archive : CalendarDays}
                            title={database ? `${database.databaseName} · ${format.date(pick.day)}` : format.long(pick.day)}
                            note={countOf(listed.length, "backup")}
                            groups={[{ entries }]}
                            value={null}
                            emptyText={listed.length === 0 ? "No backup that day." : "Nothing matches."}
                            searchPlaceholder={database ? "Search by time" : "Search by database or time"}
                            onPick={(id) => {
                                const row = listed.find((entry) => entry.id === id);
                                setPick(null);
                                if (row) onOpen(row);
                            }}
                        />
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
}
