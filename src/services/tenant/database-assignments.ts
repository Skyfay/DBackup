import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { holderAt, matchesPattern, ownerAt } from "@/lib/tenant/database-owner";
import { OUTSIDE_REACH, reachCovers, TENANT_BEYOND_REACH, type PlatformReach } from "@/lib/tenant/sharing-reach";
import { assertChangesReached, assertReached, assertRuleEndReached, assertRuleReached } from "./assignment-reach";
import { movesOf } from "./database-moves";
import { assertNoSharedRestore } from "@/services/restore/shared-restores-active";
import { backupDatesByDatabase, serverBackupFiles } from "./shared-backups";
import { assertCustomer, assertTenantsLive, listedDatabases, NOT_SHARING, onDemandValue, ownSource, rememberServer, sharesWithCustomers, sharingChanged, tenantOnDemand } from "./shared-servers";

export { listedDatabases, sharesWithCustomers };

/**
 * Which customer the databases of a shared server belong to, as the tenant of the server decides
 * it: one database at a time, by rules of names, or many at once through the API. Runs in the tenant
 * of the server, whose filter keeps the assignments of other tenants' servers out. The customer
 * reads them through `shared-databases.ts`.
 *
 * Only a server of a tenant that shares databases, one of the MSP's own, is shared. A customer
 * keeps their servers to themselves and never learns which other tenants exist. Every change takes
 * the `PlatformReach` of the person, so someone of a platform group of some tenants gives to and
 * takes from the tenants it reaches only, see `assignment-reach.ts`.
 */

/** A database on a server, the other end of a move. */
export interface MovePlace {
    sourceId: string;
    serverName: string;
    databaseName: string;
}

export interface AssignmentRow {
    id: string;
    databaseName: string;
    /** Null when the tenant of the server took the database back. */
    tenantId: string | null;
    /** Null with the tenant, `DELETED_TENANT` for a tenant deleted since, `TENANT_BEYOND_REACH` for one beyond the reach of the viewer. */
    tenantName: string | null;
    validFrom: string;
    validUntil: string | null;
    /** When it was given, which decides whether its start reaches back over another holder. */
    createdAt: string;
    /** Who gave it, null when the person is gone or it came through the API without a user. */
    byName: string | null;
    /** Where the database went, on the assignment its move ended. */
    movedTo: MovePlace | null;
    /** Where the database came from, on the assignment a move started here. */
    movedFrom: MovePlace | null;
    /** What it stores for backups on demand: null as the customer, 0 none, else its own number a day. */
    onDemandPerDay: number | null;
}

export interface RuleRow {
    id: string;
    pattern: string;
    tenantId: string;
    /** `DELETED_TENANT` for a tenant deleted since, `TENANT_BEYOND_REACH` for one beyond the reach of the viewer. */
    tenantName: string;
    priority: number;
    validFrom: string;
    /** When the rule was removed or its tenant deleted, null while it gives. */
    validUntil: string | null;
    createdAt: string;
    /** What it stores for backups on demand of each database it gives: null as the customer, 0 none, else its own number a day. */
    onDemandPerDay: number | null;
    /** The backups a day the platform lets the customer start of every database, null for none. */
    tenantOnDemand: number | null;
}

/** A database the server holds now, and who it belongs to now. */
export interface DatabaseOwnerRow {
    name: string;
    sizeInBytes: number | null;
    /** `onDemandPerDay` is what the assignment or the rule stores, `tenantOnDemand` what the customer may of every database. */
    owner: { tenantId: string; tenantName: string; via: "assignment" | "rule"; since: string; onDemandPerDay: number | null; tenantOnDemand: number | null } | null;
    /** Backups of it the destinations of the server keep, one per backup however many copies. */
    backups: number;
}

