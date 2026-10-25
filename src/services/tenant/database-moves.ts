import prisma from "@/lib/prisma";
import { ValidationError } from "@/lib/logging/errors";
import { ownerAt, ruleAt } from "@/lib/tenant/database-owner";
import { OUTSIDE_REACH, reachCovers, type PlatformReach } from "@/lib/tenant/sharing-reach";
import { assertReached } from "./assignment-reach";
import type { AssignmentWithTenant, MovePlace } from "./database-assignments";
import { factsOf } from "./shared-backups";
import { assertSharesSingleDatabases, listedDatabases, NOT_SHARING, ownSource, rememberServer, serverNames, sharesWithCustomers, sharingChanged } from "./shared-servers";

/**
 * A database of a shared server that moved to another server of the same tenant, under the same
 * name or a new one. The assignment of the customer ends on the old server with the place it went
 * to, and one of the same customer starts on the new server at that moment. The customer keeps one
 * database with its backups from both servers, and a backup of the old server restores into the
 * database at its new place. From the move on no rule of the old server gives the name.
 */

export interface MoveInput {
    databaseName: string;
    toSourceId: string;
    /** The name on the new server, the same one when left out. */
    toDatabase?: string;
}

export interface MoveResult {
    tenantName: string;
    toServerName: string;
    toDatabase: string;
}

/** A server a database can move to: one of the same engine in the same tenant, with the databases it holds. */
export interface MoveTarget {
    id: string;
    name: string;
    databases: string[];
}

/** Both ends of the moves of a server's assignments: where each went, and where each came from. */
export async function movesOf(sourceId: string, assignments: readonly AssignmentWithTenant[]) {
    const arrivals = await prisma.databaseAssignment.findMany({
        where: { movedToSourceId: sourceId },
        select: { sourceId: true, databaseName: true, tenantId: true, validUntil: true, movedToDatabase: true },
    });
    const names = await serverNames([...new Set([
        ...assignments.flatMap((assignment) => (assignment.movedToSourceId ? [assignment.movedToSourceId] : [])),
        ...arrivals.map((arrival) => arrival.sourceId),
    ])]);
    const place = (id: string, databaseName: string): MovePlace => ({ sourceId: id, serverName: names.get(id) ?? "A former server", databaseName });
    return {
        to: (assignment: AssignmentWithTenant): MovePlace | null =>
            assignment.movedToSourceId ? place(assignment.movedToSourceId, assignment.movedToDatabase || assignment.databaseName) : null,
        // The move ended the assignment there when this one started.
        from: (assignment: AssignmentWithTenant): MovePlace | null => {
            const arrival = arrivals.find((entry) => entry.tenantId === assignment.tenantId
                && (entry.movedToDatabase || entry.databaseName) === assignment.databaseName
                && entry.validUntil?.getTime() === assignment.validFrom.getTime());
            return arrival ? place(arrival.sourceId, arrival.databaseName) : null;
        },
    };
}

/**
 * The servers a database of a server can move to, by name: those of the same engine in the tenant of
 * the server. Each names its databases but those a tenant beyond the reach holds now, so someone of
 * a platform group of some tenants never learns the databases of the other customers.
 */
