"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, currentSessionId, getViewer, tenantRefusal } from "@/lib/auth/access-control";
import { isEmailLoginDisabled } from "@/lib/auth/env-flags";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ConflictError, NotFoundError, PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { invitationService, type InvitationPreview, type InvitationRow } from "@/services/tenant/invitation-service";
import { createInvitationAs, INVITATION_GONE, InviteSchema, invitationsOf, revokeInvitationAs } from "@/services/tenant/invitation-admin";
import { tenantService } from "@/services/tenant/tenant-service";

const log = logger.child({ action: "invitation" });

const IdSchema = z.string().min(1).max(200);
const TokenSchema = z.string().min(20).max(100);

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
    // A link adds someone to one tenant, All tenants only reads.
    if (!viewer.tenantId) return { success: false as const, error: tenantRefusal(viewer) ?? "Unauthorized" };
    const parsed = InviteSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };

    try {
        const invitation = await createInvitationAs({ id: viewer.id, name: viewer.name }, viewer, viewer.tenantId, parsed.data);
        revalidatePath("/dashboard/users");
        return { success: true as const, data: { id: invitation.id, path: invitation.path, expiresAt: invitation.expiresAt } };
    } catch (error: unknown) {
        if (error instanceof NotFoundError || error instanceof PermissionError || error instanceof ValidationError) return { success: false as const, error: error.message };
        log.error("Creating an invitation failed", {}, wrapError(error));
        return { success: false as const, error: "The invitation could not be created." };
    }
}

/** The open links of the caller's tenant. */
export async function listInvitations(): Promise<{ success: true; data: InvitationRow[] } | { success: false; error: string }> {
    const viewer = await checkPermission(PERMISSIONS.USERS.READ);
    if (!viewer.tenantId) return { success: false, error: tenantRefusal(viewer) ?? "Unauthorized" };
    return { success: true, data: await invitationsOf(viewer.tenantId) };
}

/** Takes back a link nobody used yet. */
export async function revokeInvitation(id: string) {
    const viewer = await checkPermission(PERMISSIONS.USERS.WRITE);
    if (!viewer.tenantId) return { success: false as const, error: tenantRefusal(viewer) ?? "Unauthorized" };
    const parsed = IdSchema.safeParse(id);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        await revokeInvitationAs({ id: viewer.id }, viewer.tenantId, parsed.data);
        revalidatePath("/dashboard/users");
        return { success: true as const };
    } catch (error: unknown) {
        if (error instanceof NotFoundError) return { success: false as const, error: INVITATION_GONE };
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
        // The tenant by its id too, so the page tells the other tabs of the browser about the switch.
        return { success: true as const, data: { tenantId: accepted.tenantId, tenantName: accepted.tenantName, joined: accepted.joined } };
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