export interface SourceAssignments {
    databases: DatabaseOwnerRow[];
    /** Every assignment, the ended ones too, newest first. */
    assignments: AssignmentRow[];
    /** Every rule, the ended ones too, which still decide the backups of their time. */
    rules: RuleRow[];
    /** The tenants the viewer may give a database to: every tenant but the one of the server that the platform group of the viewer reaches. */
    customers: { id: string; name: string }[];
    /** Every tenant but the one of the server that the viewer reaches, for the names of the filters, and `TENANT_BEYOND_REACH` while a tenant beyond the reach holds or held a database. */
    tenants: { id: string; name: string }[];
    /** When each database a tenant ever held was backed up, of the backups kept, oldest first, by its name. */
    backupDates: Record<string, string[]>;
}

export interface AssignmentChange {
    databaseName: string;
    /** The customer, null to end the assignment so the database belongs to nobody but the server's tenant. */
    tenantId: string | null;
    /** When the customer's backups start, now when left out. An earlier day shows older backups too. */
    validFrom?: Date;
}

const PATTERN_MAX = 100;

/** The name a tenant deleted since goes by in the history of a server. */
export const DELETED_TENANT = "A deleted tenant";

export type AssignmentWithTenant = Awaited<ReturnType<typeof readAssignments>>[number];

function readAssignments(sourceId: string) {
    return prisma.databaseAssignment.findMany({ where: { sourceId }, orderBy: { validFrom: "desc" } });
}

/**
 * The tenants by id as the viewer sees them: a tenant `reach` covers by its id and name, one beyond it
 * as `TENANT_BEYOND_REACH`, so it reads as gone, and one deleted since by its id as `DELETED_TENANT`,
 * since an assignment or a rule keeps the id of a deleted tenant.
 */
async function tenantsSeen(ids: readonly (string | null)[], reach: PlatformReach): Promise<(id: string) => { id: string; name: string }> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    const tenants = wanted.length > 0 ? await prisma.tenant.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } }) : [];
    const names = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
    return (id) => {
        const name = names.get(id);
        if (name === undefined) return { id, name: DELETED_TENANT };
        return reachCovers(reach, id) ? { id, name } : { ...TENANT_BEYOND_REACH };
    };
}

/** The names of tenants by id, for whoever the reach of the change covers. */
async function tenantNames(ids: readonly (string | null)[]): Promise<(id: string) => string> {
    const seen = await tenantsSeen(ids, "all");
    return (id) => seen(id).name;
}

