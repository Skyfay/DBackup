"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, type Viewer } from "@/lib/auth/access-control";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { PLATFORM_PERMISSIONS } from "@/lib/auth/owner-permissions";
import { knownPermissions, knownPlatformPermissions } from "@/lib/auth/permission-areas";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { platformGroupRefusal, type PlatformGroupActor, type PlatformGroupShape } from "@/lib/auth/platform-group-caps";
import { scopeText } from "@/lib/auth/platform-group-summary";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { emptyBulkResult } from "@/lib/core/bulk";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { getErrorMessage, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { notify } from "@/services/notifications/system-notification-service";
import { platformGroupService } from "@/services/user/platform-group-service";
import { userService } from "@/services/user/user-service";

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
const ONLY_ALL_TENANTS = "An account that runs the platform is made by a platform admin or someone of a platform group of all tenants. Make it in a tenant your platform group reaches.";

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

/**
 * Deletes several platform groups, each like Delete: the own platform group, Platform admin and
 * one that may do more than the viewer stay, with why.
 */
export async function bulkDeletePlatformGroups(ids: string[]) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    const actor = await actorOf(viewer);
    const result = emptyBulkResult();
    for (const id of parsed.data) {
        const group = await platformGroupService.find(id);
        const refused = !group
            ? "The platform group no longer exists."
            : actor.groupId === id ? "You are in this platform group. Another admin deletes it." : platformGroupRefusal(actor, group.shape) ? GROUP_BEYOND : null;
        if (refused) {
            result.failed.push({ id, name: group?.name, error: refused });
            continue;
        }
        try {
            const removed = await platformGroupService.delete(id);
            await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.PLATFORM_GROUP, { ...removed }, id, PLATFORM_LOG);
            result.succeeded.push(id);
        } catch (error: unknown) {
            if (!(error instanceof NotFoundError)) log.error("Deleting a platform group failed", { groupId: id }, wrapError(error));
            result.failed.push({ id, name: group?.name, error: messageOf(error, "The platform group could not be deleted.") });
        }
    }
    revalidatePath("/dashboard", "layout");
    return { success: true as const, data: result };
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
        // Someone of a platform group of some tenants gives a platform group only to an account they
        // may change, one whose tenants their platform group all reaches, see `accountRefusal`.
        const reach = await platformGroupService.reachOf(viewer.id);
        if (reach !== "all") {
            const refused = await userService.accountRefusalFor({ ...viewer, reach }, user.data);
            if (refused) return { success: false as const, error: refused };
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

const PlatformUserSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
    email: z.string().trim().email("Invalid email address."),
    // The rules of Settings > Passwords are checked by the service, which names the one it breaks.
    password: z.string().min(1, "Enter a password.").max(MAX_PASSWORD_LENGTH, `Password can have at most ${MAX_PASSWORD_LENGTH} characters.`),
    platformGroup: z.discriminatedUnion("kind", [z.object({ kind: z.literal("admin") }), z.object({ kind: z.literal("group"), id: IdSchema })]),
});

export type PlatformUserInput = z.input<typeof PlatformUserSchema>;

/**
 * Creates an account for the people of the MSP with its platform group in one step, Platform admin
 * or another one, and no tenant. Only a platform admin makes a platform admin, and nobody gives a
 * platform group that may do more than they may. The audit log of the home tenant keeps it.
 */
export async function createPlatformUser(input: PlatformUserInput) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const parsed = PlatformUserSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    const { platformGroup, ...data } = parsed.data;

    if (platformGroup.kind === "admin" && !viewer.isPlatformAdmin) return { success: false as const, error: ONLY_ADMIN };
    // An account of no tenant belongs to the platform, which a platform group of some tenants does not look after.
    if (!viewer.isPlatformAdmin && (await platformGroupService.reachOf(viewer.id)) !== "all") return { success: false as const, error: ONLY_ALL_TENANTS };
    let groupName = "Platform admin";
    if (platformGroup.kind === "group") {
        const group = await platformGroupService.find(platformGroup.id);
        if (!group) return { success: false as const, error: "The platform group no longer exists." };
        if (platformGroupRefusal(await actorOf(viewer), group.shape)) return { success: false as const, error: "This platform group may do more than you may, so you cannot give it to anyone." };
        groupName = group.name;
    }

    try {
        const user = await userService.createPlatformUser(data, platformGroup);
        await auditService.log(viewer.id, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.USER, { name: data.name, email: data.email, platformGroup: groupName }, user.id, PLATFORM_LOG);
        notify({
            eventType: NOTIFICATION_EVENTS.USER_CREATED,
            data: { userName: data.name, email: data.email, createdBy: viewer.name, timestamp: new Date().toISOString() },
        }).catch(() => {});
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: { id: user.id } };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError)) log.warn("Creating an account of the platform failed", {}, wrapError(error));
        return { success: false as const, error: getErrorMessage(error) };
    }
}
