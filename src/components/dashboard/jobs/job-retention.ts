import type { JobListItem } from "@/services/jobs/job-list-service";

type Destination = Pick<JobListItem["destinations"][number], "retention" | "retentionPolicy">;

/**
 * What a destination keeps, in a few words: the policy it follows, the default policy, or the
 * older inline setting of a job saved before policies existed.
 */
export function retentionLabel(destination: Destination): string {
    if (destination.retentionPolicy) return destination.retentionPolicy.name;
    const raw = destination.retention?.trim();
    if (!raw || raw === "{}") return "Default policy";
    try {
        const parsed = JSON.parse(raw) as { mode?: string; simple?: { keepCount?: number } };
        if (parsed.mode === "SIMPLE" && typeof parsed.simple?.keepCount === "number") return `Last ${parsed.simple.keepCount}`;
        if (parsed.mode === "SMART") return "Smart rotation";
        if (parsed.mode === "NONE") return "Everything";
    } catch {
        // Unreadable inline retention keeps everything, like the runner does.
    }
    return "Everything";
}
