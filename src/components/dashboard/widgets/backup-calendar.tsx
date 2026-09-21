"use client";

import { useMemo } from "react";
import { addDays, format, parseISO, startOfWeek, subWeeks } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CalendarDay } from "@/services/dashboard/types";

const WEEKS = 12;

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

/** Backups per day over the last twelve weeks, one column per week from Monday to Sunday. */
export function BackupCalendar({ days, today, className }: BackupCalendarProps) {
    const { cells, maxCompleted } = useMemo(() => {
        const byDate = new Map(days.map((day) => [day.date, day]));
        const firstMonday = subWeeks(startOfWeek(parseISO(today), { weekStartsOn: 1 }), WEEKS - 1);
        const result: Cell[] = Array.from({ length: WEEKS * 7 }, (_, i) => {
            const date = addDays(firstMonday, i);
            const key = format(date, "yyyy-MM-dd");
            return { key, date, day: byDate.get(key), future: key > today };
        });
        return { cells: result, maxCompleted: Math.max(0, ...days.map((day) => day.completed)) };
    }, [days, today]);

    return (
        <div className={cn("min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5", className)}>
            <h2 className="font-semibold">Backup calendar</h2>
            <p className="text-sm text-muted-foreground">Last {WEEKS} weeks</p>

            <div className="mt-4 grid max-w-sm auto-cols-fr grid-flow-col grid-rows-7 gap-1">
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
