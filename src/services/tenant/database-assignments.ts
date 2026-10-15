import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { assignmentAt, matchesPattern, movedAwayAt, ruleAt } from "@/lib/tenant/database-owner";
import { movesOf } from "./database-moves";
import { backupDatesByDatabase, serverBackupFiles } from "./shared-backups";
import { assertCustomer, listedDatabases, onDemandValue, ownSource, rememberServer, sharesDatabases } from "./shared-servers";

export { listedDatabases, sharesDatabases };

/**
 * Which customer the databases of a shared server belong to, as the tenant of the server decides
 * it: one database at a time, by rules of names, or many at once through the API. Runs in the tenant
 * of the server, whose filter keeps the assignments of other tenants' servers out. The customer
 * reads them through `shared-databases.ts`.
 *
 * Only a server of the home tenant, the MSP's own, is shared. A customer keeps their servers to
 * themselves and never learns which other tenants exist.
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
    tenantId: string;
    tenantName: string;
    validFrom: string;
    validUntil: string | null;
    /** Who gave it, null when the person is gone or it came through the API without a user. */
    byName: string | null;
    /** Where the database went, on the assignment its move ended. */
    movedTo: MovePlace | null;
    /** Where the database came from, on the assignment a move started here. */
    movedFrom: MovePlace | null;
    /** The backups a day the customer may start, null when it may start none. */
    onDemandPerDay: number | null;
}

export interface RuleRow {
    id: string;
    pattern: string;
    tenantId: string;
    tenantName: string;
    priority: number;
    validFrom: string;
    /** The backups a day the customer may start of each database the rule gives, null for none. */
    onDemandPerDay: number | null;
}

/** A database the server holds now, and who it belongs to now. */
export interface DatabaseOwnerRow {
    name: string;
    sizeInBytes: number | null;
    owner: { tenantId: string; tenantName: string; via: "assignment" | "rule"; since: string; onDemandPerDay: number | null } | null;
    /** Backups of it the destinations of the server keep, one per backup however many copies. */
    backups: number;
}

