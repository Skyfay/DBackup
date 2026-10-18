import { OUTSIDE_REACH } from "@/lib/tenant/sharing-reach";
import type { DatabaseOwnerRow, RuleRow, SourceAssignments } from "@/services/tenant/database-assignments";
import type { RuleEffect } from "./assignment-model";

/**
 * What the card locks for someone of a platform group of some tenants. The server lists the tenants
 * the viewer may give to in `customers`, so a tenant missing there lies beyond the reach: a database
 * it holds, a rule that gives to it and a new rule that would take one from it stay as they are. The
 * server refuses the same with the same words.
 */

type Customers = Pick<SourceAssignments, "customers">;

/** Whether the viewer may give to and take from a tenant. */
export const reaches = (data: Customers, tenantId: string): boolean => data.customers.some((tenant) => tenant.id === tenantId);

/** Why a database cannot change hands for the viewer, null when it can. */
export function ownerLock(row: DatabaseOwnerRow, data: Customers): string | null {
    return row.owner && !reaches(data, row.owner.tenantId) ? OUTSIDE_REACH.holder(row.name, row.owner.tenantName) : null;
}

/** Why a rule cannot be removed or changed by the viewer, null when it can. */
export function ruleLock(rule: RuleRow, data: Customers): string | null {
    return reaches(data, rule.tenantId) ? null : OUTSIDE_REACH.rule(rule.pattern, rule.tenantName);
}

/** Why a new rule cannot be added: it would take a database the server holds now from a tenant beyond the reach. */
export function ruleTakeover(data: Customers & Pick<SourceAssignments, "databases">, effects: readonly RuleEffect[]): string | null {
    for (const effect of effects) {
        if (effect.outcome !== "gains") continue;
        const owner = data.databases.find((row) => row.name === effect.name)?.owner;
        if (owner && !reaches(data, owner.tenantId)) return OUTSIDE_REACH.takes(effect.name, owner.tenantName);
    }
    return null;
}
