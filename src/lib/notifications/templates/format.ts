import { formatInTimeZone } from "date-fns-tz";
import { formatBytes } from "@/lib/utils";
import type { NotificationAction, TemplateOptions } from "../types";

/**
 * The words and links every template shares: times in the time zone of the instance, lengths
 * and sizes as the pages write them, and the paths of the pages a mail opens.
 */

export interface Formatter {
    /** 4 Oct 2026, 02:00 */
    date: (iso: string | undefined) => string | undefined;
    /** 02:00 */
    time: (iso: string | undefined) => string | undefined;
    /** 02:00:04 */
    clock: (iso: string | undefined) => string | undefined;
}

export function formatterFor(options?: TemplateOptions): Formatter {
    const zone = options?.timeZone || "UTC";
    const make = (pattern: string) => (iso: string | undefined) => {
        if (!iso) return undefined;
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return iso;
        try {
            return formatInTimeZone(date, zone, pattern);
        } catch {
            return formatInTimeZone(date, "UTC", pattern);
        }
    };
    return { date: make("d MMM yyyy, HH:mm"), time: make("HH:mm"), clock: make("HH:mm:ss") };
}

/** 4 s, 2 min 14 s, 1 h 3 min */
export function duration(ms: number): string {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

export function size(bytes: number): string {
    return formatBytes(bytes);
}

export function plural(count: number, word: string, many = `${word}s`): string {
    return `${count} ${count === 1 ? word : many}`;
}

/** "S3 Archive", "S3 Archive and NAS", "S3 Archive, NAS and 2 more" */
export function names(list: string[], shown = 2): string {
    if (list.length <= 1) return list[0] ?? "";
    if (list.length <= shown) return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
    return `${list.slice(0, shown).join(", ")} and ${list.length - shown} more`;
}

/** How long before `to` the time `from` was, like "2 days ago". */
export function ago(from: string, to: string): string | null {
    const ms = Date.parse(to) - Date.parse(from);
    if (!Number.isFinite(ms) || ms < 0) return null;
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 1) return "less than an hour ago";
    if (hours < 48) return `${plural(hours, "hour")} ago`;
    return `${Math.floor(hours / 24)} days ago`;
}

/** Who started a run, from the trigger an execution stores. */
export function startedBy(trigger: string | undefined): string | undefined {
    if (trigger === "Scheduler") return "Schedule";
    if (trigger === "Manual") return "By hand";
    if (trigger === "Api") return "API";
    return trigger;
}

export const paths = {
    run: (id: string) => `/dashboard/history/run?id=${encodeURIComponent(id)}&from=history`,
    job: (id: string) => `/dashboard/jobs?job=${encodeURIComponent(id)}`,
    /** A destination on the Backups page, with its alerts and its history. */
    storage: (id: string) => `/dashboard/backups?tab=destinations&destination=${encodeURIComponent(id)}`,
    connection: (kind: "database" | "storage", id: string) =>
        `/dashboard/connections?tab=${kind === "database" ? "databases" : "destinations"}&open=${encodeURIComponent(id)}`,
};

export function action(label: string, href: string | undefined, icon: NotificationAction["icon"]): NotificationAction[] {
    return href ? [{ label, href, icon }] : [];
}
