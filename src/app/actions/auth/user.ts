"use server"

import { revalidatePath } from "next/cache";
import { checkPermission, currentSessionId, getViewer, hasPermission, hasPermissionWithContext, type Viewer } from "@/lib/auth/access-control";
import { ACCOUNT_CHANGE, emailClaimScope, roleRefusal } from "@/lib/auth/account-access";
import { reachCovers } from "@/lib/auth/platform-group-caps";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { DATE_FORMAT_VALUES, TIME_FORMAT_VALUES, isKnownTimezone } from "@/lib/core/profile-formats";
import { PERMISSIONS, TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import { authService } from "@/services/auth/auth-service";
import { checkCurrentPassword, PASSWORD_LOCKED } from "@/services/auth/password-tries";
import { userService } from "@/services/user/user-service";
import { groupService } from "@/services/user/group-service";
import { membershipService } from "@/services/tenant/membership-service";
import { tenantGroupRefusal } from "@/services/tenant/member-rules";
import { tenantService } from "@/services/tenant/tenant-service";
import { claimedEmailRefusal } from "@/services/sso/email-domain-claims";
import { CHANGED_EMAIL_ANSWERS, EMAIL_REFUSED, newAccountEmailRefusal, takenEmailRefusal } from "@/services/user/new-account-email";
import { ACCOUNT_UNKNOWN, maySeeAccount, shownAccountName } from "@/services/user/account-visibility";
import { Prisma } from "@prisma/client";
import { auditService } from "@/services/audit-service";
import { accountLogOrigin } from "@/services/audit/account-log";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditValue } from "@/lib/core/audit-diff";
import { logger } from "@/lib/logging/logger";
import { wrapError, ValidationError } from "@/lib/logging/errors";
import { userMessage } from "@/lib/logging/user-message";
import { notify } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { DeleteModeSchema, PERMANENT_DELETE_REFUSED, type DeleteMode } from "@/lib/core/delete-mode";
import { getAutoRedirectOnJobStart, setAutoRedirectOnJobStart } from "@/services/user/preference-service";
import { accountTrashPlaceOf } from "@/services/trash/account-place";
import { runAsTenant } from "@/lib/tenant/context";
import { z } from "zod";

const log = logger.child({ action: "user" });

const BEYOND_TENANT = "Your platform group does not reach this tenant, and you may not manage its users.";

/** What a bulk delete reports for an account that does not exist, see `userService.deleteUser`. */
const USER_GONE = "User not found";

/**
 * The name of an account the caller may change, or why they may not: the account of a platform
 * admin, and one that also works in another tenant, is for a platform admin alone, see
 * `accountRefusal`. An account the caller may not see answers exactly like one that does not
 * exist, `ACCOUNT_UNKNOWN`, so the answer never tells them apart.
 */
async function changeableAccount(userId: string, caller: Viewer): Promise<{ name: string; refusal: string | null }> {
    const name = await shownAccountName({ ...caller, userId: caller.id }, userId);
    if (name === null) return { name: "", refusal: ACCOUNT_UNKNOWN };
    const refusal = await userService.accountRefusalFor(caller, userId);
    return { name, refusal };
}

/** Why the caller may not give this group to anyone in their tenant, null when they may. Nobody hands out more than they hold. */
async function groupRefused(groupId: string | null, caller: Viewer): Promise<string | null> {
    if (!groupId || groupId === "none") return null;
    const group = await groupService.find(groupId);
    if (!group) return "The group no longer exists.";
    return roleRefusal(caller, group);
}

/**
 * Whether the caller may delete this account at once and for good, which skips Recently deleted.
 * That takes what restoring or purging its entry there would take, in the place it would wait, see
 * `accountTrashPlace`: a platform admin for an entry only a platform admin handles, otherwise
 * `TRASH_ADMIN_PERMISSION` in the tenant of the entry, never only in the tenant the caller works in.
 * An account that is gone passes, the delete then says so.
 */
async function mayDeletePermanently(caller: Viewer, userId: string): Promise<boolean> {
    if (caller.isPlatformAdmin) return true;
    const place = await accountTrashPlaceOf(userId);
    if (!place) return true;
    if (place.superAdminOnly) return false;
    const permissions = place.tenantId === caller.tenantId ? caller.permissions : await userService.permissionsIn(caller.id, place.tenantId);
    return permissions.includes(TRASH_ADMIN_PERMISSION);
}

const CreateUserSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
    email: z.string().trim().email("Invalid email address."),
    // The rules of Settings > Passwords are checked by the service, which names the one it breaks.
    password: z.string().min(1, "Enter a password.").max(MAX_PASSWORD_LENGTH, `Password can have at most ${MAX_PASSWORD_LENGTH} characters.`),
    /** The group the user starts in, none for a user who sees nothing until someone picks one. */
    groupId: z.string().min(1).nullable(),
    /** The tenant the user starts in, which whoever manages the accounts of the platform names on the list of every account. Elsewhere it is the open one. */
    tenantId: z.string().min(1).max(200).optional(),
});

export type CreateUserInput = z.input<typeof CreateUserSchema>;

export async function createUser(input: CreateUserInput) {
    const currentUser = await checkPermission(ACCOUNT_CHANGE);
    const parsed = CreateUserSchema.safeParse(input);
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    }
    const { tenantId: picked, ...data } = parsed.data;
    // The new account joins the tenant of whoever creates it. Whoever manages the accounts of the
    // platform names the tenant on the list of every account, from All tenants or from inside any tenant.
    const names = currentUser && (currentUser.isPlatformAdmin || hasPermissionWithContext(currentUser, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE));
    const tenantId = currentUser?.allTenants || (names && picked) ? picked : currentUser?.tenantId;
    if (!currentUser || (!currentUser.allTenants && !tenantId)) return { success: false, error: "Unauthorized" };
    if (!tenantId) return { success: false, error: "Pick the tenant the person works in." };
    // Someone of a platform group names only a tenant they may open.
    if (!currentUser.isPlatformAdmin && tenantId !== currentUser.tenantId && !(await tenantService.switchable(currentUser.id, false)).some((tenant) => tenant.id === tenantId)) {
        return { success: false, error: "The tenant no longer exists." };
    }

    // A group belongs to its tenant, so it is looked up there, and nobody gives one that may do more
    // than they may in that tenant, which may be another than the one they work in.
    const actor = tenantId === currentUser.tenantId || currentUser.isPlatformAdmin
        ? currentUser
        : { ...currentUser, tenantId, permissions: await userService.permissionsIn(currentUser.id, tenantId) };
    // The right to manage the accounts of the platform adds people to the tenants it reaches, the
    // right to manage the users of a tenant to that tenant.
    const reach = await userService.accountsReachOf(currentUser);
    if (!currentUser.isPlatformAdmin && !reachCovers(reach, tenantId) && !actor.permissions.includes(PERMISSIONS.USERS.WRITE)) {
        return { success: false, error: BEYOND_TENANT };
    }
    const claimScope = emailClaimScope({ ...currentUser, reach });
    const claimed = await claimedEmailRefusal(data.email, [tenantId, ...claimScope.tenantIds], claimScope.platformLevel);
    if (claimed) return { success: false, error: claimed };

    const refused = await runAsTenant(tenantId, () => groupRefused(data.groupId, actor));
    if (refused) return { success: false, error: refused };
    // Whoever does not see an account of this email never learns that it exists, see `newAccountEmailRefusal`.
    const taken = await newAccountEmailRefusal(data.email, { ...currentUser, userId: currentUser.id }, tenantId);
    if (taken) return { success: false, error: taken, field: "email" };

    try {
        const user = await userService.createUser({ ...data, tenantId });
        revalidatePath("/dashboard/users");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.USER,
            { name: data.name, email: data.email, groupId: data.groupId },
            user.id,
            { tenantId }
        );

        // System notification (fire-and-forget)
        notify({
            eventType: NOTIFICATION_EVENTS.USER_CREATED,
            data: {
                userName: data.name,
                email: data.email,
                createdBy: currentUser?.name,
                timestamp: new Date().toISOString(),
            },
        }).catch(() => {});

        return { success: true, data: { id: user.id } };
    } catch (error: unknown) {
        // A rule of Settings > Passwords names itself, anything else stays in the log.
        if (error instanceof ValidationError) return { success: false, error: error.message };
        log.error("Failed to create user", {}, wrapError(error));
        return { success: false, error: "The user could not be created." };
    }
}

