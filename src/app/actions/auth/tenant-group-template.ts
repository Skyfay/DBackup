"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, type Viewer } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { lockedTenantRight, platformGroupRefusal, type PlatformGroupActor, type PlatformGroupShape } from "@/lib/auth/platform-group-caps";
import { scopeText } from "@/lib/auth/platform-group-summary";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { emptyBulkResult } from "@/lib/core/bulk";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { groupService } from "@/services/user/group-service";
import { platformGroupService } from "@/services/user/platform-group-service";
import { parsePermissions } from "@/services/user/users-model";
import { templateRights, tenantGroupTemplates, type LeaveChoice, type ReachPlan, type ReachReport } from "@/services/user/tenant-group-templates";

/**
 * Groups the platform makes once for tenants, under Platform, Users & Groups, Tenant groups. Each
 * needs the right to manage the accounts of the platform. Nobody makes or changes one that may do
 * more in a tenant than their own platform group gives there, or that reaches a tenant their own
 * platform group does not, and nobody moves people into a group that may do more than they may.
 * The platform's log keeps the group, the log of each tenant what happened to its group there.
 */

const log = logger.child({ action: "tenant-group-template" });

const IdSchema = z.string().min(1).max(200);

const TemplateSchema = z.object({
    name: z.string().trim().min(1, "Give the group a name.").max(100, "The name can have at most 100 characters."),
    permissions: z.array(z.string().max(64)).max(100),
    allTenants: z.boolean(),
    tenantIds: z.array(IdSchema).max(1000),
});

export type TenantGroupTemplateValues = z.input<typeof TemplateSchema>;

const LeaveSchema = z.union([z.object({ keep: z.literal(true) }), z.object({ keep: z.literal(false), moveTo: IdSchema.nullable() })]);

const PlanSchema = z.object({
    clashes: z.record(IdSchema, z.enum(["takeOver", "leaveOut"])).optional(),
    leaving: z.record(IdSchema, LeaveSchema).optional(),
});

export type TenantGroupPlan = z.input<typeof PlanSchema>;

const PLATFORM_LOG = { tenantId: HOME_TENANT_ID };
const PAGE = "/dashboard/platform/users";
const BEYOND = "This group for tenants may do more than you may, so only someone who may do all of it changes it.";

/** The message of a refusal the user can act on, a plain one for anything else. */
const messageOf = (error: unknown, fallback: string) => (error instanceof ValidationError || error instanceof NotFoundError ? error.message : fallback);

/** The viewer as the caps of the platform groups read them. */
async function actorOf(viewer: Viewer): Promise<PlatformGroupActor> {
    if (viewer.isPlatformAdmin) return { isPlatformAdmin: true, permissions: viewer.permissions, group: null };
    const own = await platformGroupService.shapeOf(viewer.id);
    return { isPlatformAdmin: false, permissions: viewer.permissions, group: own?.shape ?? null };
}

/** A group for tenants as the caps read it: rights in the tenants and where, none on the platform. */
const shapeOf = (values: { permissions: readonly string[]; allTenants: boolean; tenantIds: readonly string[] }): PlatformGroupShape => ({
    platformPermissions: [],
    tenantPermissions: templateRights(values.permissions),
    allTenants: values.allTenants,
    tenantIds: values.allTenants ? [] : values.tenantIds,
});

/** Why the actor may not make or change a group for tenants like this one, null when they may. */
function refusalOf(actor: PlatformGroupActor, shape: PlatformGroupShape): string | null {
    const refused = platformGroupRefusal(actor, shape);
    return refused ? refused.replace(/platform group/g, "group for tenants") : null;
}

/**
 * Nobody moves the members of a group into one that may do more than their own platform group gives
 * in the tenants, and nobody but a platform admin into the group with every permission of a tenant.
 */
async function moveRefusal(actor: PlatformGroupActor, leaving: Record<string, LeaveChoice> | undefined): Promise<string | null> {
    if (actor.isPlatformAdmin || !leaving) return null;
    for (const choice of Object.values(leaving)) {
        if (choice.keep || !choice.moveTo) continue;
        const target = await groupService.findAnywhere(choice.moveTo);
        if (!target) continue;
        if (target.fullAccess || parsePermissions(target.permissions).some((permission) => lockedTenantRight(actor, permission) !== null)) {
            return `${target.name} may do more than you may, so you cannot move anyone into it.`;
        }
    }
    return null;
}

/** One entry in the log of every tenant whose group changed, in the words of a change of a group there. */
async function logTenants(viewer: Viewer, name: string, report: ReachReport, extra: Record<string, unknown> = {}) {
    const entries: [string[], string, Record<string, unknown>][] = [
        [report.created, AUDIT_ACTIONS.CREATE, { change: "Given by the platform" }],
        [report.takenOver, AUDIT_ACTIONS.UPDATE, { change: "Taken over by the platform" }],
        [report.changed, AUDIT_ACTIONS.UPDATE, extra],
        [report.removed, AUDIT_ACTIONS.DELETE, { change: "Taken back by the platform" }],
        [report.kept, AUDIT_ACTIONS.UPDATE, { change: "Left to the tenant by the platform" }],
    ];
    for (const [tenantIds, action, details] of entries) {
        for (const tenantId of tenantIds) {
            await auditService.log(viewer.id, action, AUDIT_RESOURCES.GROUP, { name, fromPlatform: true, ...details }, report.groupIds[tenantId], { tenantId });
        }
    }
}

