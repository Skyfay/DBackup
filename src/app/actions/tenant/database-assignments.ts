"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, hasPermissionWithContext, tenantRefusal } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { diffFields } from "@/lib/core/audit-diff";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ON_DEMAND_MAX, ON_DEMAND_MIN, ON_DEMAND_OFF, SEE_SHARING_PERMISSION, SHARE_PERMISSION } from "@/lib/tenant/sharing";
import { auditService } from "@/services/audit-service";
import { databaseAssignmentService, type SourceAssignments } from "@/services/tenant/database-assignments";
import { moveDatabase, moveTargets, type MoveTarget } from "@/services/tenant/database-moves";
import { customersOfServer } from "@/services/tenant/shared-servers";
import { platformGroupService } from "@/services/user/platform-group-service";

/**
 * Who the databases of a shared server belong to, as the tenant of the server decides it on the
 * page of the server: assignments, rules, moves to another server and backups on demand. The same
 * assignments come through `PUT /api/adapters/[id]/database-assignments`. Every change needs
 * `SHARE_PERMISSION`, read in one place, and touches only the tenants the platform group of the
 * viewer reaches, which the services check with the reach handed to them. A change happens in the
 * tenant of the server, so All tenants, which only reads, is refused with `tenantRefusal`.
 */

const log = logger.child({ action: "database-assignments" });

const IdSchema = z.string().min(1).max(200);
const NameSchema = z.string().trim().min(1, "Name the database.").max(200);
// Null follows the customer, 0 is none for it, else a number a day of its own.
const PerDaySchema = z.coerce.number().int().min(ON_DEMAND_OFF).max(ON_DEMAND_MAX).nullable()
    .refine((value) => value === null || value === ON_DEMAND_OFF || value >= ON_DEMAND_MIN, `Allow from ${ON_DEMAND_MIN} to ${ON_DEMAND_MAX} backups a day.`);
const ChangeSchema = z.object({
    databaseName: NameSchema,
    tenantId: IdSchema.nullable(),
    validFrom: z.coerce.date().optional(),
});
const RuleSchema = z.object({
    pattern: z.string().trim().min(1, "Enter a pattern, like shop_*.").max(100),
    tenantId: IdSchema,
    priority: z.coerce.number().int().min(-1000).max(1000).default(0),
    validFrom: z.coerce.date().optional(),
    onDemandPerDay: PerDaySchema.optional(),
});
const MoveSchema = z.object({
    databaseName: NameSchema,
    toSourceId: IdSchema,
    toDatabase: NameSchema.optional(),
});

const messageOf = (error: unknown, fallback: string) => (error instanceof ValidationError || error instanceof NotFoundError ? error.message : fallback);
const expected = (error: unknown) => error instanceof ValidationError || error instanceof NotFoundError;

/** The change of backups on demand as the audit log keeps it. */
const onDemandWords = (perDay: number | null) => (perDay === null ? "As the tenant" : perDay === ON_DEMAND_OFF ? "Off here" : `${perDay} a day`);
const onDemandChanges = (before: number | null, after: number | null) =>
    diffFields({ perDay: onDemandWords(before) }, { perDay: onDemandWords(after) }, { perDay: { label: "Backups on demand" } });

/** The databases of a shared server with who holds each, the rules and their history, for whoever may see the shared databases. */
export async function getSourceAssignments(sourceId: string): Promise<{ success: true; data: SourceAssignments } | { success: false; error: string }> {
    const viewer = await checkPermission([SEE_SHARING_PERMISSION, SHARE_PERMISSION]);
    const id = IdSchema.safeParse(sourceId);
    if (!id.success) return { success: false, error: "Invalid request" };
    try {
        // The pickers offer the tenants the viewer reaches, every holder still shows by its name.
        return { success: true, data: await databaseAssignmentService.forSource(id.data, new Date(), await platformGroupService.reachOf(viewer.id)) };
    } catch (error: unknown) {
        if (!(error instanceof NotFoundError)) log.error("Reading the assignments failed", { sourceId: id.data }, wrapError(error));
        return { success: false, error: messageOf(error, "The assignments could not be read.") };
    }
}