export interface SourceAssignments {
    databases: DatabaseOwnerRow[];
    /** Every assignment, the ended ones too, newest first. */
    assignments: AssignmentRow[];
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

export type AssignmentWithTenant = Awaited<ReturnType<typeof readAssignments>>[number];

function readAssignments(sourceId: string) {
    return prisma.databaseAssignment.findMany({ where: { sourceId }, orderBy: { validFrom: "desc" }, include: { tenant: { select: { name: true } } } });
}

export const databaseAssignmentService = {
    /** The databases of a server with who each belongs to, the assignments and the rules. */
    async forSource(sourceId: string, now = new Date()): Promise<SourceAssignments> {
        const source = await ownSource(sourceId);
        const [listed, assignments, rules, tenants, files] = await Promise.all([
            listedDatabases(sourceId),
            readAssignments(sourceId),
            prisma.databaseAssignmentRule.findMany({ where: { sourceId }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], include: { tenant: { select: { name: true } } } }),
            // Nobody but the home tenant shares, and nobody else sees the names of the other tenants.
            sharesDatabases(source.tenantId)
                ? prisma.tenant.findMany({ where: { id: { not: source.tenantId } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
                : [],
            serverBackupFiles(sourceId),
        ]);
        const dates = backupDatesByDatabase(files);
        const [givers, moves] = await Promise.all([
            prisma.user.findMany({
                where: { id: { in: [...new Set(assignments.flatMap((assignment) => (assignment.createdById ? [assignment.createdById] : [])))] } },
                select: { id: true, name: true },
            }).then((users) => new Map(users.map((user) => [user.id, user.name]))),
            movesOf(sourceId, assignments),
        ]);

        const databases = listed
            .map(({ name, sizeInBytes }): DatabaseOwnerRow => {
                const backups = dates.get(name)?.length ?? 0;
                const assignment = assignmentAt(assignments, name, now);
                if (assignment) {
                    return {
                        name, sizeInBytes, backups,
                        owner: { tenantId: assignment.tenantId, tenantName: assignment.tenant.name, via: "assignment", since: assignment.validFrom.toISOString(), onDemandPerDay: assignment.onDemandPerDay },
                    };
                }
                // A database that moved away belongs to nobody here, whatever a rule matches.
                const rule = movedAwayAt(assignments, name, now) ? null : ruleAt(rules, name, now);
                return {
                    name,
                    sizeInBytes,
                    backups,
                    owner: rule ? { tenantId: rule.tenantId, tenantName: rule.tenant.name, via: "rule", since: rule.validFrom.toISOString(), onDemandPerDay: rule.onDemandPerDay } : null,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
            databases,
            assignments: assignments.map((assignment) => ({
                id: assignment.id,
                databaseName: assignment.databaseName,
                tenantId: assignment.tenantId,
                tenantName: assignment.tenant.name,
                validFrom: assignment.validFrom.toISOString(),
                validUntil: assignment.validUntil?.toISOString() ?? null,
                byName: assignment.createdById ? givers.get(assignment.createdById) ?? null : null,
                movedTo: moves.to(assignment),
                movedFrom: moves.from(assignment),
                onDemandPerDay: assignment.onDemandPerDay,
            })),
            rules: rules.map(ruleRow),
            customers: tenants,
            // Only of the databases a tenant ever held, whose timeline counts the backups of each time.
            backupDates: Object.fromEntries([...dates].filter(([name]) =>
                assignments.some((assignment) => assignment.databaseName === name) || rules.some((rule) => matchesPattern(rule.pattern, name)))),
        };
    },

    /**
     * Gives databases of a server to customers, or takes them back with a null tenant. An
     * assignment that changes ends rather than being deleted, so the backups made before stay with
     * the customer they belonged to then. Returns how many changed.
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
            if (changes.some((change) => change.tenantId)) await rememberServer(tx, source);
            for (const change of changes) {
                const current = await tx.databaseAssignment.findFirst({ where: { sourceId, databaseName: change.databaseName, validUntil: null } });
                // Taking back what no assignment gives changes nothing, a rule keeps giving it.
                if (!current && !change.tenantId) continue;
                if (current?.tenantId === change.tenantId) continue;
                if (current) await tx.databaseAssignment.update({ where: { id: current.id }, data: { validUntil: now } });
                if (change.tenantId) {
                    // Never earlier than the end of the one before, or a backup would belong to two customers.
                    const previous = await tx.databaseAssignment.findFirst({
                        where: { sourceId, databaseName: change.databaseName, validUntil: { not: null } },
                        orderBy: { validUntil: "desc" },
                        select: { validUntil: true },
                    });
                    const wanted = change.validFrom ?? now;
                    const validFrom = previous?.validUntil && previous.validUntil.getTime() > wanted.getTime() ? previous.validUntil : wanted;
                    await tx.databaseAssignment.create({
                        data: { sourceId, databaseName: change.databaseName, tenantId: change.tenantId, validFrom, createdById: by },
                    });
                }
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
                data: { sourceId, pattern, tenantId: input.tenantId, priority: Math.round(input.priority ?? 0), validFrom: input.validFrom ?? now, onDemandPerDay },
                include: { tenant: { select: { name: true } } },
            });
        });
        return ruleRow(rule);
    },

    /**
     * Removes a rule. The databases it gave belong to nobody else from now on, unless another rule
     * takes them, and their backups from the time of the rule leave the customer with it.
     */
    async removeRule(sourceId: string, ruleId: string): Promise<{ pattern: string; tenantName: string }> {
        await ownSource(sourceId);
        const rule = await prisma.databaseAssignmentRule.findFirst({ where: { id: ruleId, sourceId }, include: { tenant: { select: { name: true } } } });
        if (!rule) throw new NotFoundError("Rule", ruleId);
        await prisma.databaseAssignmentRule.delete({ where: { id: ruleId } });
        return { pattern: rule.pattern, tenantName: rule.tenant.name };
    },

    /**
     * Lets the customer who holds a database by name start backups of it, up to `perDay` a day, or
     * none with null. The switch belongs to the assignment of now, a later one starts without it.
     */
    async setOnDemand(sourceId: string, databaseName: string, perDay: number | null): Promise<{ tenantName: string; before: number | null }> {
        await ownSource(sourceId);
        const value = onDemandValue(perDay);
        const current = await prisma.databaseAssignment.findFirst({ where: { sourceId, databaseName, validUntil: null }, include: { tenant: { select: { name: true } } } });
        if (!current) throw new ValidationError(`${databaseName} is given to no tenant by name. Switch backups on demand on for the rule that gives it, or give it by name first.`);
        await prisma.databaseAssignment.update({ where: { id: current.id }, data: { onDemandPerDay: value } });
        return { tenantName: current.tenant.name, before: current.onDemandPerDay };
    },

    /** The same for every database a rule gives: up to `perDay` backups a day of each, or none with null. */
    async setRuleOnDemand(sourceId: string, ruleId: string, perDay: number | null): Promise<{ pattern: string; tenantName: string; before: number | null }> {
        await ownSource(sourceId);
        const value = onDemandValue(perDay);
        const rule = await prisma.databaseAssignmentRule.findFirst({ where: { id: ruleId, sourceId }, include: { tenant: { select: { name: true } } } });
        if (!rule) throw new NotFoundError("Rule", ruleId);
        await prisma.databaseAssignmentRule.update({ where: { id: ruleId }, data: { onDemandPerDay: value } });
        return { pattern: rule.pattern, tenantName: rule.tenant.name, before: rule.onDemandPerDay };
    },
};

export function ruleRow(rule: { id: string; pattern: string; tenantId: string; tenant: { name: string }; priority: number; validFrom: Date; onDemandPerDay: number | null }): RuleRow {
    return {
        id: rule.id,
        pattern: rule.pattern,
        tenantId: rule.tenantId,
        tenantName: rule.tenant.name,
        priority: rule.priority,
        validFrom: rule.validFrom.toISOString(),
        onDemandPerDay: rule.onDemandPerDay,
    };
}
