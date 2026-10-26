/**
 * The databases of a shared server that customers hold now, which an ordinary restore by the tenant
 * of the server would overwrite. The restore page marks them and asks before such a restore starts,
 * and `RestoreService` refuses one without `RestoreInput.overwriteCustomerDatabases`. The restore
 * checks again right before it writes, with the names it writes into, and refuses a database of a
 * customer the request did not confirm. The customers read nothing of it, the audit entry of the
 * provider names them.
 */

import prisma from "@/lib/prisma";
import { ValidationError } from "@/lib/logging/errors";
import { resolveStorageAdapter } from "@/lib/archive/storage-source";
import { ownerAt } from "@/lib/tenant/database-owner";
import { factsOf } from "@/services/tenant/owner-facts";
import { listedDatabases } from "@/services/tenant/shared-servers";
import { readBackupMetadata } from "./file-restore";
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

/** Whether the server exists and a database or a rule of it went to a customer at any time. */
async function givesToCustomers(sourceId: string): Promise<boolean> {
    const server = await prisma.adapterConfig.findFirst({ where: { id: sourceId, type: "database" }, select: { id: true } });
    if (!server) return false;
    const facts = await factsOf(sourceId);
    return facts.assignments.length > 0 || facts.rules.length > 0;
}

/**
 * The names of the databases a backup holds, as its metadata lists them, null when it lists none or
 * cannot be read. An archive and a backup of an earlier version both list them there.
 */
async function backupDatabaseNames(input: RestoreInput): Promise<string[] | null> {
    try {
        const { adapter, config } = await resolveStorageAdapter(input.storageConfigId);
        const meta = await readBackupMetadata(adapter, config, input.file);
        const listed: unknown = Array.isArray(meta.databases) ? meta.databases : meta.databases?.names ?? meta.multiDb?.databases;
        const names = (Array.isArray(listed) ? listed : []).filter((name): name is string => typeof name === "string" && name !== "");
        return names.length > 0 ? [...new Set(names)] : null;
    } catch {
        // Unread, the guard counts every database of the server, see `assertCustomerDatabasesConfirmed`.
        return null;
    }
}

/**
 * The databases a restore writes into, by the names it goes under, as the restore picks them: the
 * mapping when it names any, else every database of the backup under its own name, and a backup of
 * one database under `targetDatabaseName` (see `resolveDatabaseTarget`). Null for a backup whose
 * metadata does not list its databases.
 */
export async function restoredNames(input: RestoreInput): Promise<string[] | null> {
    const mapping = Array.isArray(input.databaseMapping) ? input.databaseMapping : null;
    if (mapping && mapping.length > 0) return mapping.filter((entry) => entry.selected).map((entry) => entry.targetName || entry.originalName);
    const names = await backupDatabaseNames(input);
    if (!names) return null;
    if (!input.targetDatabaseName) return names;
    // A backup of an earlier version with several databases in one dump may still take the name.
    return names.length === 1 ? [input.targetDatabaseName] : [...new Set([...names, input.targetDatabaseName])];
}

/** Refuses a restore over databases customers hold. */
function overwriteRefusal(held: readonly CustomerDatabase[], ending: string): ValidationError {
    const names = held.map((entry) => entry.database);
    const shown = names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", ");
    return new ValidationError(`The restore would overwrite databases that customers hold now: ${shown}. ${ending}`, { field: "overwriteCustomerDatabases" });
}

/**
 * The customers' databases an ordinary restore overwrites, refused unless the request confirms it.
 * A customer's own restore of its database never asks, and a restore of files writes no database.
 * A backup whose databases are unknown counts every database of the server and `targetDatabaseName`.
 */
export async function assertCustomerDatabasesConfirmed(input: RestoreInput): Promise<CustomerDatabase[]> {
    if (input.shared || !input.targetSourceId || input.scope === "files") return [];
    // A server nobody was given anything on asks nothing, without reading the backup.
    if (!(await givesToCustomers(input.targetSourceId))) return [];
    const names = await restoredNames(input);
    const held = names
        ? await customerDatabases(input.targetSourceId, names)
        : uniqueByName([
            ...(await customerDatabases(input.targetSourceId, null)),
            ...(input.targetDatabaseName ? await customerDatabases(input.targetSourceId, [input.targetDatabaseName]) : []),
        ]);
    if (held.length > 0 && input.overwriteCustomerDatabases !== true) {
        throw overwriteRefusal(held, "Confirm overwriting them to restore.");
    }
    return held;
}

function uniqueByName(held: readonly CustomerDatabase[]): CustomerDatabase[] {
    return [...new Map(held.map((entry) => [entry.database, entry])).values()].sort((a, b) => a.database.localeCompare(b.database));
}

/**
 * The check right before a restore writes, with the names it really writes into: every database a
 * customer holds among them has to be one the request confirmed, `confirmedCustomerDatabases` of
 * the input, which `RestoreService` fills from `assertCustomerDatabasesConfirmed`. So a restore
 * never overwrites a customer's database the guard did not name, and the audit entry names every
 * customer it touches.
 */
export async function assertTargetsConfirmed(input: RestoreInput, targetNames: readonly string[]): Promise<void> {
    if (input.shared || !input.targetSourceId || targetNames.length === 0) return;
    const confirmed = new Set(input.confirmedCustomerDatabases ?? []);
    const unconfirmed = (await customerDatabases(input.targetSourceId, targetNames)).filter((entry) => !confirmed.has(entry.database));
    if (unconfirmed.length > 0) throw overwriteRefusal(unconfirmed, "The request did not confirm overwriting them, so nothing was restored.");
}
