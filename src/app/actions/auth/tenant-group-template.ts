"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, type Viewer } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { lockedTenantRight, platformGroupRefusal, type PlatformGroupActor, type PlatformGroupShape } from "@/lib/auth/platform-group-caps";
import { scopeText } from "@/lib/auth/platform-group-summary";
import { namedTenants } from "@/lib/core/audit-tenants";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { emptyBulkResult } from "@/lib/core/bulk";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { providerPlacementChanges } from "@/services/sso/oidc-audit";
import { membershipEndRefusal } from "@/services/tenant/membership-end";
import { groupService, type ProviderMove } from "@/services/user/group-service";
import { platformGroupService } from "@/services/user/platform-group-service";
import { parsePermissions } from "@/services/user/users-model";
import { templateRights, tenantGroupTemplates, type ClashChoice, type LeaveChoice, type ReachPlan, type ReachReport } from "@/services/user/tenant-group-templates";

/**
 * Groups the platform makes once for tenants, under Platform, Users & Groups, Tenant groups. Each
 * needs the right to manage the accounts of the platform. Nobody makes or changes one that may do
 * more in a tenant than their own platform group gives there, or that reaches a tenant their own
 * platform group does not, and nobody moves people into a group or takes over a group of a tenant
 * that may do more than they may.
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
const messageOf = (error: unknown, fallback: string) => (error instanceof ValidationError || error instanceof NotFoundError || error instanceof ConflictError ? error.message : fallback);

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

/** The tenants a group for tenants covers, its own or the one of a save. */
type TenantScope = { allTenants: boolean; tenantIds: readonly string[] };

const covers = (scope: TenantScope | null | undefined, tenantId: string) => !!scope && (scope.allTenants || scope.tenantIds.includes(tenantId));

/**
 * Whether a tenant is one the check may name a group of: inside the scope of the group for tenants
 * and the reach of the actor's own platform group. An id the browser sends for any other tenant is
 * never looked up, so the answer tells nothing of the groups of a tenant beyond them.
 */
const named = (actor: PlatformGroupActor, scope: TenantScope | null, tenantId: string) => covers(scope, tenantId) && covers(actor.group, tenantId);

/** The answer to a group to move into that is none of the tenant it is picked for, or beyond the actor. */
const MOVE_TARGET_GONE = "The group for its members is not one of their tenant.";

/**
 * Nobody moves the members of a group into one that may do more than their own platform group gives
 * in the tenants, and nobody but a platform admin into the group with every permission of a tenant.
 * `scope` is the one the group for tenants leaves, null for a new one, which leaves no tenant.
 */
async function moveRefusal(actor: PlatformGroupActor, scope: TenantScope | null, leaving: Record<string, LeaveChoice> | undefined): Promise<string | null> {
    if (actor.isPlatformAdmin || !leaving) return null;
    for (const [tenantId, choice] of Object.entries(leaving)) {
        if (choice.keep || !choice.moveTo) continue;
        if (!named(actor, scope, tenantId)) return MOVE_TARGET_GONE;
        const target = await groupService.findAnywhere(choice.moveTo);
        if (!target || target.tenantId !== tenantId) return MOVE_TARGET_GONE;
        if (target.fullAccess || parsePermissions(target.permissions).some((permission) => lockedTenantRight(actor, permission) !== null)) {
            return `${target.name} may do more than you may, so you cannot move anyone into it.`;
        }
    }
    return null;
}

/** Whether a group of a tenant may do more than the actor may give in the tenants: every permission there, or one their platform group does not give. */
function beyondActor(actor: PlatformGroupActor, group: { permissions: readonly string[]; fullAccess: boolean }): boolean {
    if (actor.isPlatformAdmin) return false;
    return group.fullAccess || group.permissions.some((permission) => lockedTenantRight(actor, permission) !== null);
}

/**
 * Nobody takes over a group of a tenant that may do more than they may: the take-over sets what its
 * members may do and hands the group to the platform, which a change of that group in its tenant
 * would refuse them too. Only the tenants of `scope`, the one of the save, within the actor's reach
 * are looked up, the save takes over nothing elsewhere.
 */