/** Gives databases of the server to customers, or takes them back with a null tenant. */
export async function assignDatabases(sourceId: string, changes: z.input<typeof ChangeSchema>[]) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const view = tenantRefusal(viewer);
    if (view) return { success: false as const, error: view };
    const id = IdSchema.safeParse(sourceId);
    const parsed = z.array(ChangeSchema).min(1).max(500).safeParse(changes);
    if (!id.success || !parsed.success) return { success: false as const, error: parsed.error?.issues[0]?.message ?? "Invalid request" };

    try {
        const result = await databaseAssignmentService.assign(id.data, parsed.data, viewer.id, new Date(), await platformGroupService.reachOf(viewer.id));
        if (result.changed > 0) {
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, {
                change: "Databases assigned",
                databases: parsed.data.map((change) => ({ name: change.databaseName, tenantId: change.tenantId })),
            }, id.data);
        }
        revalidatePath("/dashboard/explorer");
        return { success: true as const, data: result };
    } catch (error: unknown) {
        if (!expected(error)) log.error("Assigning databases failed", { sourceId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The databases could not be assigned.") };
    }
}

export async function addAssignmentRule(sourceId: string, input: z.input<typeof RuleSchema>) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const view = tenantRefusal(viewer);
    if (view) return { success: false as const, error: view };
    const id = IdSchema.safeParse(sourceId);
    const parsed = RuleSchema.safeParse(input);
    if (!id.success || !parsed.success) return { success: false as const, error: parsed.error?.issues[0]?.message ?? "Invalid request" };

    try {
        const rule = await databaseAssignmentService.addRule(id.data, parsed.data, new Date(), await platformGroupService.reachOf(viewer.id));
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, {
            change: "Assignment rule added", pattern: rule.pattern, tenant: rule.tenantName,
            ...(rule.onDemandPerDay !== null ? { onDemandPerDay: rule.onDemandPerDay } : {}),
        }, id.data);
        revalidatePath("/dashboard/explorer");
        return { success: true as const, data: rule };
    } catch (error: unknown) {
        if (!expected(error)) log.error("Adding a rule failed", { sourceId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The rule could not be added.") };
    }
}

export async function removeAssignmentRule(sourceId: string, ruleId: string) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const view = tenantRefusal(viewer);
    if (view) return { success: false as const, error: view };
    const id = IdSchema.safeParse(sourceId);
    const rule = IdSchema.safeParse(ruleId);
    if (!id.success || !rule.success) return { success: false as const, error: "Invalid request" };

    try {
        const removed = await databaseAssignmentService.removeRule(id.data, rule.data, new Date(), await platformGroupService.reachOf(viewer.id));
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, { change: "Assignment rule removed", pattern: removed.pattern, tenant: removed.tenantName }, id.data);
        revalidatePath("/dashboard/explorer");
        return { success: true as const };
    } catch (error: unknown) {
        if (!expected(error)) log.error("Removing a rule failed", { sourceId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The rule could not be removed.") };
    }
}

/** The servers of the same engine a database of the server can move to, with the databases each holds. */
export async function getMoveTargets(sourceId: string): Promise<{ success: true; data: MoveTarget[] } | { success: false; error: string }> {
    await checkPermission(SHARE_PERMISSION);
    const id = IdSchema.safeParse(sourceId);
    if (!id.success) return { success: false, error: "Invalid request" };
    try {
        return { success: true, data: await moveTargets(id.data) };
    } catch (error: unknown) {
        if (!(error instanceof NotFoundError)) log.error("Reading the servers to move to failed", { sourceId: id.data }, wrapError(error));
        return { success: false, error: messageOf(error, "The servers could not be read.") };
    }
}

/** Marks a database of a customer as moved to another server, where its assignment goes on. */
export async function moveSharedDatabase(sourceId: string, input: z.input<typeof MoveSchema>) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const view = tenantRefusal(viewer);
    if (view) return { success: false as const, error: view };
    const id = IdSchema.safeParse(sourceId);
    const parsed = MoveSchema.safeParse(input);
    if (!id.success || !parsed.success) return { success: false as const, error: parsed.error?.issues[0]?.message ?? "Invalid request" };

    try {
        const moved = await moveDatabase(id.data, parsed.data, viewer.id, new Date(), await platformGroupService.reachOf(viewer.id));
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, {
            change: "Database moved",
            database: parsed.data.databaseName,
            to: moved.toServerName,
            toDatabase: moved.toDatabase,
            tenant: moved.tenantName,
        }, id.data);
        revalidatePath("/dashboard/explorer");
        return { success: true as const, data: moved };
    } catch (error: unknown) {
        if (!expected(error)) log.error("Moving a database failed", { sourceId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The database could not be moved.") };
    }
}

/** How many backups a day the customer who holds a database by name may start of it: its own number, none with 0, or as the customer with null. */
export async function setDatabaseOnDemand(sourceId: string, databaseName: string, perDay: number | null) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const view = tenantRefusal(viewer);
    if (view) return { success: false as const, error: view };
    const id = IdSchema.safeParse(sourceId);
    const name = NameSchema.safeParse(databaseName);
    const value = PerDaySchema.safeParse(perDay);
    if (!id.success || !name.success || !value.success) return { success: false as const, error: value.error?.issues[0]?.message ?? "Invalid request" };

    try {
        const changed = await databaseAssignmentService.setOnDemand(id.data, name.data, value.data, await platformGroupService.reachOf(viewer.id));
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, {
            change: "Backups on demand", database: name.data, tenant: changed.tenantName,
            changes: onDemandChanges(changed.before, value.data),
        }, id.data);
        revalidatePath("/dashboard/explorer");
        return { success: true as const };
    } catch (error: unknown) {
        if (!expected(error)) log.error("Changing backups on demand failed", { sourceId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "Backups on demand could not be changed.") };
    }
}

