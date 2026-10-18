import prisma from "@/lib/prisma";
import type { Tx } from "@/lib/prisma-tx";
import { ValidationError } from "@/lib/logging/errors";
import { ownerAt, type RuleFact } from "@/lib/tenant/database-owner";
import { OUTSIDE_REACH, reachCovers, type PlatformReach } from "@/lib/tenant/sharing-reach";
import { factsOf } from "./shared-backups";
import { listedDatabases } from "./shared-servers";

/**
 * Who someone of a platform group of some tenants gives the databases of a shared server to: the
 * tenants their platform group reaches, and only from them. A database a tenant beyond the reach
 * holds, by name or by a rule, stays as it is, and so do its rules and its backups on demand. The
 * caller passes the reach of the person, `platformGroupService.reachOf`, `"all"` changes nothing.
 */

type Client = typeof prisma | Tx;

async function nameOf(client: Client, tenantId: string): Promise<string> {
    return (await client.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }))?.name ?? "another tenant";
}

/** Refuses a tenant beyond the reach, with the sentence `words` makes of its name. */
export async function assertReached(client: Client, reach: PlatformReach, tenantId: string, words: (tenant: string) => string): Promise<void> {
    if (reachCovers(reach, tenantId)) return;
    throw new ValidationError(words(await nameOf(client, tenantId)));
}

/**
 * Refuses a change of who holds a database that touches a tenant beyond the reach: giving it to such
 * a tenant, and taking it from such a tenant, back to the server's tenant or to another tenant.
 * Reads with the client of the transaction that writes the changes.
 */
export async function assertChangesReached(
    client: Client,
    sourceId: string,
    changes: readonly { databaseName: string; tenantId: string | null }[],
    rules: readonly RuleFact[],
    reach: PlatformReach,
    now: Date
): Promise<void> {
    if (reach === "all") return;
    const assignments = await client.databaseAssignment.findMany({ where: { sourceId, databaseName: { in: [...new Set(changes.map((change) => change.databaseName))] } } });
    for (const change of changes) {
        if (change.tenantId) await assertReached(client, reach, change.tenantId, OUTSIDE_REACH.give);
        const holder = ownerAt(assignments.filter((entry) => entry.databaseName === change.databaseName), rules, change.databaseName, now);
        if (holder) await assertReached(client, reach, holder, (tenant) => OUTSIDE_REACH.holder(change.databaseName, tenant));
    }
}

/**
 * Refuses a new rule for a tenant beyond the reach, and one whose priority would take a database the
 * server holds now from such a tenant's rule. Only the databases DBackup last read from the server
 * are known, a name the server gets later goes to whichever rule ranks highest.
 */
export async function assertRuleReached(
    sourceId: string,
    rule: { pattern: string; tenantId: string; priority: number; validFrom: Date },
    reach: PlatformReach,
    now: Date
): Promise<void> {
    if (reach === "all") return;
    await assertReached(prisma, reach, rule.tenantId, OUTSIDE_REACH.give);
    const [listed, facts] = await Promise.all([listedDatabases(sourceId), factsOf(sourceId)]);
    // The youngest rule, which loses every tie, like the one about to be stored.
    const added: RuleFact = { ...rule, validUntil: null, createdAt: now };
    for (const { name } of listed) {
        const before = ownerAt(facts.assignments, facts.rules, name, now);
        if (!before || reachCovers(reach, before)) continue;
        if (ownerAt(facts.assignments, [...facts.rules, added], name, now) !== before) {
            throw new ValidationError(OUTSIDE_REACH.takes(name, await nameOf(prisma, before)));
        }
    }
}
