import prisma from "@/lib/prisma";
import { assignmentAt, followMoves, matchesPattern, ownerAt, ruleAt, type DatabasePlace, type PlacedAssignment } from "@/lib/tenant/database-owner";
import { factsOf, serverBackupFiles, type OwnerFacts } from "./shared-backups";
import { listedDatabases } from "./shared-servers";

/**
 * Where the databases of a customer live on the shared servers of another tenant, and where they
 * lived before: every name on every server the customer held, and the database each of them belongs
 * to now. A database that moved to another server keeps the places it lived before, so the customer
 * sees one database with its backups from every server. Reads every tenant, so its callers run it
 * in the system scope.
 */

/** One name on one server a customer held, with the time it was theirs there. */
export interface HeldPlace extends DatabasePlace {
    from: Date;
    /** When it stopped being theirs there, by an end or a move, null while it is. */
    until: Date | null;
    /** The backups a day the holding of now allows, null for none or for a place that is not theirs now. */
    onDemandPerDay: number | null;
}

/** A server a customer's database lives or lived on, with the name and engine it has or had. */
export interface PlaceServer {
    id: string;
    name: string;
    adapterId: string;
    /** The tenant that runs it. */
    tenantId: string;
    /** Its connection still exists. A deleted one only downloads. */
    live: boolean;
    deletedAt: Date | null;
}

export interface TenantPlaces {
    /** Every place the tenant held, by `placeKey`. */
    places: Map<string, HeldPlace>;
    /** The database each place belongs to now, by the key of the place: the end of the moves its last assignment went through. */
    groupOf: Map<string, string>;
    /** The tenant's assignments with their servers, for following a backup across moves. */
    assignments: PlacedAssignment[];
    servers: Map<string, PlaceServer>;
}

export const placeKey = (place: DatabasePlace) => `${place.sourceId}/${place.databaseName}`;

const ASSIGNMENT = { sourceId: true, databaseName: true, tenantId: true, validFrom: true, validUntil: true, movedToSourceId: true, movedToDatabase: true, onDemandPerDay: true, createdAt: true } as const;

async function serversOf(ids: string[]): Promise<Map<string, PlaceServer>> {
    const [kept, live] = await Promise.all([
        prisma.sharedServer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, adapterId: true, tenantId: true, deletedAt: true } }),
        prisma.adapterConfig.findMany({ where: { id: { in: ids }, type: "database" }, select: { id: true, name: true, adapterId: true, tenantId: true } }),
    ]);
    const servers = new Map<string, PlaceServer>(kept.map((server) => [server.id, { ...server, live: false }]));
    for (const server of live) servers.set(server.id, { ...server, live: true, deletedAt: null });
    return servers;
}

/** The names a rule of a deleted server gave the tenant, read from the backups of that server, since its list of databases is gone. */
async function namesFromBackups(sourceId: string, pattern: string, facts: OwnerFacts, tenantId: string): Promise<string[]> {
    const names = new Set<string>();
    for (const { file } of await serverBackupFiles(sourceId)) {
        for (const name of file.databases ?? []) {
            if (matchesPattern(pattern, name) && ownerAt(facts.assignments, facts.rules, name, new Date(file.createdAt)) === tenantId) names.add(name);
        }
    }
    return [...names];
}