/**
 * Gives a user a group in the caller's tenant, or takes them out of it with none. Nobody changes
 * their own group or gives one that may do more than they may.
 */
const UserGroupSchema = z.object({ userId: z.string().min(1).max(200), groupId: z.string().min(1).max(200).nullable() });

export async function updateUserGroup(id: string, group: string | null) {
    const currentUser = await checkPermission(PERMISSIONS.USERS.WRITE);
    const input = UserGroupSchema.safeParse({ userId: id, groupId: group });
    if (!input.success) return { success: false, error: "Invalid request" };
    const { userId, groupId } = input.data;
    // All tenants holds a group per tenant, which the panel of the user changes with `setTenantMember`.
    if (currentUser.allTenants) return { success: false, error: "Open a tenant, or change the group per tenant in the panel of the user." };
    if (!currentUser.tenantId) return { success: false, error: "Unauthorized" };

    // Nobody changes their own group, gives one to someone of another tenant, or gives or takes one beyond them.
    const refused = await tenantGroupRefusal(currentUser, userId, groupId);
    if (refused) return { success: false, error: refused };

    try {
        const given = groupId && groupId !== "none" ? await groupService.find(groupId) : null;
        await membershipService.setRole(userId, currentUser.tenantId, groupId === "none" ? null : groupId, { platformAdmin: currentUser.isPlatformAdmin });
        revalidatePath("/dashboard/users");

        // The entry names the user and the group, which may both be gone by the time someone reads it.
        const [named] = await userService.namesOf([userId]);
        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            { change: "Updating Group", name: named?.name, groupId, ...(given ? { group: given.name } : {}) },
            userId
        );

        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: userMessage(error, "The group could not be changed. The server log has the details.", log, "Failed to update user group", { userId }) };
    }
}

const UserIdSchema = z.string().min(1).max(200);

/** Deletes a user, who waits in Recently deleted unless `permanently`. */
export async function deleteUser(id: string, mode?: DeleteMode) {
    const currentUser = await checkPermission(ACCOUNT_CHANGE);
    const parsedId = UserIdSchema.safeParse(id);
    const parsedMode = DeleteModeSchema.safeParse(mode);
    if (!parsedId.success || !parsedMode.success) return { success: false, error: "Invalid request" };
    const userId = parsedId.data;
    const { permanently = false } = parsedMode.data;

    // Refused here and not only left out of the menus, like in the bulk delete.
    if (currentUser.id === userId) {
        return { success: false, error: "You cannot delete your own account." };
    }
    const target = await changeableAccount(userId, currentUser);
    if (target.refusal) return { success: false, error: target.refusal };
    if (permanently && !(await mayDeletePermanently(currentUser, userId))) return { success: false, error: PERMANENT_DELETE_REFUSED };

    try {
        // Read before the delete, which ends the memberships.
        const origin = await accountLogOrigin(currentUser, userId);
        const deleted = await userService.deleteUser(userId, { permanently, by: currentUser.id });
        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.USER,
            { name: deleted.name || deleted.email, ...(permanently ? { permanently: true } : {}) },
            userId,
            origin
        );

        return { success: true };
    } catch (error: unknown) {
        // The last platform admin and the last user stay, and say so. Anything else stays in the log.
        if (error instanceof ValidationError) return { success: false, error: error.message };
        log.error("Failed to delete user", { userId }, wrapError(error));
        return { success: false, error: "The user could not be deleted." };
    }
}

const PasskeyTwoFactorSchema = z.object({ userId: z.string().min(1).max(200), enabled: z.boolean() });

/**
 * Switches whether a passkey counts as the second factor of an account.
 * @no-permission-required - Self-service for the own account, as far as `profile:manage_passkeys`
 * checked below allows. Another account needs `ACCOUNT_CHANGE` and `accountRefusal`, checked below too.
 */
