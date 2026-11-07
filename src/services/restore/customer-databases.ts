/**
 * The databases of a shared server that customers hold now, which an ordinary restore by the tenant
 * of the server would overwrite. The restore page marks them and asks before such a restore starts,
 * and `RestoreService` refuses one without `RestoreInput.overwriteCustomerDatabases`. The restore
 * checks again right before it writes, with the names it writes into, and refuses a database of a
 * customer the request did not confirm. On a Firebird server that gives databases away, a target
 * that is no saved alias asks the same confirmation, see `unsavedFirebirdTargets`. The customers
 * read nothing of it, the audit entry of the provider names them.
 */

import prisma from "@/lib/prisma";
import { ValidationError } from "@/lib/logging/errors";
import { resolveStorageAdapter } from "@/lib/archive/storage-source";
import { ownerAt } from "@/lib/tenant/database-owner";
import { runAsSystem } from "@/lib/tenant/context";
import { factsOf } from "@/services/tenant/owner-facts";
import { listedDatabases } from "@/services/tenant/shared-servers";
import { readBackupMetadata } from "./file-restore";
import { aliasesOfTarget } from "@/lib/adapters/database/firebird/connection";
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
    const server = await prisma.adapterConfig.findFirst({ where: { id: sourceId, type: "database" }, select: { tenantId: true, adapterId: true, config: true } });
    if (!server) return [];
    const facts = await factsOf(sourceId);
    if (facts.assignments.length === 0 && facts.rules.length === 0) return [];
    const candidates = names ? withAliases(server, names) : [
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

/**
 * The names with the Firebird aliases they reach. A Firebird restore writes into a path, which the
 * restore page fills in from the alias a customer holds, so a path counts as every alias whose file
 * it is, see `aliasesOfTarget`. The aliases and their paths hold no secret, so the stored config is
 * read as it is.
 */
function withAliases(server: { adapterId: string; config: string }, names: readonly string[]): string[] {
    if (server.adapterId !== "firebird") return [...names];
    const databases = savedAliases(server.config);
    return names.flatMap((name) => [name, ...aliasesOfTarget(databases, name)]);
}

/** The aliases a Firebird connection saves, with their paths. */
function savedAliases(config: string): { name: string; path: string }[] {
    try {
        const parsed: unknown = JSON.parse(config);
        const listed = (parsed as { databases?: unknown } | null)?.databases;
        if (!Array.isArray(listed)) return [];
        return listed.filter((entry): entry is { name: string; path: string } =>
            typeof entry?.name === "string" && typeof entry?.path === "string");
    } catch {
        // A config that does not parse names no alias, the names stay as they are.
        return [];
    }
}

/**
 * Of the targets of a restore into a Firebird server that gives databases to customers, those that
 * are no saved alias, neither by its name nor by its path. Such a target is a path the server
 * resolves itself, and the same file has more names than `aliasesOfTarget` can compare, like a
 * link, a mount or another spelling Firebird accepts, so a customer's database can hide behind it.
 * The restore asks the confirmation for them like for a database a customer holds. Empty for any
 * other server.
 */
export async function unsavedFirebirdTargets(sourceId: string, targets: readonly string[]): Promise<string[]> {
    if (targets.length === 0) return [];
    const server = await prisma.adapterConfig.findFirst({ where: { id: sourceId, type: "database" }, select: { adapterId: true, config: true } });
    if (server?.adapterId !== "firebird" || !(await givesToCustomers(sourceId))) return [];
    const databases = savedAliases(server.config);
    return [...new Set(targets)].filter((target) => aliasesOfTarget(databases, target).length === 0);
}

/** Refuses a restore into Firebird paths that are no saved alias, see `unsavedFirebirdTargets`. */
function unsavedTargetRefusal(targets: readonly string[], ending: string): ValidationError {
    const shown = targets.length > 5 ? `${targets.slice(0, 5).join(", ")} and ${targets.length - 5} more` : targets.join(", ");
    return new ValidationError(
        `The restore writes into ${shown}, which is no saved database of this Firebird server. The server gives databases to customers, and a path that is no saved alias may still reach one of theirs. ${ending}`,
        { field: "overwriteCustomerDatabases" }
    );
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
    if (input.overwriteCustomerDatabases !== true) {
        const unsaved = await unsavedFirebirdTargets(input.targetSourceId, names ?? (input.targetDatabaseName ? [input.targetDatabaseName] : []));
        if (unsaved.length > 0) throw unsavedTargetRefusal(unsaved, "Confirm overwriting to restore.");
    }
    return held;
}

function uniqueByName(held: readonly CustomerDatabase[]): CustomerDatabase[] {
    return [...new Map(held.map((entry) => [entry.database, entry])).values()].sort((a, b) => a.database.localeCompare(b.database));
}

/**
 * Refuses a customer's restore of a shared database the customer no longer holds: given to another
 * tenant, taken back, moved or its server deleted, or the customer tenant deleted since the restore
 * started. Read in the system scope, since the facts of the server belong to its tenant.
 */
async function assertStillHeld(input: RestoreInput, targetNames: readonly string[], now: Date): Promise<void> {
    const customer = input.shared?.tenantId;
    const sourceId = input.targetSourceId;
    const refused = (name: string) => new ValidationError(`${name} is no longer yours, so nothing was restored.`);
    if (!customer || !sourceId) throw refused(input.shared?.databaseName ?? "The database");
    await runAsSystem(async () => {
        const [tenant, server] = await Promise.all([
            prisma.tenant.findUnique({ where: { id: customer }, select: { id: true } }),
            prisma.adapterConfig.findFirst({ where: { id: sourceId, type: "database" }, select: { id: true } }),
        ]);
        if (!tenant || !server) throw refused(targetNames[0] ?? input.shared?.databaseName ?? "The database");
        const facts = await factsOf(sourceId);
        const lost = targetNames.find((name) => ownerAt(facts.assignments, facts.rules, name, now) !== customer);
        if (lost !== undefined) throw refused(lost);
    });
}

/**
 * The check right before a restore writes, with the names it really writes into: every database a
 * customer holds among them has to be one the request confirmed, `confirmedCustomerDatabases` of
 * the input, which `RestoreService` fills from `assertCustomerDatabasesConfirmed`. So a restore
 * never overwrites a customer's database the guard did not name, and the audit entry names every
 * customer it touches. A customer's own restore has to hold every database it writes into still,
 * and its tenant has to exist, see `assertStillHeld`. Called before the dumps are staged and again
 * before each database is written, since the tenant of the server may change who holds it meanwhile.
 */
export async function assertTargetsConfirmed(input: RestoreInput, targetNames: readonly string[], now = new Date()): Promise<void> {
    if (input.shared) return assertStillHeld(input, targetNames, now);
    if (!input.targetSourceId || targetNames.length === 0) return;
    const confirmed = new Set(input.confirmedCustomerDatabases ?? []);
    const unconfirmed = (await customerDatabases(input.targetSourceId, targetNames)).filter((entry) => !confirmed.has(entry.database));
    if (unconfirmed.length > 0) throw overwriteRefusal(unconfirmed, "The request did not confirm overwriting them, so nothing was restored.");
    if (input.overwriteCustomerDatabases !== true) {
        const unsaved = await unsavedFirebirdTargets(input.targetSourceId, targetNames);
        if (unsaved.length > 0) throw unsavedTargetRefusal(unsaved, "The request did not confirm it, so nothing was restored.");
    }
}
