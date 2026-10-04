import type { TemplateJob } from "@/services/templates/templates-types";

/** "1 job", "3 jobs". */
export function count(value: number, noun: string, plural = `${noun}s`): string {
    return `${value.toLocaleString()} ${value === 1 ? noun : plural}`;
}

/** The first names and how many more, like "Shop nightly, CRM daily" and 3. */
export function namesOf(names: string[], shown = 2): { text: string; more: number } {
    return { text: names.slice(0, shown).join(", "), more: Math.max(0, names.length - shown) };
}

/** "Every day at 03:00" in the middle of a sentence, "every day at 03:00". A leading day name keeps its capital. */
export function lowerFirst(text: string): string {
    return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/** "Shop nightly and 2 more". */
export function listed(names: string[]): string {
    const { text, more } = namesOf(names, 1);
    return more > 0 ? `${text} and ${more} more` : text;
}

export type TemplateQuick = "all" | "used" | "unused";

export const QUICK_LABELS: Record<TemplateQuick, string> = { all: "All", used: "In use", unused: "Unused" };

/** The quick filters of a tab, each with how many rows it leaves. */
export function quickOptions<T>(rows: T[], inUse: (row: T) => boolean) {
    return (["all", "used", "unused"] as const).map((value) => ({
        value,
        label: QUICK_LABELS[value],
        count: rows.filter((row) => matchesQuick(row, value, inUse)).length,
    }));
}

export function matchesQuick<T>(row: T, quick: TemplateQuick, inUse: (row: T) => boolean): boolean {
    if (quick === "used") return inUse(row);
    if (quick === "unused") return !inUse(row);
    return true;
}

/** The jobs of the model by id, for the rows that name them. */
export function jobsById(jobs: TemplateJob[]): Map<string, TemplateJob> {
    return new Map(jobs.map((job) => [job.id, job]));
}

/** The job page with the details of a job open. */
export function jobHref(jobId: string): string {
    return `/dashboard/jobs?job=${encodeURIComponent(jobId)}`;
}

/** The Connections page on the destinations, with the details of one open. */
export function destinationHref(destinationId: string): string {
    return `/dashboard/connections?tab=destinations&open=${encodeURIComponent(destinationId)}`;
}