export const databaseAssignmentService = {
    /**
     * The databases of a server with who each belongs to, the assignments and the rules. A tenant
     * beyond `reach` holds and gets them as `TENANT_BEYOND_REACH`, without its id and its name, and
     * is no customer to pick.
     */
    async forSource(sourceId: string, now = new Date(), reach: PlatformReach = "all"): Promise<SourceAssignments> {
        const source = await ownSource(sourceId);
        const [listed, assignments, rules, tenants, files] = await Promise.all([
            listedDatabases(sourceId),
            readAssignments(sourceId),
            prisma.databaseAssignmentRule.findMany({ where: { sourceId }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }),
            // Only a tenant that shares sees the names of the others.
            sharesWithCustomers(source.tenantId).then((shares) => shares
                ? prisma.tenant.findMany({ where: { id: { not: source.tenantId } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
                : []),
            serverBackupFiles(sourceId),
        ]);
        const dates = backupDatesByDatabase(files);
        const [givers, moves, seen, perDay] = await Promise.all([
            prisma.user.findMany({
                where: { id: { in: [...new Set(assignments.flatMap((assignment) => (assignment.createdById ? [assignment.createdById] : [])))] } },
                select: { id: true, name: true },
            }).then((users) => new Map(users.map((user) => [user.id, user.name]))),
            movesOf(sourceId, assignments),
            tenantsSeen([...assignments.map((assignment) => assignment.tenantId), ...rules.map((rule) => rule.tenantId)], reach),
            tenantOnDemand([...assignments.flatMap((assignment) => (assignment.tenantId ? [assignment.tenantId] : [])), ...rules.map((rule) => rule.tenantId)]),
        ]);

        const databases = listed
            .map(({ name, sizeInBytes }): DatabaseOwnerRow => {
                const backups = dates.get(name)?.length ?? 0;
                // A database that moved away or was taken back belongs to nobody here, whatever a rule matches.
                const holder = holderAt(assignments, rules, name, now);
                if (!holder || holder.via === "moved" || !holder.fact.tenantId) return { name, sizeInBytes, backups, owner: null };
                const { fact } = holder;
                const tenantId = fact.tenantId as string;
                const tenant = seen(tenantId);
                return {
                    name,
                    sizeInBytes,
                    backups,
                    owner: {
                        tenantId: tenant.id, tenantName: tenant.name, via: holder.via, since: fact.validFrom.toISOString(),
                        onDemandPerDay: fact.onDemandPerDay, tenantOnDemand: perDay.get(tenantId) ?? null,
                    },
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        const beyond = [...assignments.map((assignment) => assignment.tenantId), ...rules.map((rule) => rule.tenantId)]
            .some((id) => id !== null && seen(id).id === TENANT_BEYOND_REACH.id);
        const reached = tenants.filter((tenant) => reachCovers(reach, tenant.id));
        return {
            databases,
            assignments: assignments.map((assignment) => ({
                id: assignment.id,
                databaseName: assignment.databaseName,
                tenantId: assignment.tenantId ? seen(assignment.tenantId).id : null,
                tenantName: assignment.tenantId ? seen(assignment.tenantId).name : null,
                validFrom: assignment.validFrom.toISOString(),
                validUntil: assignment.validUntil?.toISOString() ?? null,
                createdAt: assignment.createdAt.toISOString(),
                byName: assignment.createdById ? givers.get(assignment.createdById) ?? null : null,
                movedTo: moves.to(assignment),
                movedFrom: moves.from(assignment),
                onDemandPerDay: assignment.onDemandPerDay,
            })),
            rules: rules.map((rule) => ruleRow({ ...rule, tenantId: seen(rule.tenantId).id }, seen(rule.tenantId).name, perDay.get(rule.tenantId) ?? null)),
            customers: reached,
            // The tenants beyond the reach go by one name, for the filters.
            tenants: beyond ? [...reached, { ...TENANT_BEYOND_REACH }] : reached,
            // Only of the databases a tenant ever held, whose timeline counts the backups of each time.
            backupDates: Object.fromEntries([...dates].filter(([name]) =>
                assignments.some((assignment) => assignment.databaseName === name) || rules.some((rule) => matchesPattern(rule.pattern, name)))),
        };
    },

    /**
     * Gives databases of a server to customers, or takes them back with a null tenant. An
     * assignment that changes ends rather than being deleted, so the backups made before stay with
     * the customer they belonged to then. Taking a database back is recorded too, so it belongs to
     * the server's tenant alone from then on, also when a rule matches its name. A start in the past
     * shows older backups, but only of times no other customer held the database, see `holderAt`.
     * A database the tenant holds already, by name or by a rule, stays as it is, its start and its
     * backups on demand included. A change that gives to or takes from a tenant beyond the reach is
     * refused, and nothing changes. Returns how many changed, and the ids of every tenant the batch
     * names, those it gives to and those that held a database before, a take-back included, for the
     * audit entry of the batch (`namedTenants` in `src/lib/core/audit-tenants.ts`).
     */
    async assign(sourceId: string, changes: AssignmentChange[], by: string | null, now = new Date(), reach: PlatformReach = "all"): Promise<{ changed: number; tenants: string[] }> {
        const source = await ownSource(sourceId);
        // Taking back too, which would record the server as shared in a tenant that never shares.
        if (!(await sharesWithCustomers(source.tenantId))) throw new ValidationError(NOT_SHARING);
        for (const change of changes) {
            if (!change.databaseName.trim()) throw new ValidationError("Name the database.");
            // Before anything tells a tenant beyond the reach apart from one that does not exist.
            if (change.tenantId) assertReached(reach, change.tenantId, OUTSIDE_REACH.give);
            if (change.tenantId) await assertCustomer(change.tenantId, source);
            if (change.validFrom && change.validFrom.getTime() > now.getTime()) throw new ValidationError("An assignment starts today or earlier.");
            // A customer's restore would write an old dump into a database that is no longer theirs.
            assertNoSharedRestore(sourceId, { databaseName: change.databaseName }, (tenantId) => tenantId === change.tenantId);
        }

        let changed = 0;
        const tenants = new Set<string>();
        await prisma.$transaction(async (tx) => {
            // A customer deleted since `assertCustomer` would keep an assignment under its dead id.
            await assertTenantsLive(tx, changes.map((change) => change.tenantId));
            const rules = await tx.databaseAssignmentRule.findMany({ where: { sourceId } });
            await assertChangesReached(tx, sourceId, changes, rules, reach, now);
            if (changes.length > 0) await rememberServer(tx, source);
            for (const change of changes) {
                const assignments = await tx.databaseAssignment.findMany({ where: { sourceId, databaseName: change.databaseName } });
                const current = assignments.find((assignment) => assignment.validUntil === null) ?? null;
                for (const tenantId of [ownerAt(assignments, rules, change.databaseName, now), change.tenantId]) if (tenantId) tenants.add(tenantId);
                if (current && current.tenantId === change.tenantId) continue;
                // Giving it to the tenant a rule gives it to already, or taking back what nobody
                // holds, changes nothing.
                if (!current && ownerAt(assignments, rules, change.databaseName, now) === change.tenantId) continue;
                if (current) await tx.databaseAssignment.update({ where: { id: current.id }, data: { validUntil: now } });
                // Never earlier than the end of the one before, or a backup would belong to two customers.
                const ended = assignments.reduce<Date | null>((latest, assignment) => {
                    const end = assignment.id === current?.id ? now : assignment.validUntil;
                    return end && (!latest || end.getTime() > latest.getTime()) ? end : latest;
                }, null);
                const wanted = change.tenantId ? change.validFrom ?? now : now;
                const validFrom = ended && ended.getTime() > wanted.getTime() ? ended : wanted;
                await tx.databaseAssignment.create({
                    data: { sourceId, databaseName: change.databaseName, tenantId: change.tenantId, validFrom, createdById: by, createdAt: now },
                });
                changed++;
            }
        });
        if (changed > 0) sharingChanged();
        return { changed, tenants: [...tenants].sort() };
    },

    /** Adds a rule that gives the databases whose names match the pattern to a customer. */
    async addRule(sourceId: string, input: { pattern: string; tenantId: string; priority?: number; validFrom?: Date; onDemandPerDay?: number | null }, now = new Date(), reach: PlatformReach = "all"): Promise<RuleRow> {
        const source = await ownSource(sourceId);
        const pattern = input.pattern.trim();
        if (!pattern) throw new ValidationError("Enter a pattern, like shop_*.");
        if (pattern.length > PATTERN_MAX) throw new ValidationError(`A pattern can have at most ${PATTERN_MAX} characters.`);
        // Before anything tells a tenant beyond the reach apart from one that does not exist.
        assertReached(reach, input.tenantId, OUTSIDE_REACH.give);
        await assertCustomer(input.tenantId, source);
        if (input.validFrom && input.validFrom.getTime() > now.getTime()) throw new ValidationError("A rule starts today or earlier.");
        assertNoSharedRestore(sourceId, { pattern }, (tenantId) => tenantId === input.tenantId);
        await assertRuleReached(sourceId, { pattern, tenantId: input.tenantId, priority: Math.round(input.priority ?? 0), validFrom: input.validFrom ?? now }, reach, now);
        const onDemandPerDay = onDemandValue(input.onDemandPerDay);
        const rule = await prisma.$transaction(async (tx) => {
            // A customer deleted since `assertCustomer` would keep a rule under its dead id.
            await assertTenantsLive(tx, [input.tenantId]);
            await rememberServer(tx, source);
            return tx.databaseAssignmentRule.create({
                data: { sourceId, pattern, tenantId: input.tenantId, priority: Math.round(input.priority ?? 0), validFrom: input.validFrom ?? now, onDemandPerDay, createdAt: now },
            });
        });
        sharingChanged();
        return ruleRow(rule, (await tenantNames([rule.tenantId]))(rule.tenantId), (await tenantOnDemand([rule.tenantId])).get(rule.tenantId) ?? null);
    },

    /**
     * Ends a rule. The databases it gave belong to nobody else from now on, unless another rule
     * takes them, which is refused when that rule's tenant is beyond the reach. The rule stays for
     * the backups of its time, which stay with the customer it gave them to, like those of an ended
     * assignment.
     */
    async removeRule(sourceId: string, ruleId: string, now = new Date(), reach: PlatformReach = "all"): Promise<{ pattern: string; tenantId: string; tenantName: string }> {
        await ownSource(sourceId);
        const rule = await prisma.databaseAssignmentRule.findFirst({ where: { id: ruleId, sourceId, validUntil: null } });
        if (!rule) throw new NotFoundError("Rule", ruleId);
        assertReached(reach, rule.tenantId, OUTSIDE_REACH.rule(rule.pattern));
        assertNoSharedRestore(sourceId, { pattern: rule.pattern }, (tenantId) => tenantId !== rule.tenantId);
        // The databases it gave may fall to a rule of a lower priority, of a tenant beyond the reach.
        await assertRuleEndReached(sourceId, rule, reach, now);
        await prisma.databaseAssignmentRule.update({ where: { id: ruleId }, data: { validUntil: now } });
        sharingChanged();
        return { pattern: rule.pattern, tenantId: rule.tenantId, tenantName: (await tenantNames([rule.tenantId]))(rule.tenantId) };
    },

    /**
     * How many backups a day the customer who holds a database by name may start of it: `perDay` of
     * its own, none with 0, or as many as the customer may of every database with null. It belongs
     * to the assignment of now, a later one starts as the customer.
     */
    async setOnDemand(sourceId: string, databaseName: string, perDay: number | null, reach: PlatformReach = "all"): Promise<{ tenantId: string; tenantName: string; before: number | null }> {
        await ownSource(sourceId);
        const value = onDemandValue(perDay);
        const current = await prisma.databaseAssignment.findFirst({ where: { sourceId, databaseName, validUntil: null, tenantId: { not: null } } });
        if (!current?.tenantId) throw new ValidationError(`${databaseName} is given to no tenant by name. Set backups on demand for the rule that gives it.`);
        assertReached(reach, current.tenantId, OUTSIDE_REACH.holder(databaseName));
        await prisma.databaseAssignment.update({ where: { id: current.id }, data: { onDemandPerDay: value } });
        sharingChanged();
        return { tenantId: current.tenantId, tenantName: (await tenantNames([current.tenantId]))(current.tenantId), before: current.onDemandPerDay };
    },

    /** The same for every database a rule gives: `perDay` of its own, none with 0, or as the customer with null. */
    async setRuleOnDemand(sourceId: string, ruleId: string, perDay: number | null, reach: PlatformReach = "all"): Promise<{ pattern: string; tenantId: string; tenantName: string; before: number | null }> {
        await ownSource(sourceId);
        const value = onDemandValue(perDay);
        const rule = await prisma.databaseAssignmentRule.findFirst({ where: { id: ruleId, sourceId, validUntil: null } });
        if (!rule) throw new NotFoundError("Rule", ruleId);
        assertReached(reach, rule.tenantId, OUTSIDE_REACH.rule(rule.pattern));
        await prisma.databaseAssignmentRule.update({ where: { id: ruleId }, data: { onDemandPerDay: value } });
        sharingChanged();
        return { pattern: rule.pattern, tenantId: rule.tenantId, tenantName: (await tenantNames([rule.tenantId]))(rule.tenantId), before: rule.onDemandPerDay };
    },
};

export function ruleRow(rule: { id: string; pattern: string; tenantId: string; priority: number; validFrom: Date; validUntil: Date | null; createdAt: Date; onDemandPerDay: number | null }, tenantName: string, tenantPerDay: number | null = null): RuleRow {
    return {
        id: rule.id,
        pattern: rule.pattern,
        tenantId: rule.tenantId,
        tenantName,
        priority: rule.priority,
        validFrom: rule.validFrom.toISOString(),
        validUntil: rule.validUntil?.toISOString() ?? null,
        createdAt: rule.createdAt.toISOString(),
        onDemandPerDay: rule.onDemandPerDay,
        tenantOnDemand: tenantPerDay,
    };
}