/** Every place of the databases a tenant holds or held on the shared servers of other tenants. */
export async function tenantPlaces(tenantId: string, now: Date): Promise<TenantPlaces> {
    const [assignments, rules] = await Promise.all([
        prisma.databaseAssignment.findMany({ where: { tenantId }, select: ASSIGNMENT }),
        prisma.databaseAssignmentRule.findMany({ where: { tenantId } }),
    ]);
    const servers = await serversOf([...new Set([
        ...assignments.flatMap((assignment) => [assignment.sourceId, ...(assignment.movedToSourceId ? [assignment.movedToSourceId] : [])]),
        ...rules.map((rule) => rule.sourceId),
    ])]);

    const places = new Map<string, HeldPlace>();
    const hold = (place: DatabasePlace, from: Date, until: Date | null, onDemandPerDay: number | null) => {
        const key = placeKey(place);
        const known = places.get(key);
        if (!known) {
            places.set(key, { ...place, from, until, onDemandPerDay: until === null ? onDemandPerDay : null });
            return;
        }
        if (from < known.from) known.from = from;
        // Open as long as any holding of it is, and the open one says what it allows.
        if (until === null) {
            if (known.until !== null) known.onDemandPerDay = onDemandPerDay;
            known.until = null;
        } else if (known.until !== null && until > known.until) {
            known.until = until;
        }
    };

    for (const assignment of assignments) {
        hold(assignment, assignment.validFrom, assignment.validUntil, assignment.onDemandPerDay);
    }
    // The place a move went to is the customer's, whatever happened to the assignment there since.
    for (const assignment of assignments) {
        if (!assignment.movedToSourceId || !assignment.validUntil) continue;
        const target = { sourceId: assignment.movedToSourceId, databaseName: assignment.movedToDatabase || assignment.databaseName };
        if (!places.has(placeKey(target))) hold(target, assignment.validUntil, null, null);
    }

    // A rule gives the databases the server holds now that match it and nobody else holds. Of a
    // deleted server, whose list is gone, and of a rule that ended, the ones its backups show it
    // gave, which stay the customer's like those of an ended assignment.
    const facts = new Map<string, OwnerFacts>();
    for (const rule of rules) {
        const sourceFacts = facts.get(rule.sourceId) ?? (await factsOf(rule.sourceId));
        facts.set(rule.sourceId, sourceFacts);
        if (servers.get(rule.sourceId)?.live && !rule.validUntil) {
            for (const { name } of await listedDatabases(rule.sourceId)) {
                if (!matchesPattern(rule.pattern, name) || ownerAt(sourceFacts.assignments, sourceFacts.rules, name, now) !== tenantId) continue;
                // What it allows comes from the holding that wins: the name itself, else the rule of the highest priority.
                const held = assignmentAt(assignments.filter((entry) => entry.sourceId === rule.sourceId), name, now)
                    ?? ruleAt(rules.filter((entry) => entry.sourceId === rule.sourceId), name, now);
                hold({ sourceId: rule.sourceId, databaseName: name }, rule.validFrom, null, held?.onDemandPerDay ?? null);
            }
        } else {
            for (const name of await namesFromBackups(rule.sourceId, rule.pattern, sourceFacts, tenantId)) {
                hold({ sourceId: rule.sourceId, databaseName: name }, rule.validFrom, rule.validUntil, null);
            }
        }
    }

    const groupOf = new Map<string, string>();
    for (const key of places.keys()) groupOf.set(key, placeKey(destinationOf(assignments, places.get(key)!)));
    return { places, groupOf, assignments, servers };
}

/** Where the database of a place lives now: the end of the moves of the last assignment there. */
function destinationOf(assignments: readonly PlacedAssignment[], place: DatabasePlace): DatabasePlace {
    let current = place;
    const seen = new Set<string>();
    while (!seen.has(placeKey(current))) {
        seen.add(placeKey(current));
        const last = assignments
            .filter((assignment) => assignment.sourceId === current.sourceId && assignment.databaseName === current.databaseName)
            .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
        if (!last?.movedToSourceId) return current;
        current = { sourceId: last.movedToSourceId, databaseName: last.movedToDatabase || current.databaseName };
    }
    return current;
}

/** The key of the database a backup belongs to now, by the place and the time it was made. */
export function groupOfBackup(held: TenantPlaces, tenantId: string, place: DatabasePlace, createdAt: string): string {
    const moved = placeKey(followMoves(held.assignments, tenantId, place, new Date(createdAt)));
    return held.groupOf.get(moved) ?? held.groupOf.get(placeKey(place)) ?? placeKey(place);
}

/**
 * Where a backup of a customer restores into now: the database it was made of, at the place it
 * moved to since. Null when that server was deleted or the database is not theirs now.
 */
export async function restoreTarget(tenantId: string, place: DatabasePlace, createdAt: string, now: Date): Promise<{ target: DatabasePlace | null; reason: string | null }> {
    const assignments = await prisma.databaseAssignment.findMany({ where: { tenantId }, select: ASSIGNMENT });
    const target = followMoves(assignments, tenantId, place, new Date(createdAt));
    const live = await prisma.adapterConfig.findFirst({ where: { id: target.sourceId, type: "database" }, select: { id: true } });
    if (!live) return { target: null, reason: "The server of this database was deleted, so its backups can only be downloaded." };
    const facts = await factsOf(target.sourceId);
    if (ownerAt(facts.assignments, facts.rules, target.databaseName, now) !== tenantId) {
        return { target: null, reason: "The database is no longer yours, so a backup of it can only be downloaded." };
    }
    return { target, reason: null };
}

/** Whether a database is the tenant's now on a server that exists, and how many backups a day it may start of it. */
export async function holdingNow(tenantId: string, place: DatabasePlace, now: Date): Promise<{ live: boolean; owner: boolean; perDay: number | null }> {
    const live = !!(await prisma.adapterConfig.findFirst({ where: { id: place.sourceId, type: "database" }, select: { id: true } }));
    const facts = await factsOf(place.sourceId);
    if (ownerAt(facts.assignments, facts.rules, place.databaseName, now) !== tenantId) return { live, owner: false, perDay: null };
    const [assignments, rules] = await Promise.all([
        prisma.databaseAssignment.findMany({ where: { tenantId, sourceId: place.sourceId, databaseName: place.databaseName } }),
        prisma.databaseAssignmentRule.findMany({ where: { tenantId, sourceId: place.sourceId } }),
    ]);
    const held = assignmentAt(assignments, place.databaseName, now) ?? ruleAt(rules, place.databaseName, now);
    return { live, owner: true, perDay: held?.onDemandPerDay ?? null };
}
