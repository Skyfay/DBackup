import type { Prisma } from "@prisma/client";

/**
 * Which execution an incremental job builds its next snapshot on: the newest successful run
 * that belongs to a chain.
 *
 * Shared by the chain planner and execution history cleanup. Cleanup must never remove a run
 * of the chain the planner is about to extend, so both have to agree on what that chain is.
 */
export function latestChainSnapshotWhere(jobId: string): Prisma.ExecutionWhereInput {
    return {
        jobId,
        type: "Backup",
        status: { in: ["Success", "Partial"] },
        chainId: { not: null },
        path: { not: null },
    };
}
