/**
 * The schedules the picker builds without cron, and the way back from an expression. Times are
 * the scheduler's, the way the expression holds them, and every time of a schedule shares its
 * minute because cron has one minute field for all of them.
 */

export type Frequency = "hourly" | "daily" | "weekly" | "monthly";
export type ScheduleMode = Frequency | "cron";

export interface SimpleSchedule {
    frequency: Frequency;
    /** Hourly: every this many hours, from midnight. */
    everyHours: number;
    minute: number;
    /** Daily, weekly and monthly: the hours it starts at, sorted. */
    hours: number[];
    /** Weekly: 0 is Sunday, like in cron. Sorted. */
    days: number[];
    /** Monthly: the day of the month, or "L" for its last day. */
    dayOfMonth: number | "L";
}

export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];
export const MINUTE_STEPS = [0, 15, 30, 45];
/** Monday first, the way the week is read. */
export const WEEK = [
    { value: 1, short: "Mon", name: "Monday" },
    { value: 2, short: "Tue", name: "Tuesday" },
    { value: 3, short: "Wed", name: "Wednesday" },
    { value: 4, short: "Thu", name: "Thursday" },
    { value: 5, short: "Fri", name: "Friday" },
    { value: 6, short: "Sat", name: "Saturday" },
    { value: 0, short: "Sun", name: "Sunday" },
];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [0, 6];
/** Enough for a few runs a day, more is a job for cron. */
export const MAX_TIMES = 6;

export const DEFAULT_SCHEDULE: SimpleSchedule = { frequency: "daily", everyHours: 1, minute: 0, hours: [3], days: [0], dayOfMonth: 1 };

const pad = (value: number) => String(value).padStart(2, "0");

export function timeText(hour: number, minute: number): string {
    return `${pad(hour)}:${pad(minute)}`;
}

