import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { holderAt, matchesPattern, ownerAt } from "@/lib/tenant/database-owner";
import { movesOf } from "./database-moves";
import { backupDatesByDatabase, serverBackupFiles } from "./shared-backups";
import { assertCustomer, listedDatabases, onDemandValue, ownSource, rememberServer, sharesWithCustomers, tenantOnDemand } from "./shared-servers";

export { listedDatabases, sharesWithCustomers };

/**
 * Which customer the databases of a shared server belong to, as the tenant of the server decides
 * it: one database at a time, by rules of names, or many at once through the API. Runs in the tenant
 * of the server, whose filter keeps the assignments of other tenants' servers out. The customer
 * reads them through `shared-databases.ts`.
 *
 * Only a server of a tenant that shares databases, one of the MSP's own, is shared. A customer
 * keeps their servers to themselves and never learns which other tenants exist.
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
    /** Null with the tenant, `DELETED_TENANT` for a tenant deleted since. */
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
    /** `DELETED_TENANT` for a tenant deleted since. */
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
    /** The tenants a database can be given to: every tenant but the one of the server. */
    customers: { id: string; name: string }[];
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

/** The names of tenants by id. An assignment or a rule keeps the id of a tenant deleted since, which has none. */
async function tenantNames(ids: readonly (string | null)[]): Promise<(id: string) => string> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    const tenants = wanted.length > 0 ? await prisma.tenant.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } }) : [];
    const names = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
    return (id) => names.get(id) ?? DELETED_TENANT;
}

