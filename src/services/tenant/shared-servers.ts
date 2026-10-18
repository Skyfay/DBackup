import prisma from "@/lib/prisma";
import type { Tx } from "@/lib/prisma-tx";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { ON_DEMAND_MAX, ON_DEMAND_MIN, ON_DEMAND_OFF } from "@/lib/tenant/sharing";

/**
 * The servers whose databases are given to customers, each as a SharedServer beside its connection,
 * with the same id. It keeps the name, the engine and the tenant of the server, and the assignments
 * and rules hang off it rather than off the connection. So a deleted connection leaves them as they
 * are: its customers keep the backups of their time to download, and the connection comes back
 * with all of them when it is restored from Recently deleted. Beside it the checks every change of
 * an assignment, a rule or a move goes through.
 */

/** The fields of a connection a SharedServer copies. */
export interface ServerFacts {
    id: string;
    name: string;
    adapterId: string;
    tenantId: string;
}

type Client = typeof prisma | Tx;

/**
 * Whether the servers of a tenant give databases to other tenants: a tenant of the MSP the platform
 * switched on, the home tenant from the start. A customer's own servers never do, so its data
 * stays its own whoever holds the right to share.
 */
export async function sharesWithCustomers(tenantId: string | null | undefined): Promise<boolean> {
    if (!tenantId) return false;
    return (await prisma.tenant.findUnique({ where: { id: tenantId }, select: { sharesWithCustomers: true } }))?.sharesWithCustomers ?? false;
}

export const NOT_SHARING = "The servers of this tenant give no databases to other tenants. The platform switches it on for a tenant of the MSP.";

/** The database server of the tenant that runs now, or a NotFoundError. */
export async function ownSource(sourceId: string): Promise<ServerFacts> {
    const source = await prisma.adapterConfig.findFirst({ where: { id: sourceId, type: "database" }, select: { id: true, name: true, adapterId: true, tenantId: true } });
    if (!source) throw new NotFoundError("Source", sourceId);
    return source;
}

/**
 * A tenant a database of the server can be given to: another one, which still exists. It may share
 * databases itself, a database it gets is no server of its own, so it never passes it on.
 */
export async function assertCustomer(tenantId: string, serverTenantId: string): Promise<void> {
    if (!(await sharesWithCustomers(serverTenantId))) throw new ValidationError(NOT_SHARING);
    if (tenantId === serverTenantId) throw new ValidationError("A database of this server belongs to this tenant already. Pick another tenant.");
    if (!(await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw new ValidationError("The tenant no longer exists.");
}

/** What a database or a rule stores for backups on demand: null as the customer, 0 none, else a number of backups a day. */
export function onDemandValue(perDay: number | null | undefined): number | null {
    if (perDay === null || perDay === undefined) return null;
    if (perDay === ON_DEMAND_OFF) return ON_DEMAND_OFF;
    if (!Number.isInteger(perDay) || perDay < ON_DEMAND_MIN || perDay > ON_DEMAND_MAX) {
        throw new ValidationError(`Allow from ${ON_DEMAND_MIN} to ${ON_DEMAND_MAX} backups a day.`);
    }
    return perDay;
}

/** The databases of a stored list of a server, by name with their size when it was read. */
export function parseListed(json: string): { name: string; sizeInBytes: number | null }[] {
    try {
        const value: unknown = JSON.parse(json);
        if (!Array.isArray(value)) return [];
        return value.flatMap((entry) => {
            if (typeof entry === "string") return [{ name: entry, sizeInBytes: null }];
            if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
                const size = (entry as { sizeInBytes?: unknown }).sizeInBytes;
                return [{ name: (entry as { name: string }).name, sizeInBytes: typeof size === "number" ? size : null }];
            }
            return [];
        });
    } catch {
        return [];
    }
}

/** The databases of a server as it was last read, the source of the list the owner assigns from. */
export async function listedDatabases(sourceId: string): Promise<{ name: string; sizeInBytes: number | null }[]> {
    const cache = await prisma.databaseListCache.findUnique({ where: { adapterConfigId: sourceId }, select: { databasesJson: true } });
    return cache ? parseListed(cache.databasesJson) : [];
}

/** Records a server as shared, or refreshes its name and engine, before an assignment or a rule names it. */
export async function rememberServer(client: Client, server: ServerFacts): Promise<void> {
    await client.sharedServer.upsert({
        where: { id: server.id },
        create: { id: server.id, name: server.name, adapterId: server.adapterId, tenantId: server.tenantId },
        update: { name: server.name, adapterId: server.adapterId, deletedAt: null },
    });
}

/**
 * Keeps the name and the engine a server had when its connection is deleted, in the transaction of
 * the delete. A server whose databases were never given away has nothing to keep.
 */
export async function keepDeletedServer(tx: Tx, server: Pick<ServerFacts, "id" | "name" | "adapterId">, at = new Date()): Promise<void> {
    await tx.sharedServer.updateMany({ where: { id: server.id }, data: { name: server.name, adapterId: server.adapterId, deletedAt: at } });
}

/** A connection back from Recently deleted shares its databases again, with the same assignments. */
export async function serverRestored(tx: Tx, id: string): Promise<void> {
    await tx.sharedServer.updateMany({ where: { id }, data: { deletedAt: null } });
}

/** The names of servers by their ids: the live name of a connection, else the one kept of a deleted server. */
export async function serverNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const [kept, live] = await Promise.all([
        prisma.sharedServer.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }),
        prisma.adapterConfig.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }),
    ]);
    return new Map([...kept, ...live].map((server) => [server.id, server.name]));
}

/**
 * The customers who hold a database of a server now, by an assignment or a rule, for the warning
 * before the server is deleted: they keep its backups to download and restore none of them.
 */
export async function customersOfServer(sourceId: string): Promise<string[]> {
    const [assignments, rules] = await Promise.all([
        prisma.databaseAssignment.findMany({ where: { sourceId, validUntil: null, tenantId: { not: null } }, select: { tenantId: true } }),
        prisma.databaseAssignmentRule.findMany({ where: { sourceId, validUntil: null }, select: { tenantId: true } }),
    ]);
    const ids = [...new Set([...assignments, ...rules].flatMap((entry) => (entry.tenantId ? [entry.tenantId] : [])))];
    // A tenant deleted since holds nothing any more.
    const tenants = await prisma.tenant.findMany({ where: { id: { in: ids } }, select: { name: true } });
    return tenants.map((tenant) => tenant.name).sort((a, b) => a.localeCompare(b));
}

// On globalThis, so the pages and the actions of every module graph count the same changes.
const globalForSharing = globalThis as unknown as { __dbackupSharingVersion?: { value: number } };
const version = (globalForSharing.__dbackupSharingVersion ??= { value: 0 });

/**
 * Counts a change of who holds a database of a shared server: an assignment, a rule, a move, its
 * backups on demand or a deleted tenant. A cache of what a customer holds names the count in its
 * key, so a change shows at once. Called once the change is stored.
 */
export function sharingChanged(): void {
    version.value++;
}

/** How many changes of who holds a database this process saw, see `sharingChanged`. */
export const sharingVersion = (): number => version.value;

/** The backups a day the platform lets each customer start of every database given to it, by tenant, null for none. */
export async function tenantOnDemand(tenantIds: readonly string[]): Promise<Map<string, number | null>> {
    if (tenantIds.length === 0) return new Map();
    const tenants = await prisma.tenant.findMany({ where: { id: { in: [...new Set(tenantIds)] } }, select: { id: true, onDemandPerDay: true } });
    return new Map(tenants.map((tenant) => [tenant.id, tenant.onDemandPerDay]));
}
