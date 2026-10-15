"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, currentSessionId, getViewer } from "@/lib/auth/access-control";
import { roleRefusal } from "@/lib/auth/account-access";
import { isEmailLoginDisabled } from "@/lib/auth/env-flags";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { INVITATION_MAX_DAYS, invitationService, type InvitationPreview, type InvitationRow } from "@/services/tenant/invitation-service";
import { tenantService } from "@/services/tenant/tenant-service";
import { groupService } from "@/services/user/group-service";

const log = logger.child({ action: "invitation" });

const IdSchema = z.string().min(1).max(200);
const TokenSchema = z.string().min(20).max(100);

const InviteSchema = z.object({
    groupId: IdSchema,
    /** Who the link is for, shown in the list of open links. */
    note: z.string().trim().max(100, "The note can have at most 100 characters.").optional(),
    days: z.coerce.number().int().min(1).max(INVITATION_MAX_DAYS),
});

const AccountSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
    email: z.string().trim().email("Invalid email address."),
    // The rules of Settings > Passwords are checked by the service, which names the one it breaks.
    password: z.string().min(1, "Enter a password.").max(MAX_PASSWORD_LENGTH, `Password can have at most ${MAX_PASSWORD_LENGTH} characters.`),
});

/** A link that is unknown, used or run out reads the same, so the answer gives nothing away. */
const LINK_GONE = "This invitation does not work any more. Ask for a new one.";

const messageOf = (error: unknown, fallback: string) => {
    if (error instanceof NotFoundError) return LINK_GONE;
    return error instanceof ValidationError || error instanceof ConflictError ? error.message : fallback;
};

/**
 * Makes a link that adds someone to the caller's tenant with a group. Nobody hands out a group that
 * may do more than they may. The link comes back once.
 */
export async function createInvitation(input: z.input<typeof InviteSchema>) {
    const viewer = await checkPermission(PERMISSIONS.USERS.WRITE);
    if (!viewer.tenantId) return { success: false as const, error: "Unauthorized" };
    const parsed = InviteSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };

    const group = await groupService.find(parsed.data.groupId);
    if (!group) return { success: false as const, error: "The group no longer exists." };
    const refused = roleRefusal(viewer, group);
    if (refused) return { success: false as const, error: refused };

    try {
        const invitation = await invitationService.create({
            tenantId: viewer.tenantId,
            groupId: group.id,
            note: parsed.data.note,
            days: parsed.data.days,
            createdById: viewer.id,
            createdByName: viewer.name,
        });
        await auditService.log(viewer.id, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.TENANT, { change: "Invitation created", group: group.name, note: parsed.data.note ?? null }, viewer.tenantId);
        revalidatePath("/dashboard/users");
        return { success: true as const, data: { id: invitation.id, path: `/invite?token=${invitation.token}`, expiresAt: invitation.expiresAt } };
    } catch (error: unknown) {
        log.error("Creating an invitation failed", {}, wrapError(error));
        return { success: false as const, error: "The invitation could not be created." };
    }
}

/** The open links of the caller's tenant. */
export async function listInvitations(): Promise<{ success: true; data: InvitationRow[] } | { success: false; error: string }> {
    const viewer = await checkPermission(PERMISSIONS.USERS.READ);
    if (!viewer.tenantId) return { success: false, error: "Unauthorized" };
    return { success: true, data: await invitationService.list(viewer.tenantId) };
}

/** Takes back a link nobody used yet. */
export async function revokeInvitation(id: string) {
    const viewer = await checkPermission(PERMISSIONS.USERS.WRITE);
    const parsed = IdSchema.safeParse(id);
    if (!viewer.tenantId || !parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        const revoked = await invitationService.revoke(parsed.data, viewer.tenantId);
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.TENANT, { change: "Invitation revoked", group: revoked.groupName, note: revoked.note }, viewer.tenantId);
        revalidatePath("/dashboard/users");
        return { success: true as const };
    } catch (error: unknown) {
        if (error instanceof NotFoundError) return { success: false as const, error: "The invitation is gone already." };
        log.error("Revoking an invitation failed", { invitationId: parsed.data }, wrapError(error));
        return { success: false as const, error: "The invitation could not be revoked." };
    }
}

/**
 * What the page of a link shows: the tenant and the group, whether someone is signed in, and
 * whether a new account with a password may be made here.
 * @no-permission-required - the link itself is the right to see what it is for
 */
export async function previewInvitation(token: string): Promise<{
    invitation: InvitationPreview | null;
    signedIn: { name: string; email: string } | null;
    passwordSignUp: boolean;
}> {
    const parsed = TokenSchema.safeParse(token);
    const [invitation, viewer] = await Promise.all([parsed.success ? invitationService.preview(parsed.data) : null, getViewer()]);
    return {
        invitation,
        signedIn: viewer ? { name: viewer.name, email: viewer.email } : null,
        passwordSignUp: !isEmailLoginDisabled(),
    };
}

/**
 * Adds the signed-in account to the tenant of a link, and opens that tenant.
 * @no-permission-required - the link is the right to join, and it only adds the caller's own account
 */
export async function acceptInvitation(token: string) {
    const viewer = await getViewer();
    if (!viewer) return { success: false as const, error: "Sign in first." };
    const parsed = TokenSchema.safeParse(token);
    if (!parsed.success) return { success: false as const, error: LINK_GONE };

    try {
        const accepted = await invitationService.accept(parsed.data, viewer.id);
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { change: "Invitation accepted", joined: accepted.joined }, accepted.tenantId, { tenantId: accepted.tenantId });
        const sessionId = await currentSessionId();
        if (sessionId) await tenantService.setActive(sessionId, viewer.id, accepted.tenantId, viewer.isPlatformAdmin);
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: { tenantName: accepted.tenantName, joined: accepted.joined } };
    } catch (error: unknown) {
        if (!(error instanceof NotFoundError)) log.error("Accepting an invitation failed", {}, wrapError(error));
        return { success: false as const, error: messageOf(error, "The invitation could not be accepted.") };
    }
}

/**
 * Creates an account from a link and adds it to the tenant. The person signs in on the login page
 * afterwards. Refused while sign-in with a password is off, where only a sign-in provider makes
 * accounts.
 * @no-permission-required - the link is the right to make an account in its tenant
 */
export async function acceptInvitationWithNewAccount(token: string, input: z.input<typeof AccountSchema>) {
    if (isEmailLoginDisabled()) return { success: false as const, error: "Sign in with a provider to accept the invitation." };
    const parsedToken = TokenSchema.safeParse(token);
    const parsed = AccountSchema.safeParse(input);
    if (!parsedToken.success) return { success: false as const, error: LINK_GONE };
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };

    try {
        const accepted = await invitationService.acceptWithNewAccount(parsedToken.data, parsed.data);
        await auditService.log(accepted.userId, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.USER, { name: parsed.data.name, email: accepted.email, via: "invitation" }, accepted.userId, { tenantId: accepted.tenantId });
        return { success: true as const, data: { tenantName: accepted.tenantName, email: accepted.email } };
    } catch (error: unknown) {
        if (!(error instanceof NotFoundError || error instanceof ValidationError || error instanceof ConflictError)) {
            log.error("Creating an account from an invitation failed", {}, wrapError(error));
        }
        return { success: false as const, error: messageOf(error, "The account could not be created.") };
    }
}
