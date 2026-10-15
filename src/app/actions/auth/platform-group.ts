"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, type Viewer } from "@/lib/auth/access-control";
import { PLATFORM_PERMISSIONS } from "@/lib/auth/owner-permissions";
import { knownPermissions, knownPlatformPermissions } from "@/lib/auth/permission-areas";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { platformGroupRefusal, type PlatformGroupActor, type PlatformGroupShape } from "@/lib/auth/platform-group-caps";
import { scopeText } from "@/lib/auth/platform-group-summary";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { platformGroupService } from "@/services/user/platform-group-service";

/**
 * The platform groups of the people of the MSP, made, changed, deleted and given under Platform,
 * Users & Groups. Each needs the right to manage the accounts of the platform. Nobody makes,
 * changes or gives a platform group that may do more than they may, nobody changes their own, and
 * the built-in Platform admin is given and taken by a platform admin alone. Every change goes into
 * the audit log of the home tenant, since it is the platform's.
 */

const log = logger.child({ action: "platform-group" });

const IdSchema = z.string().min(1).max(200);

const GroupSchema = z.object({
    name: z.string().trim().min(1, "Give the platform group a name.").max(100, "The name can have at most 100 characters."),
    platformPermissions: z.array(z.string().max(64)).max(50),
    tenantPermissions: z.array(z.string().max(64)).max(100),
    allTenants: z.boolean(),
    tenantIds: z.array(IdSchema).max(1000),
});

export type PlatformGroupFormValues = z.input<typeof GroupSchema>;

const ChoiceSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("admin") }),
    z.object({ kind: z.literal("group"), id: IdSchema }),
]);

export type PlatformGroupChoiceInput = z.input<typeof ChoiceSchema>;

const PLATFORM_LOG = { tenantId: HOME_TENANT_ID };
const PAGE = "/dashboard/platform/users";

const OWN_GROUP = "You are in this platform group. Another admin changes it.";
const GROUP_BEYOND = "This platform group may do more than you may, so only someone who may do all of it changes it.";
const ONLY_ADMIN = "Only a platform admin gives or takes the platform admin role.";

/** The message of a refusal the user can act on, a plain one for anything else. */
const messageOf = (error: unknown, fallback: string) => (error instanceof ValidationError || error instanceof NotFoundError ? error.message : fallback);

/** The viewer as the caps read them, with the id of their own platform group. */
async function actorOf(viewer: Viewer): Promise<PlatformGroupActor & { groupId: string | null }> {
    if (viewer.isPlatformAdmin) return { isPlatformAdmin: true, permissions: viewer.permissions, group: null, groupId: null };
    const own = await platformGroupService.shapeOf(viewer.id);
    return { isPlatformAdmin: false, permissions: viewer.permissions, group: own?.shape ?? null, groupId: own?.id ?? null };
}

/** What would be stored, so the caps compare what counts and not what was sent. */
function shapeOf(values: z.output<typeof GroupSchema>): PlatformGroupShape {
    return {
        platformPermissions: knownPlatformPermissions(values.platformPermissions),
        tenantPermissions: knownPermissions(values.tenantPermissions).filter((permission) => !PLATFORM_PERMISSIONS.has(permission)),
        allTenants: values.allTenants,
        tenantIds: values.allTenants ? [] : values.tenantIds,
    };
}

export async function createPlatformGroup(input: PlatformGroupFormValues) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const parsed = GroupSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };

    const shape = shapeOf(parsed.data);
    const refused = platformGroupRefusal(await actorOf(viewer), shape);
    if (refused) return { success: false as const, error: refused };

    try {
        const group = await platformGroupService.create({ ...parsed.data, ...shape });
        await auditService.log(viewer.id, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.PLATFORM_GROUP, {
            name: group.name,
            platformPermissions: group.platformPermissions,
            tenantPermissions: group.tenantPermissions,
            scope: scopeText(group),
        }, group.id, PLATFORM_LOG);
        revalidatePath(PAGE);
        return { success: true as const, data: { id: group.id } };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError)) log.error("Creating a platform group failed", {}, wrapError(error));
        return { success: false as const, error: messageOf(error, "The platform group could not be created.") };
    }
}

