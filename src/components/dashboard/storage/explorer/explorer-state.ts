import type { ExplorerDestination } from "@/services/storage/explorer-types";

/** Whether a destination's listing may be behind: it did not answer its last check, or could not be listed. */
export function isStale(destination: Pick<ExplorerDestination, "health" | "listError">): boolean {
    return destination.health.status === "OFFLINE" || destination.listError !== null;
}

/** Whether a destination answers right now, from the connection check that runs every minute. */
export type Answer = "online" | "missed" | "offline";

export function answerOf(destination: Pick<ExplorerDestination, "health">): Answer {
    if (destination.health.status === "OFFLINE") return "offline";
    if (destination.health.status === "DEGRADED") return "missed";
    return "online";
}