export async function togglePasskeyTwoFactor(id: string, on: boolean) {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");
    const input = PasskeyTwoFactorSchema.safeParse({ userId: id, enabled: on });
    if (!input.success) return { success: false, error: "Invalid request" };
    const { userId, enabled } = input.data;

    // Allow user to edit their own settings, as far as their group allows, otherwise require permission
    if (currentUser.id !== userId) {
        await checkPermission(ACCOUNT_CHANGE);
        const target = await changeableAccount(userId, currentUser);
        if (target.refusal) return { success: false, error: target.refusal };
    } else if (!(await hasPermission(PERMISSIONS.PROFILE.MANAGE_PASSKEYS))) {
        return { success: false, error: "Your group may not change your passkeys." };
    } else if (!enabled && !(await hasPermission(PERMISSIONS.PROFILE.MANAGE_2FA)) && (await userService.passkeyOffEndsTwoFactor(userId))) {
        // Without an authenticator app the passkey is the whole second factor, which the switch would end.
        return { success: false, error: "Your group may not turn off your second factor." };
    } else if (enabled && !(await hasPermission(PERMISSIONS.PROFILE.MANAGE_2FA)) && !(await userService.hasAuthenticatorApp(userId))) {
        // Without an authenticator app the switch turns the second factor on, like setting up one.
        return { success: false, error: "Your group may not turn on your second factor." };
    }

    try {
        const origin = await accountLogOrigin(currentUser, userId);
        const user = await userService.togglePasskeyTwoFactor(userId, enabled);
        revalidatePath("/dashboard/settings");
        // The switch of the page turns it the other way.
        const changes = [{ field: "Passkey as second factor", from: auditValue(!enabled), to: auditValue(enabled) }];
        await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { name: user?.name, changes }, userId, origin);
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to toggle passkey 2FA", { userId }, wrapError(error));
        return { success: false, error: "The passkey setting could not be changed." };
    }
}

const OwnPasswordSchema = z.object({
    currentPassword: z.string().min(1, "Enter the password you have now."),
    // The rules of Settings > Passwords are checked by the service, which names the one it breaks.
    newPassword: z.string().min(1, "Enter a new password.").max(MAX_PASSWORD_LENGTH, `The password can have at most ${MAX_PASSWORD_LENGTH} characters.`),
});

/**
 * Changes the own password with the current one. The new one follows the rules of
 * Settings > Passwords, and every other session of the account ends, so the old password stops
 * working everywhere at once.
 * @no-permission-required - Self-service: only the own password, as far as `profile:update_password` allows, checked below.
 */
export async function updateOwnPassword(currentPassword: string, newPassword: string) {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");
    if (!(await hasPermission(PERMISSIONS.PROFILE.UPDATE_PASSWORD))) {
        return { success: false, error: "Your group may not change your password." };
    }
    const parsed = OwnPasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };

    if (!(await userService.hasPassword(currentUser.id))) {
        return { success: false, error: "No password account found. Please set up a password first." };
    }

    try {
        // Checked against the stored hash, without signing in, and locked for a while after a few wrong ones.
        const check = await checkCurrentPassword(currentUser.id, parsed.data.currentPassword);
        if (check === "locked") return { success: false, error: PASSWORD_LOCKED };
        if (check === "wrong") return { success: false, error: "Incorrect current password" };
        const origin = await accountLogOrigin(currentUser, currentUser.id);
        await authService.setPassword(currentUser.id, parsed.data.newPassword);
        const signedOut = await userService.revokeSessions(currentUser.id, await currentSessionId());

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            { name: currentUser.name, change: "Password Changed", signedOut },
            currentUser.id,
            origin
        );

        return { success: true, data: { signedOut } };
    } catch (error: unknown) {
        return { success: false, error: userMessage(error, "The password could not be changed. The server log has the details.", log, "Failed to update password", { userId: currentUser.id }) };
    }
}

const UpdateUserSchema = z.object({
    userId: z.string().min(1).max(200),
    data: z.object({
        name: z.string().trim().min(2, "A name has at least 2 characters.").max(100, "A name has at most 100 characters.").optional(),
        email: z.string().trim().toLowerCase().email("That is no email address.").max(320).optional(),
        timezone: z.string().refine(isKnownTimezone, "That time zone is unknown.").optional(),
        dateFormat: z.string().refine((value) => DATE_FORMAT_VALUES.includes(value), "Pick one of the date formats.").optional(),
        timeFormat: z.string().refine((value) => TIME_FORMAT_VALUES.includes(value), "Pick one of the time formats.").optional(),
    }),
});

