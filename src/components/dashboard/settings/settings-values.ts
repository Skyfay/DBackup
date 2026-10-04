import type { PartChange } from "./settings-frame";

/**
 * The words of the Settings page for its values, and what the save bar names as changed. Plain
 * functions, so the words and the diff stay the same everywhere.
 */

/** The times after which a run that stops reporting fails. 0 turns the watchdog off. */
export const STUCK_CHOICES = [0, 30, 60, 180, 360, 720, 1440] as const;

/** How long a session lasts, in seconds. */
export const SESSION_CHOICES = [3600, 28800, 86400, 259200, 604800, 1209600, 2592000, 7776000] as const;

/** "Never", "30 minutes", "1 hour", "6 hours". */
export function minutesText(minutes: number): string {
    if (minutes === 0) return "Never";
    if (minutes % 60 !== 0) return `${minutes} minutes`;
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** "1 hour", "8 hours", "1 day", "7 days". */
export function secondsText(seconds: number): string {
    if (seconds % 86400 === 0) return seconds === 86400 ? "1 day" : `${seconds / 86400} days`;
    if (seconds % 3600 === 0) return seconds === 3600 ? "1 hour" : `${seconds / 3600} hours`;
    return `${seconds} seconds`;
}

/** The choices of a select, with the saved value among them even when it is none of them. */
export function withSaved(choices: readonly number[], saved: number): number[] {
    return choices.includes(saved) ? [...choices] : [...choices, saved].sort((a, b) => a - b);
}

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

/** How far a time zone is ahead of UTC right now, in minutes. */
export function offsetMinutes(zone: string, at = new Date()): number {
    let format = offsetFormats.get(zone);
    if (!format) {
        try {
            format = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" });
        } catch {
            return 0;
        }
        offsetFormats.set(zone, format);
    }
    const name = format.formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!match) return 0;
    const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
    return match[1] === "-" ? -minutes : minutes;
}

/** "UTC+2", "UTC-3:30" or "UTC". */
export function offsetLabel(zone: string, at = new Date()): string {
    const minutes = offsetMinutes(zone, at);
    if (minutes === 0) return "UTC";
    const abs = Math.abs(minutes);
    const rest = abs % 60;
    return `UTC${minutes > 0 ? "+" : "-"}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/** "03:00 here is 01:00 UTC.", or that it is UTC itself. */
export function zoneExample(zone: string, at = new Date()): string {
    const offset = offsetMinutes(zone, at);
    if (offset === 0) return "Its clock is the one of UTC.";
    const utc = (((3 * 60 - offset) % 1440) + 1440) % 1440;
    const time = `${String(Math.floor(utc / 60)).padStart(2, "0")}:${String(utc % 60).padStart(2, "0")}`;
    return `03:00 here is ${time} UTC.`;
}

/** The fields that differ between two readings of a part, in its words. */
export function changesOf<T extends object>(before: T, after: T, fields: { [K in keyof T]?: { label: string; show?: (value: T[K]) => string } }): PartChange[] {
    const changes: PartChange[] = [];
    for (const key of Object.keys(fields) as (keyof T)[]) {
        const field = fields[key];
        if (!field || JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
        const show = field.show ?? ((value: T[typeof key]) => (typeof value === "boolean" ? (value ? "on" : "off") : String(value)));
        changes.push({ label: field.label, from: show(before[key]) || "empty", to: show(after[key]) || "empty" });
    }
    return changes;
}