/** The same for every database a rule gives. */
export async function setRuleOnDemand(sourceId: string, ruleId: string, perDay: number | null) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const view = tenantRefusal(viewer);
    if (view) return { success: false as const, error: view };
    const id = IdSchema.safeParse(sourceId);
    const rule = IdSchema.safeParse(ruleId);
    const value = PerDaySchema.safeParse(perDay);
    if (!id.success || !rule.success || !value.success) return { success: false as const, error: value.error?.issues[0]?.message ?? "Invalid request" };

    try {
        const changed = await databaseAssignmentService.setRuleOnDemand(id.data, rule.data, value.data, await platformGroupService.reachOf(viewer.id));
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, {
            change: "Backups on demand", pattern: changed.pattern, tenant: changed.tenantName,
            changes: onDemandChanges(changed.before, value.data),
        }, id.data);
        revalidatePath("/dashboard/explorer");
        return { success: true as const };
    } catch (error: unknown) {
        if (!expected(error)) log.error("Changing backups on demand of a rule failed", { sourceId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "Backups on demand could not be changed.") };
    }
}

/**
 * The customers who hold a database of a server now, for the warning before it is deleted, which
 * only someone who may delete it sees. Their names go to whoever may see or share the databases of
 * shared servers, everyone else learns how many there are.
 */
export async function getServerCustomers(sourceId: string): Promise<{ success: true; data: { count: number; names: string[] | null } } | { success: false; error: string }> {
    const viewer = await checkPermission(PERMISSIONS.SOURCES.WRITE);
    const id = IdSchema.safeParse(sourceId);
    if (!id.success) return { success: false, error: "Invalid request" };
    try {
        const names = await customersOfServer(id.data);
        const named = hasPermissionWithContext(viewer, SEE_SHARING_PERMISSION) || hasPermissionWithContext(viewer, SHARE_PERMISSION);
        return { success: true, data: { count: names.length, names: named ? names : null } };
    } catch (error: unknown) {
        log.warn("Reading the customers of a server failed", { sourceId: id.data }, wrapError(error));
        return { success: false, error: "The customers of the server could not be read." };
    }
}