/**
 * What a save would ask before it goes through: the tenants it newly reaches that have a group of
 * their own by the name, and the tenants it leaves where people hold it.
 */
export async function previewTenantGroupTemplate(id: string | null, input: TenantGroupTemplateValues) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const templateId = IdSchema.nullable().safeParse(id);
    const parsed = TemplateSchema.safeParse(input);
    if (!templateId.success || !parsed.success) return { success: false as const, error: parsed.error?.issues[0]?.message ?? "Invalid request" };

    const refused = refusalOf(await actorOf(viewer), shapeOf(parsed.data));
    if (refused) return { success: false as const, error: refused };
    try {
        return { success: true as const, data: await tenantGroupTemplates.preview(templateId.data, parsed.data) };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError)) log.error("Previewing a group for tenants failed", { templateId: templateId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The group could not be checked.") };
    }
}

/** Makes a group for tenants, or saves one, with the answers to the questions of the preview. */
export async function saveTenantGroupTemplate(id: string | null, input: TenantGroupTemplateValues, plan: TenantGroupPlan = {}) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const templateId = IdSchema.nullable().safeParse(id);
    const parsed = TemplateSchema.safeParse(input);
    const answers = PlanSchema.safeParse(plan);
    if (!templateId.success || !parsed.success || !answers.success) return { success: false as const, error: parsed.error?.issues[0]?.message ?? "Invalid request" };

    const actor = await actorOf(viewer);
    if (templateId.data) {
        const current = await tenantGroupTemplates.find(templateId.data);
        if (!current) return { success: false as const, error: "The group for tenants no longer exists." };
        if (refusalOf(actor, shapeOf(current))) return { success: false as const, error: BEYOND };
    }
    const refused = refusalOf(actor, shapeOf(parsed.data)) ?? await moveRefusal(actor, answers.data.leaving);
    if (refused) return { success: false as const, error: refused };

    try {
        const saved = await tenantGroupTemplates.save(templateId.data, parsed.data, answers.data as ReachPlan);
        await auditService.log(viewer.id, templateId.data ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.GROUP, {
            name: saved.name,
            forTenants: true,
            ...(saved.renamedFrom ? { renamedFrom: saved.renamedFrom } : {}),
            ...(templateId.data ? { areas: saved.areas } : { permissions: saved.permissions }),
            scope: scopeText(saved),
            ...(saved.report.leftOut.length > 0 ? { leftOut: saved.report.leftOut.length } : {}),
        }, saved.id, PLATFORM_LOG);
        await logTenants(viewer, saved.name, saved.report, { ...(saved.renamedFrom ? { renamedFrom: saved.renamedFrom } : {}), areas: saved.areas });
        revalidatePath(PAGE);
        return { success: true as const, data: { id: saved.id, report: saved.report } };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Saving a group for tenants failed", { templateId: templateId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The group could not be saved.") };
    }
}

/** Deletes a group for tenants. Its group in each tenant goes, its members moved, or stays as the tenant's own. */
export async function deleteTenantGroupTemplate(id: string, leaving: Record<string, z.input<typeof LeaveSchema>> = {}) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const templateId = IdSchema.safeParse(id);
    const answers = z.record(IdSchema, LeaveSchema).safeParse(leaving);
    if (!templateId.success || !answers.success) return { success: false as const, error: "Invalid request" };

    const actor = await actorOf(viewer);
    const current = await tenantGroupTemplates.find(templateId.data);
    if (!current) return { success: false as const, error: "The group for tenants no longer exists." };
    const refused = (refusalOf(actor, shapeOf(current)) ? BEYOND : null) ?? await moveRefusal(actor, answers.data);
    if (refused) return { success: false as const, error: refused };

    try {
        const removed = await tenantGroupTemplates.remove(templateId.data, answers.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.GROUP, {
            name: removed.name, forTenants: true, removed: removed.report.removed.length, kept: removed.report.kept.length,
        }, templateId.data, PLATFORM_LOG);
        await logTenants(viewer, removed.name, removed.report);
        revalidatePath(PAGE);
        return { success: true as const, data: removed.report };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Deleting a group for tenants failed", { templateId: templateId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The group could not be deleted.") };
    }
}

/**
 * Deletes several groups for tenants nobody holds. One that people hold in a tenant stays, since
 * Delete asks where they go, and so does one that may do more than the viewer.
 */
export async function bulkDeleteTenantGroupTemplates(ids: string[]) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    const actor = await actorOf(viewer);
    const result = emptyBulkResult();
    for (const id of parsed.data) {
        const current = await tenantGroupTemplates.find(id);
        const refused = !current ? "The group for tenants no longer exists." : refusalOf(actor, shapeOf(current)) ? BEYOND : null;
        if (refused) {
            result.failed.push({ id, name: current?.name, error: refused });
            continue;
        }
        try {
            const removed = await tenantGroupTemplates.remove(id);
            await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.GROUP, {
                name: removed.name, forTenants: true, removed: removed.report.removed.length, kept: removed.report.kept.length,
            }, id, PLATFORM_LOG);
            await logTenants(viewer, removed.name, removed.report);
            result.succeeded.push(id);
        } catch (error: unknown) {
            if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Deleting a group for tenants failed", { templateId: id }, wrapError(error));
            result.failed.push({ id, name: current?.name, error: messageOf(error, "The group could not be deleted.") });
        }
    }
    revalidatePath(PAGE);
    return { success: true as const, data: result };
}