/**
 * Changes the name, the email or the dates of an account: someone else's with the right to change
 * accounts, the own one as far as the `profile:*` permissions allow.
 * @no-permission-required - Self-service for the own account, as far as the `profile:*` permissions
 * checked below allow. Another account needs `ACCOUNT_CHANGE` and `accountRefusal`, checked below too.
 */
export async function updateUser(userId: string, input: { name?: string; email?: string; timezone?: string; dateFormat?: string; timeFormat?: string }) {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");
    const parsed = UpdateUserSchema.safeParse({ userId, data: input });
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    const data = parsed.data.data;
    // The entry always names the account, also when the name stays.
    let accountName = currentUser.name || currentUser.email;
    // Who set a new email, which decides whether a sign-in provider links the account by it, see `userService.updateUser`.
    let emailSetBy: "self" | "admin" | undefined;

    // Allow user to edit their own profile, otherwise require permission
    if (currentUser.id !== userId) {
        await checkPermission(ACCOUNT_CHANGE);
        const target = await changeableAccount(userId, currentUser);
        if (target.refusal) return { success: false, error: target.refusal };
        accountName = target.name;
        // Compared with the email of the account being changed, so a change of its name alone never meets the check of a claimed domain.
        const emailChanges = data.email !== undefined && data.email !== (await userService.emailOf(userId));
        if (emailChanges) {
            // Someone of a platform group of some tenants gives the emails their tenants claim, see `emailClaimScope`.
            // Beyond that only the tenants of the account count, never the one the caller works in.
            const scope = emailClaimScope({ ...currentUser, reach: await userService.accountsReachOf(currentUser) });
            const claimed = await claimedEmailRefusal(data.email!, [...(await userService.emailTenantsOf(userId)), ...scope.tenantIds], scope.platformLevel);
            if (claimed) return { success: false, error: claimed };
            // Whoever does not see the account that holds the email never learns that it exists, see `takenEmailRefusal`.
            const taken = await takenEmailRefusal(data.email!, { ...currentUser, userId: currentUser.id }, currentUser.tenantId, CHANGED_EMAIL_ANSWERS, { accountId: userId });
            if (taken) return { success: false, error: taken };
            emailSetBy = "admin";
        }
    } else {
        // The own name and email change only as far as the profile permissions allow, whatever else the group gives.
        const emailChanges = data.email !== undefined && data.email !== currentUser.email;
        if (data.name !== undefined && data.name !== currentUser.name && !(await hasPermission(PERMISSIONS.PROFILE.UPDATE_NAME))) {
            return { success: false, error: "Your group may not change your name." };
        }
        if (emailChanges && !(await hasPermission(PERMISSIONS.PROFILE.UPDATE_EMAIL))) {
            return { success: false, error: "Your group may not change your email." };
        }
        const claimed = emailChanges ? await userService.ownEmailRefusal(currentUser.id, data.email!) : null;
        if (claimed) return { success: false, error: claimed };
        const taken = emailChanges ? await takenEmailRefusal(data.email!, { ...currentUser, userId: currentUser.id }, currentUser.tenantId, CHANGED_EMAIL_ANSWERS, { accountId: currentUser.id }) : null;
        if (taken) return { success: false, error: taken };
        if (emailChanges) emailSetBy = "self";
    }

    try {
        const origin = await accountLogOrigin(currentUser, userId);
        await userService.updateUser(userId, data, emailSetBy);
        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            { ...data, name: data.name ?? accountName },
            userId,
            origin
        );

        return { success: true };
    } catch (error: unknown) {
        // Taken meanwhile, answered like any email the caller may not give, never with the words of the database.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { success: false, error: EMAIL_REFUSED };
        log.error("Failed to update user", { userId }, wrapError(error));
        return { success: false, error: "The user could not be saved." };
    }
}

const PreferencesSchema = z.object({
    userId: z.string().min(1).max(200),
    data: z.object({ autoRedirectOnJobStart: z.boolean().optional() }).strict(),
});

/**
 * Update user preferences (self-service)
 * Users can only update their own preferences - no admin permission required
 * @no-permission-required
 */
