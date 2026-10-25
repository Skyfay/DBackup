/**
 * The databases of a shared server that customers hold now, which an ordinary restore by the tenant
 * of the server would overwrite. The restore page marks them and asks before such a restore starts,
 * and `RestoreService` refuses one without `RestoreInput.overwriteCustomerDatabases`. The customers
 * read nothing of it, the audit entry of the provider names them.
 */

import prisma from "@/lib/prisma";
import { ValidationError } from "@/lib/logging/errors";
import { ownerAt } from "@/lib/tenant/database-owner";
import { factsOf } from "@/services/tenant/shared-backups";
import { listedDatabases } from "@/services/tenant/shared-servers";
import type { RestoreInput } from "./types";

/** A database of the server a customer holds now. */
export interface CustomerDatabase {
    database: string;
    tenantId: string;
    customer: string;
}

/**
 * Of the names, the databases of a server a customer holds now, by name or by a rule, with the name
 * of the customer. Null names every database the server lists or a customer holds by name, for a
 * restore of every database of a backup, whose names the request does not say.
 */
export async function customerDatabases(sourceId: string, names: readonly string[] | null, now = new Date()): Promise<CustomerDatabase[]> {
    const server = await prisma.adapterConfig.findFirst({ where: { id: sourceId, type: "database" }, select: { tenantId: true } });
    if (!server) return [];
    const facts = await factsOf(sourceId);
    if (facts.assignments.length === 0 && facts.rules.length === 0) return [];
    const candidates = names ?? [
        ...(await listedDatabases(sourceId)).map((entry) => entry.name),
        ...facts.assignments.filter((assignment) => assignment.validUntil === null && assignment.tenantId).map((assignment) => assignment.databaseName),
    ];
    const held = [...new Set(candidates)].flatMap((database) => {
        const tenantId = ownerAt(facts.assignments, facts.rules, database, now);
        return tenantId && tenantId !== server.tenantId ? [{ database, tenantId }] : [];
    });
    if (held.length === 0) return [];
    const tenants = await prisma.tenant.findMany({ where: { id: { in: [...new Set(held.map((entry) => entry.tenantId))] } }, select: { id: true, name: true } });
    const nameOf = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
    // A tenant deleted since holds nothing any more.
    return held
        .filter((entry) => nameOf.has(entry.tenantId))
        .map((entry) => ({ ...entry, customer: nameOf.get(entry.tenantId) as string }))
        .sort((a, b) => a.database.localeCompare(b.database));
}

/** The databases a restore writes into, by the names it goes under, null when it restores every database of the backup. */
export function restoredNames(input: RestoreInput): string[] | null {
    const mapping = Array.isArray(input.databaseMapping) ? input.databaseMapping : null;
    if (mapping && mapping.length > 0) return mapping.filter((entry) => entry.selected).map((entry) => entry.targetName || entry.originalName);
    if (input.targetDatabaseName) return [input.targetDatabaseName];
    return null;
}

/**
 * The customers' databases an ordinary restore overwrites, refused unless the request confirms it.
 * A customer's own restore of its database never asks, and a restore of files writes no database.
 */
export async function assertCustomerDatabasesConfirmed(input: RestoreInput): Promise<CustomerDatabase[]> {
    if (input.shared || !input.targetSourceId || input.scope === "files") return [];
    const held = await customerDatabases(input.targetSourceId, restoredNames(input));
    if (held.length > 0 && input.overwriteCustomerDatabases !== true) {
        const names = held.map((entry) => entry.database);
        const shown = names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", ");
        throw new ValidationError(`The restore would overwrite databases that customers hold now: ${shown}. Confirm overwriting them to restore.`, { field: "overwriteCustomerDatabases" });
    }
    return held;
}
