import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

/**
 * A run that follows another one instead of doing work of its own, in the History of another tenant:
 * the provider's run of a customer's restore of a database on its shared server, with the whole log
 * (`src/services/restore/run-logs.ts`), and the customer's run of a backup they started of such a
 * database, with a short log of its own (`src/services/tenant/shared-backup-runs.ts`). Its metadata
 * names the run it follows under `followsRun`. The run it follows holds the slot of the queue and
 * the watchdog watches it, so both leave a follower out, and whatever ends that run early ends its
 * followers too.
 */

const log = logger.child({ module: "FollowerRuns" });

export const FOLLOWS_KEY = "followsRun";

const FOLLOWER_MARK = `"${FOLLOWS_KEY}"`;

/** The runs that do their own work, for a query of the executions: the queue and the watchdog read these alone. */
export const LEADING_RUNS: Prisma.ExecutionWhereInput = {
    OR: [{ metadata: null }, { NOT: { metadata: { contains: FOLLOWER_MARK } } }],
};

/** What a follower tells while the run it follows goes on. */
export interface RunFollower {
    /** The run it follows was taken from the queue. */
    start(): void;
    /** The run it follows moved on to a stage. */
    stage(stage: string): void;
    /** The run it follows ended. Its dumps tell the size of each database it backed up. */
    end(outcome: { status: string; dumps?: unknown }): Promise<void>;
}

/** The run a follower follows, from its stored metadata. */
export function leaderOf(metadata: string | null | undefined): string | null {
    if (!metadata?.includes(FOLLOWER_MARK)) return null;
    try {
        const value = (JSON.parse(metadata) as Record<string, unknown>)[FOLLOWS_KEY];
        return typeof value === "string" && value ? value : null;
    } catch {
        return null;
    }
}

/**
 * The followers of a run that are still waiting or running, in any tenant. Only these can still
 * change, which keeps the search to the few rows that wait or run.
 */
export function activeFollowersOf(leaderId: string) {
    return runAsSystem(() => prisma.execution.findMany({
        where: { status: { in: ["Pending", "Running"] }, metadata: { contains: `${FOLLOWER_MARK}:${JSON.stringify(leaderId)}` } },
        select: { id: true, logs: true, metadata: true, tenantId: true, startedAt: true },
    }));
}

/** What a customer's failed run says of the provider's run, which they cannot open. */
export const providerHint = (provider: string) => `${provider} sees the full run in its History.`;

const ENDED_LINE: Record<string, string> = {
    Cancelled: "The run was cancelled.",
    Failed: "The run stopped before it finished.",
};

/**
 * Ends the followers of a run that ended without its own steps to tell them, like one the watchdog
 * stopped or one cancelled before it started. The line says nothing of the run it follows, since
 * the follower may be in the History of a customer.
 */
export async function endFollowers(leaderId: string, status: "Failed" | "Cancelled"): Promise<void> {
    try {
        const followers = await activeFollowersOf(leaderId);
        for (const follower of followers) {
            let lines: unknown[] = [];
            try {
                lines = follower.logs ? JSON.parse(follower.logs) : [];
            } catch { /* a broken log starts again */ }
            lines.push({ timestamp: new Date().toISOString(), level: status === "Failed" ? "error" : "warning", type: "general", message: ENDED_LINE[status], stage: status });
            await runAsSystem(() => prisma.execution.updateMany({
                where: { id: follower.id, status: { in: ["Pending", "Running"] } },
                data: { status, endedAt: new Date(), logs: JSON.stringify(lines) },
            }));
        }
    } catch (error: unknown) {
        log.error("Ending the followers of a run failed", { leaderId }, wrapError(error));
    }
}