export async function moveTargets(sourceId: string, reach: PlatformReach = "all", now = new Date()): Promise<MoveTarget[]> {
    const source = await ownSource(sourceId);
    const servers = await prisma.adapterConfig.findMany({
        where: { type: "database", adapterId: source.adapterId, tenantId: source.tenantId, id: { not: source.id } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
    return Promise.all(servers.map(async (server) => {
        const [listed, facts] = await Promise.all([listedDatabases(server.id), reach === "all" ? null : factsOf(server.id)]);
        const shown = (name: string) => {
            if (!facts) return true;
            const holder = ownerAt(facts.assignments, facts.rules, name, now);
            return !holder || holder === source.tenantId || reachCovers(reach, holder);
        };
        return { ...server, databases: listed.map((entry) => entry.name).filter(shown).sort((a, b) => a.localeCompare(b)) };
    }));
}

/**
 * Marks a database of a customer as moved to another server. Only a database a customer holds now
 * moves, only to a server of the same engine, so its backups restore there, and never onto a name
 * that another customer holds on the new server. Someone of a platform group of some tenants moves
 * only the databases of the tenants it reaches.
 */
export async function moveDatabase(sourceId: string, input: MoveInput, by: string | null, now = new Date(), reach: PlatformReach = "all"): Promise<MoveResult> {
    const [from, to] = await Promise.all([ownSource(sourceId), ownSource(input.toSourceId)]);
    const databaseName = input.databaseName.trim();
    const toDatabase = (input.toDatabase ?? databaseName).trim();
    if (!databaseName || !toDatabase) throw new ValidationError("Name the database.");
    if (!(await sharesWithCustomers(from.tenantId))) throw new ValidationError(NOT_SHARING);
    assertSharesSingleDatabases(from.adapterId);
    if (from.id === to.id && databaseName === toDatabase) throw new ValidationError("Pick another server or another name, the database is there already.");
    if (from.adapterId !== to.adapterId) throw new ValidationError(`${to.name} runs another engine. A database moves only to a server of the same engine, so its backups restore there.`);

    const [facts, targetFacts] = await Promise.all([factsOf(from.id), factsOf(to.id)]);
    const holder = ownerAt(facts.assignments, facts.rules, databaseName, now);
    if (!holder) throw new ValidationError(`${databaseName} belongs to no customer now, so it has nothing to take along. Give it to the tenant on ${to.name} instead.`);
    await assertReached(prisma, reach, holder, (tenant) => OUTSIDE_REACH.holder(databaseName, tenant));
    const there = ownerAt(targetFacts.assignments, targetFacts.rules, toDatabase, now);
    const tenant = await prisma.tenant.findUnique({ where: { id: holder }, select: { name: true } });
    if (there && there !== holder) {
        const other = await prisma.tenant.findUnique({ where: { id: there }, select: { name: true } });
        throw new ValidationError(`${toDatabase} on ${to.name} belongs to ${other?.name ?? "another tenant"}. Take it back first, or move under another name.`);
    }

    await prisma.$transaction(async (tx) => {
        await rememberServer(tx, from);
        await rememberServer(tx, to);
        const moved = { validUntil: now, movedToSourceId: to.id, movedToDatabase: toDatabase };

        // The switch of backups on demand goes along to the new place.
        let onDemandPerDay: number | null = null;
        const current = await tx.databaseAssignment.findFirst({ where: { sourceId: from.id, databaseName, validUntil: null } });
        if (current) {
            onDemandPerDay = current.onDemandPerDay;
            await tx.databaseAssignment.update({ where: { id: current.id }, data: moved });
        } else {
            // A rule gives it: an assignment of the rule's time ends with the move, so the backups of
            // that time stay the customer's and the rule gives the name to nobody from now on.
            const rule = ruleAt(await tx.databaseAssignmentRule.findMany({ where: { sourceId: from.id } }), databaseName, now);
            onDemandPerDay = rule?.onDemandPerDay ?? null;
            const previous = await tx.databaseAssignment.findFirst({
                where: { sourceId: from.id, databaseName, validUntil: { not: null } },
                orderBy: { validUntil: "desc" },
                select: { validUntil: true },
            });
            const start = rule?.validFrom ?? now;
            const validFrom = previous?.validUntil && previous.validUntil.getTime() > start.getTime() ? previous.validUntil : start;
            await tx.databaseAssignment.create({ data: { sourceId: from.id, databaseName, tenantId: holder, validFrom, createdById: by, createdAt: now, ...moved } });
        }

        // The customer holds it on the new server from the move on. A name the server's tenant took
        // back there ends that, since nobody else holds it.
        const arrived = await tx.databaseAssignment.findFirst({ where: { sourceId: to.id, databaseName: toDatabase, validUntil: null } });
        if (arrived?.tenantId === holder) {
            if (arrived.onDemandPerDay === null && onDemandPerDay !== null) {
                await tx.databaseAssignment.update({ where: { id: arrived.id }, data: { onDemandPerDay } });
            }
            return;
        }
        if (arrived) await tx.databaseAssignment.update({ where: { id: arrived.id }, data: { validUntil: now } });
        await tx.databaseAssignment.create({ data: { sourceId: to.id, databaseName: toDatabase, tenantId: holder, validFrom: now, onDemandPerDay, createdById: by, createdAt: now } });
    });

    sharingChanged();
    return { tenantName: tenant?.name ?? "The tenant", toServerName: to.name, toDatabase };
}
