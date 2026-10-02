"use client";

import { useMemo } from "react";
import { formatInTimeZone, fromZonedTime, getTimezoneOffset } from "date-fns-tz";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { HOUR_MS } from "./job-timeline-model";

/** A length the way the views say it: "3 s", "24 min", "1 h 10 min". */
export function aboutLength(ms: number): string {
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const rest = minutes % 60;
    return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/**
 * The hours and days of the views in the formats and the time zone of the signed in user: the start
 * of an hour and of a day there, an hour as an axis shows it, a day, and a time of day.
 */
export function useTimelineClock() {
    const { formatDate, timezone } = useDateFormatter();
    return useMemo(() => {
        // The user's time format decides between 03 and 3 AM on the axis.
        const twelve = /am|pm/i.test(formatDate(new Date(Date.UTC(2026, 0, 1, 15)), "p"));
        const offset = (time: number) => {
            const value = getTimezoneOffset(timezone, new Date(time));
            return Number.isFinite(value) ? value : 0;
        };
        return {
            twelve,
            hourStart: (time: number) => Math.floor((time + offset(time)) / HOUR_MS) * HOUR_MS - offset(time),
            dayStart: (time: number) => fromZonedTime(`${formatInTimeZone(time, timezone, "yyyy-MM-dd")}T00:00:00`, timezone).getTime(),
            isMidnight: (time: number) => formatInTimeZone(time, timezone, "HH:mm") === "00:00",
            hourOfDay: (time: number) => Number(formatInTimeZone(time, timezone, "H")),
            hour: (time: number) => formatDate(new Date(time), twelve ? "h a" : "HH"),
            time: (time: number) => formatDate(new Date(time), "p"),
            day: (time: number) => `${formatDate(new Date(time), "EEE")}, ${formatDate(new Date(time), "P")}`,
            longDay: (time: number) => `${formatDate(new Date(time), "EEEE")}, ${formatDate(new Date(time), "P")}`,
            dayAndTime: (time: number) => `${formatDate(new Date(time), "EEE")} ${formatDate(new Date(time), "p")}`,
        };
    }, [formatDate, timezone]);
}

export type TimelineClock = ReturnType<typeof useTimelineClock>;
