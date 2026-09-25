"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { TimelineFormat } from "./timeline-cells";
import { daysEnding, partsOf, shiftDay, type DayKey } from "./timeline-model";
import { AHEAD } from "./timeline-nav";

/**
 * What the timelines of the Storage Explorer share: as many day columns as fit, the days in view
 * with the ways through them, the bands behind the rows and the row of days on top.
 */

const LABEL_W = 240;
const MIN_COL = 40;
const GAP = 4;
/** The padding of the rows on both sides. */
const PAD = 40;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** As many day columns as the width has room for, measured whenever it changes. Zero until it is measured. */
export function useColumns() {
    const ref = useRef<HTMLDivElement>(null);
    const [cols, setCols] = useState(0);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        // The observer reports the size once it starts, so the first count needs no call of its own.
        const observer = new ResizeObserver(([entry]) => {
            const room = entry.contentRect.width - PAD - LABEL_W;
            setCols(Math.max(7, Math.min(62, Math.floor((room + GAP) / (MIN_COL + GAP)))));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return { ref, cols };
}

/**
 * The days in view and the ways through them: back a screen, on to today, at today on into the
 * next days once, and a day in the middle of the view.
 */
export function useTimelineWindow(cols: number, today: DayKey) {
    const [end, setEnd] = useState<DayKey | null>(null);
    const [ahead, setAhead] = useState(false);
    const last = ahead ? shiftDay(today, AHEAD) : end && end < today ? end : today;
    const days = useMemo(() => daysEnding(last, Math.max(cols, 1)), [last, cols]);

    const toToday = () => {
        setEnd(null);
        setAhead(false);
    };
    const back = () => {
        if (ahead) return toToday();
        setEnd(shiftDay(last, -cols));
    };
    const forward = () => {
        if (ahead) return;
        if (last < today) {
            const next = shiftDay(last, cols);
            setEnd(next >= today ? null : next);
        } else {
            setAhead(true);
        }
    };
    const center = (day: DayKey) => {
        setAhead(false);
        const next = shiftDay(day, Math.floor(cols / 2));
        setEnd(next >= today ? null : next);
    };
    return { days, last, ahead, toToday, back, forward, center };
}

/** The columns of every row: the label, then a column per day. */
export function gridTemplate(cols: number): React.CSSProperties {
    return { gridTemplateColumns: `${LABEL_W}px repeat(${Math.max(cols, 1)}, minmax(0, 1fr))`, columnGap: GAP };
}

/** Today, the next days behind a line and a picked day, as bands behind the rows. */
export function TimelineBands({ days, today, pickedDay, template }: { days: DayKey[]; today: DayKey; pickedDay: DayKey | null; template: React.CSSProperties }) {
    const firstAhead = days.findIndex((day) => day > today);
    return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid px-5" style={template}>
            <span />
            {days.map((day, index) => (
                <span
                    key={day}
                    className={cn(
                        day === today && "bg-foreground/5",
                        day > today && "bg-foreground/[0.035]",
                        index === firstAhead && "border-l border-foreground/35",
                        day === pickedDay && "bg-foreground/10"
                    )}
                />
            ))}
        </div>
    );
}

/** What the days after today show, over their columns. */
export function TimelineAheadCaption({ days, today, template, children }: { days: DayKey[]; today: DayKey; template: React.CSSProperties; children: React.ReactNode }) {
    const firstAhead = days.findIndex((day) => day > today);
    if (firstAhead < 0) return null;
    return (
        <div className="relative grid px-5 pt-1" style={template}>
            <span className="text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase" style={{ gridColumn: `${firstAhead + 2} / -1` }}>
                {children}
            </span>
        </div>
    );
}

interface TimelineAxisProps {
    days: DayKey[];
    today: DayKey;
    pickedDay: DayKey | null;
    template: React.CSSProperties;
    format: TimelineFormat;
    /** Picks a day that has come. Without it the days are only labels. */
    onPickDay?: (day: DayKey) => void;
}

/** The row of days: the month on the first day and on the first of a month, the weekday else, and Today. */
export function TimelineAxis({ days, today, pickedDay, template, format, onPickDay }: TimelineAxisProps) {
    return (
        <div className="relative grid border-b px-5 pb-1.5" style={template}>
            <span />
            {days.map((day, index) => {
                const { weekday, date, month } = partsOf(day);
                const top = index === 0 || date === 1 ? MONTHS[month] : WEEKDAYS[weekday];
                const isToday = day === today;
                const pickable = onPickDay !== undefined && day <= today;
                return (
                    <button
                        key={day}
                        type="button"
                        onClick={pickable ? () => onPickDay(day) : undefined}
                        aria-disabled={!pickable}
                        aria-pressed={pickable ? day === pickedDay : undefined}
                        aria-label={format.date(day)}
                        className={cn(
                            "flex h-10 min-w-0 flex-col items-center justify-end rounded-md pb-0.5 text-[11.5px] outline-none tabular-nums focus-visible:ring-2 focus-visible:ring-ring/50",
                            pickable ? "cursor-pointer text-muted-foreground hover:text-foreground" : "cursor-default text-muted-foreground/70",
                            day <= today && !pickable && "text-muted-foreground",
                            isToday && "font-semibold text-foreground",
                            day === pickedDay && "bg-foreground text-background hover:text-background"
                        )}
                    >
                        <span className="text-[10px] opacity-75">{top}</span>
                        {isToday ? "Today" : date}
                    </button>
                );
            })}
        </div>
    );
}
