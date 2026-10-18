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
 * followers too. A follower whose run is gone or ended without it is ended by the watchdog through
 * `endOrphanedFollowers`.
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

const ENDED_LINE: Record<FollowerEnd, string> = {
    Cancelled: "The run was cancelled.",
    Failed: "The run stopped before it finished.",
    Success: "The run it follows ended, so this one ends with it.",
    Partial: "The run it follows ended with something missing, so this one ends with it.",
};

/** How a follower ends: like its run when that one ended, failed or cancelled otherwise. */
export type FollowerEnd = "Failed" | "Cancelled" | "Success" | "Partial";

/**
 * Ends the followers of a run that ended without its own steps to tell them, like one the watchdog
 * stopped or one cancelled before it started. The line says nothing of the run it follows, since
 * the follower may be in the History of a customer.
 */
export async function endFollowers(leaderId: string, status: FollowerEnd): Promise<void> {
    try {
        const followers = await activeFollowersOf(leaderId);
        for (const follower of followers) {
            let lines: unknown[] = [];
            try {
                lines = follower.logs ? JSON.parse(follower.logs) : [];
            } catch { /* a broken log starts again */ }
            const level = status === "Failed" ? "error" : status === "Success" ? "success" : "warning";
            lines.push({ timestamp: new Date().toISOString(), level, type: "general", message: ENDED_LINE[status], stage: status === "Success" || status === "Partial" ? "Completed" : status });
            await runAsSystem(() => prisma.execution.updateMany({
                where: { id: follower.id, status: { in: ["Pending", "Running"] } },
                data: { status, endedAt: new Date(), logs: JSON.stringify(lines) },
            }));
        }
    } catch (error: unknown) {
        log.error("Ending the followers of a run failed", { leaderId }, wrapError(error));
    }
}

/**
 * How long a follower may wait for the run it follows to show up, or to end it. The customer's run
 * of a backup is recorded right before the run it follows, and a run that just ended may still be
 * writing its followers.
 */
export const ORPHAN_GRACE_MS = 10 * 60_000;

const LIVE = new Set(["Pending", "Running"]);
/** The ends of a run a follower takes over. */
const ENDED = new Set(["Success", "Partial", "Failed", "Cancelled"]);

/**
 * Ends the followers, waiting or running in any tenant, whose run is gone, like one of a tenant that
 * was deleted, or ended without them, like a restore whose write of the provider's run failed. A
 * follower of a cancelled run is cancelled, any other one fails. Returns how many followers it ended.
 */
export async function endOrphanedFollowers(now: number = Date.now()): Promise<number> {
    try {
        const followers = await runAsSystem(() => prisma.execution.findMany({
            where: { status: { in: ["Pending", "Running"] }, metadata: { contains: FOLLOWER_MARK } },
            select: { id: true, metadata: true, startedAt: true },
        }));
        const byLeader = new Map<string, Date[]>();
        for (const follower of followers) {
            const leaderId = leaderOf(follower.metadata);
            if (leaderId) byLeader.set(leaderId, [...(byLeader.get(leaderId) ?? []), follower.startedAt]);
        }
        if (byLeader.size === 0) return 0;

        const leaders = await runAsSystem(() => prisma.execution.findMany({
            where: { id: { in: [...byLeader.keys()] } },
            select: { id: true, status: true, endedAt: true },
        }));
        const found = new Map(leaders.map((leader) => [leader.id, leader]));
        let ended = 0;
        for (const [leaderId, started] of byLeader) {
            const leader = found.get(leaderId);
            if (leader && LIVE.has(leader.status)) continue;
            // A run that is gone counts from the follower that waited longest, one that ended from its end.
            const since = leader?.endedAt?.getTime() ?? Math.min(...started.map((date) => date.getTime()));
            if (now - since < ORPHAN_GRACE_MS) continue;
            // A run that ended takes its followers along with its outcome, one that is gone fails them.
            await endFollowers(leaderId, leader && ENDED.has(leader.status) ? (leader.status as FollowerEnd) : "Failed");
            ended += started.length;
        }
        if (ended > 0) log.warn("Ended runs whose run they follow is gone or over", { ended });
        return ended;
    } catch (error: unknown) {
        log.error("Ending the followers of runs that are over failed", {}, wrapError(error));
        return 0;
    }
}