/** Saves a platform group. The audit log gets what changed. Nobody changes their own, or one that may do more than they may. */
export async function updatePlatformGroup(id: string, input: PlatformGroupFormValues) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const groupId = IdSchema.safeParse(id);
    const parsed = GroupSchema.safeParse(input);
    if (!groupId.success || !parsed.success) return { success: false as const, error: parsed.error?.issues[0]?.message ?? "Invalid request" };

    const actor = await actorOf(viewer);
    if (actor.groupId === groupId.data) return { success: false as const, error: OWN_GROUP };
    const group = await platformGroupService.find(groupId.data);
    if (!group) return { success: false as const, error: "The platform group no longer exists." };
    if (platformGroupRefusal(actor, group.shape)) return { success: false as const, error: GROUP_BEYOND };
    const shape = shapeOf(parsed.data);
    const refused = platformGroupRefusal(actor, shape);
    if (refused) return { success: false as const, error: refused };

    try {
        const change = await platformGroupService.update(groupId.data, { ...parsed.data, ...shape });
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.PLATFORM_GROUP, { ...change }, groupId.data, PLATFORM_LOG);
        revalidatePath(PAGE);
        return { success: true as const };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Saving a platform group failed", { groupId: groupId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The platform group could not be saved.") };
    }
}

/** Deletes a platform group. Its members keep their account and their tenants, and hold no platform group any more. */
export async function deletePlatformGroup(id: string) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const groupId = IdSchema.safeParse(id);
    if (!groupId.success) return { success: false as const, error: "Invalid request" };

    const actor = await actorOf(viewer);
    if (actor.groupId === groupId.data) return { success: false as const, error: "You are in this platform group. Another admin deletes it." };
    const group = await platformGroupService.find(groupId.data);
    if (!group) return { success: false as const, error: "The platform group no longer exists." };
    if (platformGroupRefusal(actor, group.shape)) return { success: false as const, error: GROUP_BEYOND };

    try {
        const removed = await platformGroupService.delete(groupId.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.PLATFORM_GROUP, { ...removed }, groupId.data, PLATFORM_LOG);
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: removed };
    } catch (error: unknown) {
        if (!(error instanceof NotFoundError)) log.error("Deleting a platform group failed", { groupId: groupId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The platform group could not be deleted.") };
    }
}

/**
 * Gives an account its platform group: none, the built-in Platform admin or another one, which
 * clears the rest. Nobody changes their own, only a platform admin gives or takes Platform admin,
 * and nobody gives or takes a platform group that may do more than they may.
 */
export async function setUserPlatformGroup(userId: string, choice: PlatformGroupChoiceInput) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const user = IdSchema.safeParse(userId);
    const picked = ChoiceSchema.safeParse(choice);
    if (!user.success || !picked.success) return { success: false as const, error: "Invalid request" };
    if (user.data === viewer.id) return { success: false as const, error: "Another admin changes your own platform group." };

    const target = await platformGroupService.holderOf(user.data);
    if (!target) return { success: false as const, error: "The account no longer exists." };
    if ((picked.data.kind === "admin" || target.platformAdmin) && !viewer.isPlatformAdmin) return { success: false as const, error: ONLY_ADMIN };

    const actor = await actorOf(viewer);
    if (!viewer.isPlatformAdmin) {
        // Nobody takes a platform group from someone it lets do more than the viewer may.
        const current = target.groupId ? await platformGroupService.find(target.groupId) : null;
        if (current && platformGroupRefusal(actor, current.shape)) {
            return { success: false as const, error: "Their platform group may do more than you may, so only someone who may do all of it changes it." };
        }
    }
    if (picked.data.kind === "group") {
        const group = await platformGroupService.find(picked.data.id);
        if (!group) return { success: false as const, error: "The platform group no longer exists." };
        const refused = platformGroupRefusal(actor, group.shape);
        if (refused) return { success: false as const, error: "This platform group may do more than you may, so you cannot give it to anyone." };
    }

    try {
        const change = await platformGroupService.setFor(user.data, picked.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Platform group set", ...change }, user.data, PLATFORM_LOG);
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: change };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Giving a platform group failed", { userId: user.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The platform group could not be changed.") };
    }
}