async function takeOverRefusal(actor: PlatformGroupActor, name: string, scope: TenantScope, clashes: Record<string, ClashChoice> | undefined): Promise<string | null> {
    if (actor.isPlatformAdmin || !clashes) return null;
    const tenantIds = Object.entries(clashes).filter(([tenantId, choice]) => choice === "takeOver" && named(actor, scope, tenantId)).map(([tenantId]) => tenantId);
    const beyond = (await tenantGroupTemplates.groupsNamed(name, tenantIds)).find((group) => beyondActor(actor, group));
    return beyond ? `${beyond.name} of ${beyond.tenantName} may do more than you may, so you cannot take it over. Leave ${beyond.tenantName} out.` : null;
}

/**
 * Nobody but a platform admin moves or ends the membership of a platform admin, like the delete of a
 * group in its tenant (`groupService.holdsPlatformAdmin`): a group a platform admin holds in a tenant
 * the group for tenants leaves stays there as the tenant's own, or only a platform admin goes on.
 */
async function platformAdminRefusal(actor: PlatformGroupActor, id: string, name: string, reach: { allTenants: boolean; tenantIds: readonly string[] } | null, leaving: Record<string, LeaveChoice> = {}): Promise<string | null> {
    if (actor.isPlatformAdmin) return null;
    const lost = await tenantGroupTemplates.platformAdminLeaving(id, reach, leaving);
    return lost ? `A platform admin is in ${name} of ${lost.tenantName}, so only a platform admin takes it away there. Keep it in ${lost.tenantName}.` : null;
}

/**
 * Nobody moves or ends their own membership, like nobody changes or deletes a group they hold: a
 * group the viewer holds in a tenant the group for tenants leaves stays there as the tenant's own,
 * or someone else goes on.
 */
async function ownMembershipRefusal(viewer: Viewer, id: string, name: string, reach: { allTenants: boolean; tenantIds: readonly string[] } | null, leaving: Record<string, LeaveChoice> = {}): Promise<string | null> {
    const lost = await tenantGroupTemplates.memberLeaving(id, viewer.id, reach, leaving);
    return lost ? `You are in ${name} of ${lost.tenantName}, so you cannot move it or take it away there. Keep it in ${lost.tenantName}, or let someone else do it.` : null;
}

/**
 * Nobody but a platform admin changes what their own group lets them do through a group for
 * tenants, like `updateGroup` refuses a change of a group one holds: neither the linked group the
 * viewer holds in a tenant the save keeps, whose permissions change, nor a group of a tenant the
 * viewer holds that a take-over would hand to the platform.
 */
async function ownGroupRefusal(viewer: Viewer, id: string | null, values: { name: string; permissions: string[]; allTenants: boolean; tenantIds: string[] }, clashes: Record<string, ClashChoice> | undefined): Promise<string | null> {
    if (viewer.isPlatformAdmin) return null;
    if (id) {
        const changed = await tenantGroupTemplates.memberChanging(id, viewer.id, values);
        if (changed) return `You are in ${values.name} of ${changed.tenantName}, so you cannot change what it may do. Let someone else do it.`;
    }
    const takeOver = Object.entries(clashes ?? {}).filter(([, choice]) => choice === "takeOver").map(([tenantId]) => tenantId);
    const held = await tenantGroupTemplates.memberNamed(id, values.name, takeOver, viewer.id);
    return held ? `You are in ${held.name} of ${held.tenantName}, so you cannot take it over. Leave ${held.tenantName} out, or let someone else do it.` : null;
}

/**
 * Nobody takes an account out of a tenant so that it works afterwards only in tenants where they
 * manage the users, which would let them change it, like the delete of a group in its tenant
 * without a group for its members (`membershipEndRefusal`). A group for tenants that a tenant loses
 * with its members moved to no group ends their memberships there, a move to another group keeps
 * them. `reach` is the new one of a save, null for a delete, which leaves every tenant. Besides the
 * refusal it returns the members of every group the change moves or ends by tenant, which the save
 * or delete hands the service as `checkedEnds`, so someone added to such a group in between, like a
 * platform admin that `platformAdminRefusal` never saw, stops it there. A platform admin is never
 * refused and checks nobody.
 */
