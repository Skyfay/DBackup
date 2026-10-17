import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { ON_DEMAND_MAX, ON_DEMAND_MIN } from "@/lib/tenant/sharing";

/**
 * Backups on demand of a customer as the platform sets them: how many backups a day it may start of
 * each database other tenants give it, and the databases and rules that set a number of their own
 * instead, which the tenant that shares them changes in its Database Explorer. Reads and writes
 * across tenants, so it runs in the system scope and its callers check the platform right.
 */

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
    /** The number of a customer and what its databases and rules of now set on their own. */
    async find(tenantId: string): Promise<TenantOnDemand | null> {
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
                return {
                    serverName: server?.name ?? "A deleted server",
                    providerId: server && providerOf.has(server.tenantId) ? server.tenantId : null,
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

    /** Sets how many backups a day a customer may start of every database given to it, none with null. */
    async set(tenantId: string, perDay: number | null): Promise<{ name: string; before: number | null; after: number | null }> {
        if (tenantId === HOME_TENANT_ID) throw new ValidationError("The home tenant holds what the platform owns and backs it up with its own jobs.");
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
     * of now, which the customer holds.
     */
    async follow(tenantId: string, kind: OnDemandOverride["kind"], id: string): Promise<OnDemandOverride & { tenantName: string }> {
        const found = await this.find(tenantId);
        const current = found?.overrides.find((entry) => entry.kind === kind && entry.id === id);
        if (!found || !current) throw new NotFoundError(kind === "rule" ? "Rule" : "Database", id);
        await runAsSystem(() => (kind === "rule"
            ? prisma.databaseAssignmentRule.update({ where: { id }, data: { onDemandPerDay: null } })
            : prisma.databaseAssignment.update({ where: { id }, data: { onDemandPerDay: null } })));
        return { ...current, tenantName: found.name };
    },
};
