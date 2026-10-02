import type { ExplorerDestination } from "@/services/storage/explorer-types";

/**
 * Whether a destination's listing may be behind: it did not answer its last check, or could not be
 * listed. An air-gapped one that is away is listed again once it is connected, so it is not behind.
 */
export function isStale(destination: Pick<ExplorerDestination, "health" | "listError" | "airGapped">): boolean {
    if (destination.airGapped && destination.health.status !== "ONLINE") return false;
    return destination.health.status === "OFFLINE" || destination.listError !== null;
}

/**
 * Whether a destination answers right now, from the connection check that runs every minute.
 * `away` is an air-gapped one that is not connected, which is how it is meant to be.
 */
export type Answer = "online" | "missed" | "offline" | "away";

export function answerOf(destination: Pick<ExplorerDestination, "health" | "airGapped">): Answer {
    if (destination.airGapped && destination.health.status !== "ONLINE") return "away";
    if (destination.health.status === "OFFLINE") return "offline";
    if (destination.health.status === "DEGRADED") return "missed";
    return "online";
}
