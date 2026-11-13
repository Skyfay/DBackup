import prisma from "@/lib/prisma";
import type { Tx } from "@/lib/prisma-tx";
import { ValidationError } from "@/lib/logging/errors";
import { ownerAt, patternsMayOverlap, type RuleFact } from "@/lib/tenant/database-owner";
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

/** Refuses a tenant beyond the reach with `message`, which never names it, so it reads as gone. */
export function assertReached(reach: PlatformReach, tenantId: string, message: string): void {
    if (!reachCovers(reach, tenantId)) throw new ValidationError(message);
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
        if (change.tenantId) assertReached(reach, change.tenantId, OUTSIDE_REACH.give);
        const holder = ownerAt(assignments.filter((entry) => entry.databaseName === change.databaseName), rules, change.databaseName, now);
        if (holder) assertReached(reach, holder, OUTSIDE_REACH.holder(change.databaseName));
    }
}

/** Whether a rule still gives at the time or will, one that starts later included. */
const notEnded = (rule: RuleFact, now: Date) => !rule.validUntil || now.getTime() < rule.validUntil.getTime();

/** Whether `upper` wins a name both rules match, by the order of `ruleAt`. */
function ranksAbove(upper: RuleFact, lower: RuleFact): boolean {
    return (upper.priority - lower.priority || lower.createdAt.getTime() - upper.createdAt.getTime() || (lower.id ?? "").localeCompare(upper.id ?? "")) > 0;
}

/**
 * A rule of a tenant beyond the reach that `rule` ranks above and that can match a name `rule`
 * matches. The list DBackup last read from a server is a cache, a database made since is missing
 * from it, so the rules themselves decide what a change of `rule` gives to or takes from such a
 * tenant.
 */
function outrankedBeyondReach(rules: readonly RuleFact[], rule: RuleFact, reach: PlatformReach, now: Date): RuleFact | undefined {
    return rules.find((other) => other.id !== rule.id
        && notEnded(other, now)
        && !reachCovers(reach, other.tenantId)
        && ranksAbove(rule, other)
        && patternsMayOverlap(rule.pattern, other.pattern));
}

/**
 * Refuses a new rule for a tenant beyond the reach, and one that ranks above a rule of such a tenant
 * that can match the same names, also names the server gets later, or whose priority would take a
 * database the server holds now from such a tenant.
 */
export async function assertRuleReached(
    sourceId: string,
    rule: { pattern: string; tenantId: string; priority: number; validFrom: Date },
    reach: PlatformReach,
    now: Date
): Promise<void> {
    if (reach === "all") return;
    assertReached(reach, rule.tenantId, OUTSIDE_REACH.give);
    const [listed, facts] = await Promise.all([listedDatabases(sourceId), factsOf(sourceId)]);
    // The youngest rule, which loses every tie, like the one about to be stored.
    const added: RuleFact = { ...rule, validUntil: null, createdAt: now };
    for (const { name } of listed) {
        const before = ownerAt(facts.assignments, facts.rules, name, now);
        if (!before || reachCovers(reach, before)) continue;
        if (ownerAt(facts.assignments, [...facts.rules, added], name, now) !== before) {
            throw new ValidationError(OUTSIDE_REACH.takes(name));
        }
    }
    // A name the server gets later, or one DBackup has not read yet, would go the same way.
    if (outrankedBeyondReach(facts.rules, added, reach, now)) throw new ValidationError(OUTSIDE_REACH.takesRule);
}

/**
 * Refuses ending a rule while a rule of a tenant beyond the reach ranks below it and can match the
 * same names, since every such name would pass to that tenant, also one DBackup has not read from
 * the server yet. A database the server lists now that would pass to such a tenant another way is
 * refused by its name.
 */
export async function assertRuleEndReached(sourceId: string, rule: { id: string; pattern: string }, reach: PlatformReach, now: Date): Promise<void> {
    if (reach === "all") return;
    const [listed, facts] = await Promise.all([listedDatabases(sourceId), factsOf(sourceId)]);
    const ended = facts.rules.map((fact) => (fact.id === rule.id ? { ...fact, validUntil: now } : fact));
    for (const { name } of listed) {
        const after = ownerAt(facts.assignments, ended, name, now);
        if (!after || reachCovers(reach, after)) continue;
        if (after !== ownerAt(facts.assignments, facts.rules, name, now)) {
            throw new ValidationError(OUTSIDE_REACH.ruleEnd(rule.pattern, name));
        }
    }
    // A name the server gets later, or one DBackup has not read yet, would go the same way.
    const own = facts.rules.find((fact) => fact.id === rule.id);
    if (own && outrankedBeyondReach(facts.rules, own, reach, now)) throw new ValidationError(OUTSIDE_REACH.ruleEndFalls(rule.pattern));
}
