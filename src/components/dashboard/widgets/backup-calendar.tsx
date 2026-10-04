"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO, startOfWeek, subWeeks } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CalendarDay } from "@/services/dashboard/types";

const MIN_WEEKS = 4;
/** The service keeps a year of days. */
const MAX_WEEKS = 53;
/** Target cell size in px. The cells stretch a little so the weeks fill the whole width. */
const CELL_PX = 16;
/** Matches gap-1. */
const GAP_PX = 4;

interface BackupCalendarProps {
    days: CalendarDay[];
    /** yyyy-MM-dd in the scheduler timezone, the last filled cell. */
    today: string;
    className?: string;
}

interface Cell {
    key: string;
    date: Date;
    day: CalendarDay | undefined;
    future: boolean;
}

function buildCalendar(days: CalendarDay[], today: string, weeks: number) {
    const byDate = new Map(days.map((day) => [day.date, day]));
    const firstMonday = subWeeks(startOfWeek(parseISO(today), { weekStartsOn: 1 }), weeks - 1);

    const cells: Cell[] = Array.from({ length: weeks * 7 }, (_, i) => {
        const date = addDays(firstMonday, i);
        const key = format(date, "yyyy-MM-dd");
        return { key, date, day: byDate.get(key), future: key > today };
    });

    // A month label sits above the week that holds the 1st of that month.
    const months: { column: number; label: string }[] = [];
    for (let week = 0; week < weeks; week++) {
        const first = cells.slice(week * 7, week * 7 + 7).find((cell) => cell.date.getDate() === 1);
        if (first) months.push({ column: week, label: format(first.date, "MMM") });
    }

    const maxCompleted = Math.max(0, ...cells.map((cell) => cell.day?.completed ?? 0));
    return { cells, months, maxCompleted };
}

function cellClassName(cell: Cell, maxCompleted: number): string {
    const { day } = cell;
    if (cell.future) return "border border-dashed border-border";
    if (!day || day.total === 0) return "bg-muted";
    if (day.failed > 0) return "bg-destructive/80";
    if (day.partial > 0) return "bg-warning/80";
    if (day.completed === 0) return "bg-muted";
    const level = Math.ceil((day.completed / Math.max(maxCompleted, 1)) * 3);
    if (level >= 3) return "bg-success";
    return level === 2 ? "bg-success/60" : "bg-success/30";
}

function describe(cell: Cell): string {
    // Calendar days are plain dates in the scheduler timezone, so they are formatted as they are.
    const date = format(cell.date, "EEE, MMM d");
    if (cell.future) return date;
    const { day } = cell;
    if (!day || day.total === 0) return `${date}: no backups`;
    const parts = [
        day.completed > 0 && `${day.completed} successful`,
        day.failed > 0 && `${day.failed} failed`,
        day.partial > 0 && `${day.partial} partial`,
    ].filter(Boolean);
    return `${date}: ${parts.join(", ") || `${day.total} started`}`;
}

/**
 * Backups per day, one column per week from Monday to Sunday, the current week on the right.
 * Shows as many weeks as fit the card, so it grows with the screen and a collapsed sidebar.
 */
export function BackupCalendar({ days, today, className }: BackupCalendarProps) {
    const gridRef = useRef<HTMLDivElement>(null);
    // Unknown until measured. The grid stays invisible until then, so it never jumps in size.
    const [weeks, setWeeks] = useState<number | null>(null);

    useLayoutEffect(() => {
        const element = gridRef.current;
        if (!element) return;
        const measure = () => {
            const fit = Math.floor((element.clientWidth + GAP_PX) / (CELL_PX + GAP_PX));
            setWeeks(Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, fit)));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const shownWeeks = weeks ?? MIN_WEEKS;
    const { cells, months, maxCompleted } = useMemo(() => buildCalendar(days, today, shownWeeks), [days, today, shownWeeks]);
    // The column count follows the measured width, the one value here that cannot be a class.
    // Before the first measurement the cells keep their target size, so the hidden grid already
    // takes about its final height and the page does not jump.
    const columns = {
        gridTemplateColumns: weeks === null ? `repeat(${MIN_WEEKS}, ${CELL_PX}px)` : `repeat(${weeks}, minmax(0, 1fr))`,
    };

    return (
        <div className={cn("min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5", className)}>
            <h2 className="font-semibold">Backup calendar</h2>
            <p className={cn("text-sm text-muted-foreground", weeks === null && "invisible")}>Last {shownWeeks} weeks</p>

            <div className={cn("mt-4", weeks === null && "invisible")}>
                <div className="mb-1 grid gap-x-1" style={columns} aria-hidden="true">
                    {months.map((month) => (
                        <span
                            key={`${month.label}-${month.column}`}
                            className="text-[11px] leading-none whitespace-nowrap text-muted-foreground"
                            style={{ gridColumnStart: month.column + 1 }}
                        >
                            {month.label}
                        </span>
                    ))}
                </div>
                <div ref={gridRef} className="grid grid-flow-col grid-rows-7 gap-1" style={columns}>
                    {cells.map((cell) => (
                        <Tooltip key={cell.key}>
                            <TooltipTrigger asChild>
                                <div className={cn("aspect-square rounded-[3px]", cellClassName(cell, maxCompleted))} />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                                {describe(cell)}
                            </TooltipContent>
                        </Tooltip>
                    ))}
                </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    Less
                    <span className="size-3 rounded-[2px] bg-muted" />
                    <span className="size-3 rounded-[2px] bg-success/30" />
                    <span className="size-3 rounded-[2px] bg-success/60" />
                    <span className="size-3 rounded-[2px] bg-success" />
                    More
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="size-3 rounded-[2px] bg-warning/80" />
                    Partial
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="size-3 rounded-[2px] bg-destructive/80" />
                    Failed
                </span>
            </div>
        </div>
    );
}