/** "3", "0330", "3:30" and "15.30" are all times, anything past 23:59 is not. */
export function parseTime(text: string): { hour: number; minute: number } | null {
    const value = text.trim();
    const match = value.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = match[2] === undefined ? 0 : Number(match[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

const sortNumbers = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

/** Consecutive days become a range, the way cron writes the working week: 1-5. */
export function formatDays(days: number[]): string {
    const sorted = sortNumbers(days);
    const parts: string[] = [];
    let index = 0;
    while (index < sorted.length) {
        let end = index;
        while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
        parts.push(end - index >= 2 ? `${sorted[index]}-${sorted[end]}` : sorted.slice(index, end + 1).join(","));
        index = end + 1;
    }
    return parts.join(",");
}

export function buildCron(schedule: SimpleSchedule): string {
    const { frequency, everyHours, minute, hours, days, dayOfMonth } = schedule;
    const at = hours.join(",");
    switch (frequency) {
        case "hourly":
            return `${minute} ${everyHours === 1 ? "*" : `*/${everyHours}`} * * *`;
        case "daily":
            return `${minute} ${at} * * *`;
        case "weekly":
            // No day picked leaves the field empty, which no scheduler reads, so it cannot be saved.
            return `${minute} ${at} * * ${formatDays(days)}`.trim();
        case "monthly":
            return `${minute} ${at} ${dayOfMonth} * *`;
    }
}

/** A list of numbers and ranges without steps, like "3,15" or "1-5". */
function parseList(field: string, min: number, max: number): number[] | null {
    const values: number[] = [];
    for (const part of field.split(",")) {
        const range = part.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
        if (!range) return null;
        const from = Number(range[1]);
        const to = range[2] === undefined ? from : Number(range[2]);
        if (from < min || to > max || from > to) return null;
        for (let value = from; value <= to; value++) values.push(value);
    }
    return values.length > 0 ? sortNumbers(values) : null;
}

/** The schedule an expression stands for, or null for one the picker only shows as cron. */
export function parseCron(expression: string): SimpleSchedule | null {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) return null;
    const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
    if (monthField !== "*" || !/^\d{1,2}$/.test(minuteField)) return null;
    const minute = Number(minuteField);
    if (minute > 59) return null;
    const base = { ...DEFAULT_SCHEDULE, minute };

    const step = hourField === "*" ? 1 : Number(hourField.match(/^\*\/(\d{1,2})$/)?.[1]);
    if (HOUR_STEPS.includes(step)) {
        return dayField === "*" && weekdayField === "*" ? { ...base, frequency: "hourly", everyHours: step } : null;
    }

    const hours = parseList(hourField, 0, 23);
    if (!hours || hours.length > MAX_TIMES) return null;
    if (dayField === "*" && weekdayField === "*") return { ...base, frequency: "daily", hours };
    if (dayField === "*") {
        const days = parseList(weekdayField, 0, 7);
        if (!days) return null;
        const week = sortNumbers(days.map((day) => day % 7));
        return week.length === 7 ? { ...base, frequency: "daily", hours } : { ...base, frequency: "weekly", hours, days: week };
    }
    if (weekdayField !== "*") return null;
    if (dayField === "L") return { ...base, frequency: "monthly", hours, dayOfMonth: "L" };
    const day = /^\d{1,2}$/.test(dayField) ? Number(dayField) : 0;
    return day >= 1 && day <= 31 ? { ...base, frequency: "monthly", hours, dayOfMonth: day } : null;
}

/**
 * Every time moved by the same number of minutes. Null when a time would move to another day,
 * which would change the days of a weekly or monthly schedule.
 */
export function shiftTimes(schedule: SimpleSchedule, minutes: number): SimpleSchedule | null {
    const times = schedule.hours.map((hour) => hour * 60 + schedule.minute + minutes);
    if (schedule.frequency !== "daily" && times.some((time) => time < 0 || time >= 24 * 60)) return null;
    const wrapped = times.map((time) => ((time % 1440) + 1440) % 1440);
    return { ...schedule, minute: wrapped[0] % 60, hours: sortNumbers(wrapped.map((time) => Math.floor(time / 60))) };
}

/** Later first, since a backup is usually planned for when nothing else is going on. */
const SHIFTS = [15, 30, 45, 60, 90, 120, 180, -15, -30, -45, -60, -90, -120, -180];
/** The round quarters first. */
const MINUTE_OFFSETS = [15, 30, 45, 5, 10, 20, 25, 35, 40, 50, 55];

/** The nearest variation of a schedule the queue has room for, with the words for its button. */
export function suggestFreeTime(schedule: SimpleSchedule, isFree: (expression: string) => boolean): { schedule: SimpleSchedule; label: string } | null {
    if (schedule.frequency === "hourly") {
        for (const offset of MINUTE_OFFSETS) {
            const next = { ...schedule, minute: (schedule.minute + offset) % 60 };
            if (isFree(buildCron(next))) return { schedule: next, label: `Use :${pad(next.minute)}` };
        }
        return null;
    }
    for (const shift of SHIFTS) {
        const next = shiftTimes(schedule, shift);
        if (!next || !isFree(buildCron(next))) continue;
        const label = next.hours.length === 1 ? `Use ${timeText(next.hours[0], next.minute)}` : `Move ${Math.abs(shift)} min ${shift > 0 ? "later" : "earlier"}`;
        return { schedule: next, label };
    }
    return null;
}

function listText(items: string[]): string {
    return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The schedule in words, "Weekdays at 03:00" or "Every day at 03:00 and 15:00". */
export function describeSimple(schedule: SimpleSchedule): string {
    const { frequency, everyHours, minute, hours, days, dayOfMonth } = schedule;
    if (frequency === "hourly") {
        const past = minute === 0 ? "" : ` at :${pad(minute)}`;
        return `${everyHours === 1 ? "Every hour" : `Every ${everyHours} hours`}${past}`;
    }
    const at = listText(hours.map((hour) => timeText(hour, minute)));
    if (frequency === "daily") return `Every day at ${at}`;
    if (frequency === "monthly") return dayOfMonth === "L" ? `Monthly on the last day at ${at}` : `Monthly on day ${dayOfMonth} at ${at}`;
    const key = days.join(",");
    if (key === WEEKDAYS.join(",")) return `Weekdays at ${at}`;
    if (key === WEEKEND.join(",")) return `Weekends at ${at}`;
    const picked = WEEK.filter((day) => days.includes(day.value));
    if (picked.length === 1) return `Every ${picked[0].name} at ${at}`;
    return `${listText(picked.map((day) => day.short))} at ${at}`;
}
