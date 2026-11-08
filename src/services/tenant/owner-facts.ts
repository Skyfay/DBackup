import prisma from "@/lib/prisma";
import type { AssignmentFact, RuleFact } from "@/lib/tenant/database-owner";

/**
 * Who a database of a server belonged to and when, as `database-owner.ts` reads it. Apart from
 * `shared-backups.ts`, which reads the listings of the destinations too, so a check of who holds a
 * database, like the one of a restore, loads no storage.
 */
export interface OwnerFacts {
    assignments: AssignmentFact[];
    rules: RuleFact[];
}

export async function factsOf(sourceId: string): Promise<OwnerFacts> {
    const [assignments, rules] = await Promise.all([
        prisma.databaseAssignment.findMany({ where: { sourceId }, select: { databaseName: true, tenantId: true, validFrom: true, validUntil: true, movedToSourceId: true, createdAt: true } }),
        prisma.databaseAssignmentRule.findMany({ where: { sourceId }, select: { id: true, pattern: true, tenantId: true, priority: true, validFrom: true, validUntil: true, createdAt: true } }),
    ]);
    return { assignments, rules };
}