export async function updateUserPreferences(userId: string, input: { autoRedirectOnJobStart?: boolean }) {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");
    const parsed = PreferencesSchema.safeParse({ userId, data: input });
    if (!parsed.success) return { success: false, error: "Invalid request" };
    const data = parsed.data.data;

    // Allow user to edit their own preferences only
    if (currentUser.id !== parsed.data.userId) {
        throw new Error("You can only update your own preferences");
    }

    try {
        await setAutoRedirectOnJobStart(currentUser.id, data.autoRedirectOnJobStart);

        revalidatePath("/dashboard/profile");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            { name: currentUser.name, preferences: data },
            userId,
            await accountLogOrigin(currentUser, userId)
        );

        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update preferences", { userId }, wrapError(error));
        return { success: false, error: "The preferences could not be saved." };
    }
}

/**
 * Get user preference value (self-service)
 * Users can only read their own preferences - no admin permission required
 * @no-permission-required
 */
export async function getUserPreference(key: 'autoRedirectOnJobStart'): Promise<boolean> {
    const currentUser = await getViewer();
    if (!currentUser) return true; // Default to true if not logged in

    if (key === 'autoRedirectOnJobStart') {
        return getAutoRedirectOnJobStart(currentUser.id);
    }

    return true;
}

/**
 * Deletes several users.
 *
 * The caller's own account is refused here rather than only being hidden in the UI, since
 * a client-side check is not a guarantee. An account the caller may not change is reported
 * instead of sent. The last-platform-admin and last-user guards live in the service and surface
 * as per-user failures.
 */
export async function bulkDeleteUsers(userIds: string[], mode?: DeleteMode) {
    const currentUser = await checkPermission(ACCOUNT_CHANGE);

    const parsed = BulkIdsSchema.safeParse(userIds);
    const parsedMode = DeleteModeSchema.safeParse(mode);
    if (!parsed.success || !parsedMode.success) {
        return { success: false as const, error: "Invalid request" };
    }
    const { permanently = false } = parsedMode.data;

    try {
        const guarded: { id: string; error: string; unseen?: boolean }[] = [];
        for (const id of parsed.data) {
            if (id === currentUser.id) continue;
            // An account the caller may not see reads like one that does not exist, before any rule
            // tells them apart, and is never deleted, like in `deleteUser`.
            if (!(await maySeeAccount({ ...currentUser, userId: currentUser.id }, id))) {
                guarded.push({ id, error: USER_GONE, unseen: true });
                continue;
            }
            const refused = await userService.accountRefusalFor(currentUser, id);
            if (refused) guarded.push({ id, error: refused });
            // Each account waits in its own place, so each is checked there.
            else if (permanently && !(await mayDeletePermanently(currentUser, id))) guarded.push({ id, error: PERMANENT_DELETE_REFUSED });
        }
        const deletable = parsed.data.filter((id) => id !== currentUser.id && !guarded.some((user) => user.id === id));
        // Read before the delete, which ends the memberships, and the names, which go with the accounts.
        const origin = await accountLogOrigin(currentUser, deletable);
        const deletedNames = new Map((await userService.namesOf(deletable)).map((user) => [user.id, user.name]));
        const result = await userService.deleteUsers(deletable, { permanently, by: currentUser.id });

        if (currentUser && parsed.data.includes(currentUser.id)) {
            result.failed.push({
                id: currentUser.id,
                name: currentUser.name || currentUser.email,
                error: "You cannot delete your own account.",
            });
        }
        const names = new Map((await userService.namesOf(guarded.filter((user) => !user.unseen).map((user) => user.id))).map((user) => [user.id, user.name]));
        for (const user of guarded) {
            // An account the caller may not see reads like one that does not exist, its name and why it stays included.
            if (user.unseen) result.failed.push({ id: user.id, error: USER_GONE });
            else result.failed.push({ id: user.id, name: names.get(user.id) ?? user.id, error: user.error });
        }

        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.USER,
            {
                bulk: true, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length,
                names: result.succeeded.flatMap((id) => deletedNames.get(id) ?? []),
                ...(permanently ? { permanently: true } : {}),
            },
            undefined,
            origin
        );

        return { success: true as const, data: result };
    } catch (error: unknown) {
        return { success: false as const, error: userMessage(error, "The users could not be deleted. The server log has the details.", log, "Failed to bulk delete users") };
    }
}