async function membershipEndsRefusal(viewer: Viewer, id: string, name: string, reach: TenantScope | null, leaving: Record<string, LeaveChoice> = {}): Promise<{ refusal: string | null; checkedEnds?: Record<string, string[]> }> {
    if (viewer.isPlatformAdmin) return { refusal: null };
    const leavingGroups = await tenantGroupTemplates.membersLeaving(id, reach, leaving);
    for (const group of leavingGroups.filter((entry) => entry.ends)) {
        for (const userId of group.userIds) {
            if (await membershipEndRefusal(viewer, userId, group.tenantId)) {
                return { refusal: `One of the members of ${name} in ${group.tenantName} would afterwards work only in tenants where you manage the users. Keep it in ${group.tenantName} or pick a group there for its members, or let a platform admin do it.` };
            }
        }
    }
    return { refusal: null, checkedEnds: Object.fromEntries(leavingGroups.map((group) => [group.tenantId, group.userIds])) };
}

/**
 * A sign-in provider whose group of new people a removed group changed, written like an edit of the
 * provider into the log of the platform, like `logProviderMoves` of the delete of a group.
 */
async function logProviderMoves(userId: string, providers: readonly ProviderMove[]) {
    for (const provider of providers) {
        const changes = providerPlacementChanges(provider.before, provider.after);
        if (changes.length === 0) continue;
        await auditService.log(userId, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SSO_PROVIDER, { name: provider.name, changes, ...namedTenants([provider.tenantId]) }, provider.id, PLATFORM_LOG);
    }
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

    const actor = await actorOf(viewer);
    // The preview names the tenants, people and groups the group reaches now, so a group beyond the
    // viewer stays closed to it like to a save.
    if (templateId.data) {
        const current = await tenantGroupTemplates.find(templateId.data);
        if (!current) return { success: false as const, error: "The group for tenants no longer exists." };
        if (refusalOf(actor, shapeOf(current))) return { success: false as const, error: BEYOND };
    }
    const refused = refusalOf(actor, shapeOf(parsed.data));
    if (refused) return { success: false as const, error: refused };
    try {
        const preview = await tenantGroupTemplates.preview(templateId.data, parsed.data);
        // A group of a tenant that may do more than the viewer is left out, never taken over.
        const beyond = actor.isPlatformAdmin || preview.clashes.length === 0
            ? new Set<string>()
            : new Set((await tenantGroupTemplates.groupsNamed(parsed.data.name, preview.clashes.map((clash) => clash.tenantId))).filter((group) => beyondActor(actor, group)).map((group) => group.id));
        return { success: true as const, data: { ...preview, clashes: preview.clashes.map((clash) => (beyond.has(clash.groupId) ? { ...clash, beyondYou: true } : clash)) } };
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
    let leftScope: TenantScope | null = null;
    // A new group for tenants leaves no tenant, so it ends no membership.
    let checkedEnds: Record<string, string[]> | undefined;
    if (templateId.data) {
        const current = await tenantGroupTemplates.find(templateId.data);
        if (!current) return { success: false as const, error: "The group for tenants no longer exists." };
        if (refusalOf(actor, shapeOf(current))) return { success: false as const, error: BEYOND };
        leftScope = current;
        const lost = await platformAdminRefusal(actor, templateId.data, current.name, parsed.data, answers.data.leaving)
            ?? await ownMembershipRefusal(viewer, templateId.data, current.name, parsed.data, answers.data.leaving);
        if (lost) return { success: false as const, error: lost };
        const ends = await membershipEndsRefusal(viewer, templateId.data, current.name, parsed.data, answers.data.leaving);
        if (ends.refusal) return { success: false as const, error: ends.refusal };
        checkedEnds = ends.checkedEnds;
    }
    const refused = refusalOf(actor, shapeOf(parsed.data)) ?? await moveRefusal(actor, leftScope, answers.data.leaving) ?? await takeOverRefusal(actor, parsed.data.name, parsed.data, answers.data.clashes)
        ?? await ownGroupRefusal(viewer, templateId.data, parsed.data, answers.data.clashes);
    if (refused) return { success: false as const, error: refused };

    try {
        const saved = await tenantGroupTemplates.save(templateId.data, parsed.data, answers.data as ReachPlan, { platformAdmin: viewer.isPlatformAdmin, checkedEnds });
        await auditService.log(viewer.id, templateId.data ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.GROUP, {
            name: saved.name,
            forTenants: true,
            ...(saved.renamedFrom ? { renamedFrom: saved.renamedFrom } : {}),
            ...(templateId.data ? { areas: saved.areas } : { permissions: saved.permissions }),
            scope: scopeText(saved),
            ...(saved.report.leftOut.length > 0 ? { leftOut: saved.report.leftOut.length } : {}),
        }, saved.id, PLATFORM_LOG);
        await logTenants(viewer, saved.name, saved.report, { ...(saved.renamedFrom ? { renamedFrom: saved.renamedFrom } : {}), areas: saved.areas });
        await logProviderMoves(viewer.id, saved.ssoProviders);
        revalidatePath(PAGE);
        return { success: true as const, data: { id: saved.id, report: saved.report } };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError || error instanceof ConflictError)) log.error("Saving a group for tenants failed", { templateId: templateId.data }, wrapError(error));
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
    const refused = (refusalOf(actor, shapeOf(current)) ? BEYOND : null)
        ?? await platformAdminRefusal(actor, templateId.data, current.name, null, answers.data)
        ?? await ownMembershipRefusal(viewer, templateId.data, current.name, null, answers.data);
    if (refused) return { success: false as const, error: refused };
    const ends = await membershipEndsRefusal(viewer, templateId.data, current.name, null, answers.data);
    const blocked = ends.refusal ?? await moveRefusal(actor, current, answers.data);
    if (blocked) return { success: false as const, error: blocked };

    try {
        const removed = await tenantGroupTemplates.remove(templateId.data, answers.data, { platformAdmin: viewer.isPlatformAdmin, checkedEnds: ends.checkedEnds });
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.GROUP, {
            name: removed.name, forTenants: true, removed: removed.report.removed.length, kept: removed.report.kept.length,
        }, templateId.data, PLATFORM_LOG);
        await logTenants(viewer, removed.name, removed.report);
        await logProviderMoves(viewer.id, removed.ssoProviders);
        revalidatePath(PAGE);
        return { success: true as const, data: removed.report };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError || error instanceof ConflictError)) log.error("Deleting a group for tenants failed", { templateId: templateId.data }, wrapError(error));
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
        const refused = !current
            ? "The group for tenants no longer exists."
            : refusalOf(actor, shapeOf(current)) ? BEYOND : await platformAdminRefusal(actor, id, current.name, null) ?? await ownMembershipRefusal(viewer, id, current.name, null);
        if (refused) {
            result.failed.push({ id, name: current?.name, error: refused });
            continue;
        }
        try {
            // Without answers a group people hold stays, so the delete ends no membership.
            const removed = await tenantGroupTemplates.remove(id, {}, { platformAdmin: viewer.isPlatformAdmin });
            await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.GROUP, {
                name: removed.name, forTenants: true, removed: removed.report.removed.length, kept: removed.report.kept.length,
            }, id, PLATFORM_LOG);
            await logTenants(viewer, removed.name, removed.report);
            await logProviderMoves(viewer.id, removed.ssoProviders);
            result.succeeded.push(id);
        } catch (error: unknown) {
            if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Deleting a group for tenants failed", { templateId: id }, wrapError(error));
            result.failed.push({ id, name: current?.name, error: messageOf(error, "The group could not be deleted.") });
        }
    }
    revalidatePath(PAGE);
    return { success: true as const, data: result };
}
