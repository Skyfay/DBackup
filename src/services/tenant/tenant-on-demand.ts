import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { ON_DEMAND_MAX, ON_DEMAND_MIN } from "@/lib/tenant/sharing";
import { OUTSIDE_REACH, reachCovers, type PlatformReach } from "@/lib/tenant/sharing-reach";
import { sharingChanged } from "./shared-servers";

/**
 * Backups on demand of a customer as the platform sets them: how many backups a day it may start of
 * each database other tenants give it, and the databases and rules that set a number of their own
 * instead, which the tenant that shares them changes in its Database Explorer. Reads and writes
 * across tenants, so it runs in the system scope and its callers check the platform right. The
 * `PlatformReach` of the viewer bounds it: a tenant that shares beyond it shows by no name, and what
 * it gives is never changed from here.
 */

/** What a tenant that shares beyond the reach of the viewer is called. */
export const PROVIDER_BEYOND_REACH = "Another tenant";

/** A database given by name or a rule of a customer that sets a number of its own. */
export interface OnDemandOverride {
    kind: "database" | "rule";
    /** The id of the assignment or of the rule. */
    id: string;
    sourceId: string;
    serverName: string;
    /** The tenant the server belongs to, which shares it, none once it was deleted. */
    providerId: string | null;
    providerName: string;
    /** The name of the database, or the pattern of the rule. */
    name: string;
    /** 0 for none, else its own number a day. */
    perDay: number;
    /** The server belongs to a tenant beyond the viewer's reach, whose number they do not change. */
    beyondReach?: boolean;
}

export interface TenantOnDemand {
    name: string;
    /** The backups a day it may start of every database, null for none. */
    perDay: number | null;
    overrides: OnDemandOverride[];
}

/** A number a day for the customer, or null for none. */
function perDayValue(perDay: number | null): number | null {
    if (perDay === null) return null;
    if (!Number.isInteger(perDay) || perDay < ON_DEMAND_MIN || perDay > ON_DEMAND_MAX) throw new ValidationError(`Allow from ${ON_DEMAND_MIN} to ${ON_DEMAND_MAX} backups a day.`);
    return perDay;
}

export const tenantOnDemandService = {
    /**
     * The number of a customer and what its databases and rules of now set on their own. A tenant
     * that shares beyond `reach` shows as `PROVIDER_BEYOND_REACH`, without its id.
     */
    async find(tenantId: string, reach: PlatformReach = "all"): Promise<TenantOnDemand | null> {
        return runAsSystem(async () => {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, onDemandPerDay: true } });
            if (!tenant) return null;
            const [assignments, rules] = await Promise.all([
                prisma.databaseAssignment.findMany({
                    where: { tenantId, validUntil: null, onDemandPerDay: { not: null } },
                    select: { id: true, sourceId: true, databaseName: true, onDemandPerDay: true },
                }),
                prisma.databaseAssignmentRule.findMany({
                    where: { tenantId, validUntil: null, onDemandPerDay: { not: null } },
                    select: { id: true, sourceId: true, pattern: true, onDemandPerDay: true },
                }),
            ]);
            const servers = await prisma.sharedServer.findMany({
                where: { id: { in: [...new Set([...assignments, ...rules].map((entry) => entry.sourceId))] } },
                select: { id: true, name: true, tenantId: true },
            });
            const providers = await prisma.tenant.findMany({ where: { id: { in: [...new Set(servers.map((server) => server.tenantId))] } }, select: { id: true, name: true } });
            const serverOf = new Map(servers.map((server) => [server.id, server]));
            const providerOf = new Map(providers.map((provider) => [provider.id, provider.name]));
            const place = (sourceId: string) => {
                const server = serverOf.get(sourceId);
                const providerId = server && providerOf.has(server.tenantId) ? server.tenantId : null;
                if (providerId && !reachCovers(reach, providerId)) {
                    return { serverName: server?.name ?? "A deleted server", providerId: null, providerName: PROVIDER_BEYOND_REACH, beyondReach: true };
                }
                return {
                    serverName: server?.name ?? "A deleted server",
                    providerId,
                    providerName: (server && providerOf.get(server.tenantId)) ?? "A deleted tenant",
                };
            };
            const overrides: OnDemandOverride[] = [
                ...assignments.map((entry) => ({ kind: "database" as const, id: entry.id, sourceId: entry.sourceId, ...place(entry.sourceId), name: entry.databaseName, perDay: entry.onDemandPerDay as number })),
                ...rules.map((entry) => ({ kind: "rule" as const, id: entry.id, sourceId: entry.sourceId, ...place(entry.sourceId), name: entry.pattern, perDay: entry.onDemandPerDay as number })),
            ].sort((a, b) => a.serverName.localeCompare(b.serverName) || a.name.localeCompare(b.name));
            return { name: tenant.name, perDay: tenant.onDemandPerDay, overrides };
        });
    },

    /**
     * Sets how many backups a day a customer may start of every database given to it, none with
     * null. Any tenant can get databases of another one that shares, the home tenant too.
     */
    async set(tenantId: string, perDay: number | null): Promise<{ name: string; before: number | null; after: number | null }> {
        const after = perDayValue(perDay);
        return runAsSystem(async () => {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, onDemandPerDay: true } });
            if (!tenant) throw new NotFoundError("Tenant", tenantId);
            await prisma.tenant.update({ where: { id: tenantId }, data: { onDemandPerDay: after } });
            return { name: tenant.name, before: tenant.onDemandPerDay, after };
        });
    },

    /**
     * Lets a database or a rule of the customer follow the number of the customer again. Only one
     * of now, which the customer holds, and only on a server of a tenant `reach` covers, since it
     * changes what that tenant gave.
     */
    async follow(tenantId: string, kind: OnDemandOverride["kind"], id: string, reach: PlatformReach = "all"): Promise<OnDemandOverride & { tenantName: string }> {
        const found = await this.find(tenantId);
        const current = found?.overrides.find((entry) => entry.kind === kind && entry.id === id);
        if (!found || !current) throw new NotFoundError(kind === "rule" ? "Rule" : "Database", id);
        if (reach !== "all" && !(current.providerId && reachCovers(reach, current.providerId))) {
            throw new ValidationError(OUTSIDE_REACH.provider(current.serverName));
        }
        await runAsSystem(() => (kind === "rule"
            ? prisma.databaseAssignmentRule.update({ where: { id }, data: { onDemandPerDay: null } })
            : prisma.databaseAssignment.update({ where: { id }, data: { onDemandPerDay: null } })));
        sharingChanged();
        return { ...current, tenantName: found.name };
    },
};