export const databaseAssignmentService = {
    /** The databases of a server with who each belongs to, the assignments and the rules. */
    async forSource(sourceId: string, now = new Date()): Promise<SourceAssignments> {
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
        const [givers, moves, nameOf, perDay] = await Promise.all([
            prisma.user.findMany({
                where: { id: { in: [...new Set(assignments.flatMap((assignment) => (assignment.createdById ? [assignment.createdById] : [])))] } },
                select: { id: true, name: true },
            }).then((users) => new Map(users.map((user) => [user.id, user.name]))),
            movesOf(sourceId, assignments),
            tenantNames([...assignments.map((assignment) => assignment.tenantId), ...rules.map((rule) => rule.tenantId)]),
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
                return {
                    name,
                    sizeInBytes,
                    backups,
                    owner: {
                        tenantId, tenantName: nameOf(tenantId), via: holder.via, since: fact.validFrom.toISOString(),
                        onDemandPerDay: fact.onDemandPerDay, tenantOnDemand: perDay.get(tenantId) ?? null,
                    },
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
            databases,
            assignments: assignments.map((assignment) => ({
                id: assignment.id,
                databaseName: assignment.databaseName,
                tenantId: assignment.tenantId,
                tenantName: assignment.tenantId ? nameOf(assignment.tenantId) : null,
                validFrom: assignment.validFrom.toISOString(),
                validUntil: assignment.validUntil?.toISOString() ?? null,
                createdAt: assignment.createdAt.toISOString(),
                byName: assignment.createdById ? givers.get(assignment.createdById) ?? null : null,
                movedTo: moves.to(assignment),
                movedFrom: moves.from(assignment),
                onDemandPerDay: assignment.onDemandPerDay,
            })),
            rules: rules.map((rule) => ruleRow(rule, nameOf(rule.tenantId), perDay.get(rule.tenantId) ?? null)),
            customers: tenants,
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
     * Returns how many changed.
     */
    async assign(sourceId: string, changes: AssignmentChange[], by: string | null, now = new Date()): Promise<{ changed: number }> {
        const source = await ownSource(sourceId);
        for (const change of changes) {
            if (!change.databaseName.trim()) throw new ValidationError("Name the database.");
            if (change.tenantId) await assertCustomer(change.tenantId, source.tenantId);
            if (change.validFrom && change.validFrom.getTime() > now.getTime()) throw new ValidationError("An assignment starts today or earlier.");
        }

        let changed = 0;
        await prisma.$transaction(async (tx) => {
            if (changes.length > 0) await rememberServer(tx, source);
            const rules = await tx.databaseAssignmentRule.findMany({ where: { sourceId } });
            for (const change of changes) {
                const assignments = await tx.databaseAssignment.findMany({ where: { sourceId, databaseName: change.databaseName } });
                const current = assignments.find((assignment) => assignment.validUntil === null) ?? null;
                if (current && current.tenantId === change.tenantId) continue;
                // Taking back what nobody holds changes nothing.
                if (!change.tenantId && !current && ownerAt(assignments, rules, change.databaseName, now) === null) continue;
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
        return { changed };
    },

    /** Adds a rule that gives the databases whose names match the pattern to a customer. */
    async addRule(sourceId: string, input: { pattern: string; tenantId: string; priority?: number; validFrom?: Date; onDemandPerDay?: number | null }, now = new Date()): Promise<RuleRow> {
        const source = await ownSource(sourceId);
        const pattern = input.pattern.trim();
        if (!pattern) throw new ValidationError("Enter a pattern, like shop_*.");
        if (pattern.length > PATTERN_MAX) throw new ValidationError(`A pattern can have at most ${PATTERN_MAX} characters.`);
        await assertCustomer(input.tenantId, source.tenantId);
        if (input.validFrom && input.validFrom.getTime() > now.getTime()) throw new ValidationError("A rule starts today or earlier.");
        const onDemandPerDay = onDemandValue(input.onDemandPerDay);
        const rule = await prisma.$transaction(async (tx) => {
            await rememberServer(tx, source);
            return tx.databaseAssignmentRule.create({
                data: { sourceId, pattern, tenantId: input.tenantId, priority: Math.round(input.priority ?? 0), validFrom: input.validFrom ?? now, onDemandPerDay, createdAt: now },
            });
        });
        return ruleRow(rule, (await tenantNames([rule.tenantId]))(rule.tenantId), (await tenantOnDemand([rule.tenantId])).get(rule.tenantId) ?? null);
    },

    /**
     * Ends a rule. The databases it gave belong to nobody else from now on, unless another rule
     * takes them. The rule stays for the backups of its time, which stay with the customer it gave
     * them to, like those of an ended assignment.
     */
    async removeRule(sourceId: string, ruleId: string, now = new Date()): Promise<{ pattern: string; tenantName: string }> {
        await ownSource(sourceId);
        const rule = await prisma.databaseAssignmentRule.findFirst({ where: { id: ruleId, sourceId, validUntil: null } });
        if (!rule) throw new NotFoundError("Rule", ruleId);
        await prisma.databaseAssignmentRule.update({ where: { id: ruleId }, data: { validUntil: now } });
        return { pattern: rule.pattern, tenantName: (await tenantNames([rule.tenantId]))(rule.tenantId) };
    },

    /**
     * How many backups a day the customer who holds a database by name may start of it: `perDay` of
     * its own, none with 0, or as many as the customer may of every database with null. It belongs
     * to the assignment of now, a later one starts as the customer.
     */
    async setOnDemand(sourceId: string, databaseName: string, perDay: number | null): Promise<{ tenantName: string; before: number | null }> {
        await ownSource(sourceId);
        const value = onDemandValue(perDay);
        const current = await prisma.databaseAssignment.findFirst({ where: { sourceId, databaseName, validUntil: null, tenantId: { not: null } } });
        if (!current?.tenantId) throw new ValidationError(`${databaseName} is given to no tenant by name. Switch backups on demand on for the rule that gives it, or give it by name first.`);
        await prisma.databaseAssignment.update({ where: { id: current.id }, data: { onDemandPerDay: value } });
        return { tenantName: (await tenantNames([current.tenantId]))(current.tenantId), before: current.onDemandPerDay };
    },

    /** The same for every database a rule gives: `perDay` of its own, none with 0, or as the customer with null. */
    async setRuleOnDemand(sourceId: string, ruleId: string, perDay: number | null): Promise<{ pattern: string; tenantName: string; before: number | null }> {
        await ownSource(sourceId);
        const value = onDemandValue(perDay);
        const rule = await prisma.databaseAssignmentRule.findFirst({ where: { id: ruleId, sourceId, validUntil: null } });
        if (!rule) throw new NotFoundError("Rule", ruleId);
        await prisma.databaseAssignmentRule.update({ where: { id: ruleId }, data: { onDemandPerDay: value } });
        return { pattern: rule.pattern, tenantName: (await tenantNames([rule.tenantId]))(rule.tenantId), before: rule.onDemandPerDay };
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
