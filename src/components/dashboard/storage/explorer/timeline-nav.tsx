"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTimelineFormat } from "./timeline-cells";
import type { DayKey } from "./timeline-model";

/** How many days after today the arrow at today adds, the days the plan reaches. */
export const AHEAD = 7;

const pad = (value: number) => String(value).padStart(2, "0");
/** A day as the calendar takes it, the local midnight of that date. */
export const toDate = (day: DayKey) => {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(year, month - 1, date);
};
const toKey = (date: Date): DayKey => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

interface TimelineNavProps {
    days: DayKey[];
    today: DayKey;
    last: DayKey;
    /** The view reaches into the next days. */
    ahead: boolean;
    /** The columns are counted, so the view has its days. */
    ready: boolean;
    pickedDay: DayKey | null;
    /** Days with a failed check or a missed run, marked in the calendar. */
    problems: Date[];
    onToday: () => void;
    onBack: () => void;
    onForward: () => void;
    onJump: (day: DayKey) => void;
}

/**
 * The way through the days of the timeline: back a page, the days in view as a button that opens a
 * calendar to jump to a day, and on. At today the arrow on the right adds the next days instead,
 * and Today comes back from the past.
 */
export function TimelineNav({ days, today, last, ahead, ready, pickedDay, problems, onToday, onBack, onForward, onJump }: TimelineNavProps) {
    const format = useTimelineFormat();
    const [open, setOpen] = useState(false);
    const atToday = !ahead && last === today;

    return (
        <div className="ml-auto flex items-center gap-2">
            {!ahead && last < today && (
                <Button variant="outline" size="sm" className="h-8" onClick={onToday}>Today</Button>
            )}
            <Button variant="outline" size="icon" className="size-8" aria-label="Earlier days" onClick={onBack} disabled={!ready}>
                <ChevronLeft />
            </Button>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2" disabled={!ready} aria-label="Jump to a day">
                        <CalendarDays className="text-muted-foreground" />
                        <span className="tabular-nums">{ready ? `${format.short(days[0])} - ${format.short(days[days.length - 1])}` : ""}</span>
                        <ChevronDown className="opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto overflow-hidden rounded-xl bg-raised p-0" align="end">
                    <Calendar
                        mode="single"
                        selected={pickedDay ? toDate(pickedDay) : undefined}
                        onSelect={(date) => {
                            if (!date) return;
                            onJump(toKey(date));
                            setOpen(false);
                        }}
                        defaultMonth={toDate(last > today ? today : last)}
                        disabled={{ after: toDate(today) }}
                        modifiers={{ view: { from: toDate(days[0]), to: toDate(days[days.length - 1]) }, problem: problems }}
                        modifiersClassNames={{
                            view: "bg-muted/70",
                            problem: "relative after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-destructive",
                        }}
                        className="bg-transparent"
                    />
                    <div className="flex items-center gap-2 border-t bg-page/60 px-3 py-2 text-xs text-muted-foreground">
                        <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                        A failed check or a missed run
                        <span className="ml-auto pl-3">The tint is the view</span>
                    </div>
                </PopoverContent>
            </Popover>
            {atToday ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="size-8" aria-label={`Show the next ${AHEAD} days`} onClick={onForward} disabled={!ready}>
                            <ChevronRight />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-60">
                        <p className="font-medium">Show the next {AHEAD} days</p>
                        <p className="mt-0.5 text-muted-foreground">Adds the runs the schedules plan. Today stays in view.</p>
                    </TooltipContent>
                </Tooltip>
            ) : (
                <Button variant="outline" size="icon" className="size-8" aria-label="Later days" onClick={onForward} disabled={ahead || !ready}>
                    <ChevronRight />
                </Button>
            )}
        </div>
    );
}
