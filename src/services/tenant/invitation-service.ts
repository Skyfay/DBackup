import { createHash, randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { roleRefusal } from "@/lib/auth/account-access";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/logging/errors";
import { authService } from "@/services/auth/auth-service";
import { claimedEmailRefusal } from "@/services/sso/email-domain-claims";
import { userService } from "@/services/user/user-service";
import { membershipService } from "./membership-service";

/**
 * Links that add someone to a tenant. A tenant admin hands one out with a group, and whoever opens
 * it joins with that group, with the account they have or a new one. The admin never types an
 * email, so a link never tells whether someone has an account here. Only the hash of a link is
 * kept, and it works once until it runs out.
 */

/** How long a link works unless the admin picks another time. */
export const INVITATION_DAYS = 7;
export const INVITATION_MAX_DAYS = 30;
/** The links a tenant may have open at once. Each one may try a few emails, see `MAX_FAILED_SIGN_UPS`. */
export const OPEN_INVITATIONS_MAX = 100;

export interface InvitationRow {
    id: string;
    group: { id: string; name: string };
    note: string | null;
    createdByName: string | null;
    createdAt: string;
    expiresAt: string;
}

/** What the page of a link shows before anyone joins. */
export interface InvitationPreview {
    tenantId: string;
    tenantName: string;
    groupName: string;
    expiresAt: string;
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * How often a link may fail to make an account before it is spent. A refusal says that an email
 * has an account here, so a link is no tool to try one address after the other.
 */
export const MAX_FAILED_SIGN_UPS = 5;

/** Failed account attempts per link, by the hash of its token, for this process. */
const FAILED_KEY = Symbol.for("dbackup.invitationFailures");
type FailuresGlobal = typeof globalThis & { [FAILED_KEY]?: Map<string, number> };
function failures(): Map<string, number> {
    const holder = globalThis as FailuresGlobal;
    holder[FAILED_KEY] ??= new Map();
    return holder[FAILED_KEY];
}

/**
 * The link that is still open, or null for one that is unknown, used or run out, which read the
 * same. A link works only while whoever made it may still give its group in its tenant, so a link
 * of an admin who lost the right, or left, stops working with it.
 */
async function openInvitation(token: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const invitation = await prisma.tenantInvitation.findUnique({
        where: { tokenHash: hashOf(token) },
        select: {
            id: true, tenantId: true, groupId: true, expiresAt: true, acceptedAt: true, createdById: true,
            tenant: { select: { name: true } },
            group: { select: { name: true, permissions: true, fullAccess: true } },
        },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() <= Date.now()) return null;
    if (!(await creatorMayGive(invitation))) return null;
    return invitation;
}

async function creatorMayGive(invitation: { tenantId: string; createdById: string | null; group: { permissions: string; fullAccess: boolean } }): Promise<boolean> {
    if (!invitation.createdById) return false;
    if (await membershipService.isPlatformAdmin(invitation.createdById)) return true;
    const permissions = await userService.permissionsIn(invitation.createdById, invitation.tenantId);
    return roleRefusal({ isPlatformAdmin: false, tenantId: invitation.tenantId, permissions }, invitation.group) === null;
}

export const invitationService = {
    /** Makes a link for a group in a tenant. The token comes back once, only its hash stays. */
    async create(input: { tenantId: string; groupId: string; note?: string | null; days?: number; createdById: string; createdByName: string | null }) {
        const days = Math.min(Math.max(Math.round(input.days ?? INVITATION_DAYS), 1), INVITATION_MAX_DAYS);
        const open = await prisma.tenantInvitation.count({ where: { tenantId: input.tenantId, acceptedAt: null, expiresAt: { gt: new Date() } } });
        if (open >= OPEN_INVITATIONS_MAX) throw new ValidationError(`The tenant has ${OPEN_INVITATIONS_MAX} open links. Take some back before you make another.`);
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + days * 86_400_000);
        const invitation = await prisma.tenantInvitation.create({
            data: {
                tenantId: input.tenantId,
                groupId: input.groupId,
                tokenHash: hashOf(token),
                note: input.note?.trim() || null,
                createdById: input.createdById,
                createdByName: input.createdByName,
                expiresAt,
            },
            select: { id: true },
        });
        return { id: invitation.id, token, expiresAt: expiresAt.toISOString() };
    },

    /** The links of a tenant nobody used yet and that still work, newest first. */
    async list(tenantId: string): Promise<InvitationRow[]> {
        const invitations = await prisma.tenantInvitation.findMany({
            where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
            select: { id: true, note: true, createdByName: true, createdAt: true, expiresAt: true, group: { select: { id: true, name: true } } },
        });
        return invitations.map((invitation) => ({
            ...invitation,
            createdAt: invitation.createdAt.toISOString(),
            expiresAt: invitation.expiresAt.toISOString(),
        }));
    },

    /** Takes a link back before anyone used it. Only one of the tenant it was made for. */
    async revoke(id: string, tenantId: string): Promise<{ groupName: string; note: string | null }> {
        const invitation = await prisma.tenantInvitation.findFirst({ where: { id, tenantId, acceptedAt: null }, select: { note: true, group: { select: { name: true } } } });
        if (!invitation) throw new NotFoundError("Invitation", id);
        await prisma.tenantInvitation.delete({ where: { id } });
        return { groupName: invitation.group.name, note: invitation.note };
    },

    async preview(token: string): Promise<InvitationPreview | null> {
        const invitation = await openInvitation(token);
        return invitation
            ? { tenantId: invitation.tenantId, tenantName: invitation.tenant.name, groupName: invitation.group.name, expiresAt: invitation.expiresAt.toISOString() }
            : null;
    },

    /**
     * Adds an account to the tenant of a link and uses the link up. Someone who is a member already
     * keeps the group they have, the link adds nobody twice.
     */
    async accept(token: string, userId: string): Promise<{ tenantId: string; tenantName: string; joined: boolean }> {
        const invitation = await openInvitation(token);
        if (!invitation) throw new NotFoundError("Invitation", "link");
        return prisma.$transaction(async (tx) => {
            // Used up in the same step as the join, so two tabs cannot both use one link.
            const now = new Date();
            const { count } = await tx.tenantInvitation.updateMany({
                where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: now } },
                data: { acceptedAt: now, acceptedById: userId },
            });
            if (count === 0) throw new NotFoundError("Invitation", "link");
            const existing = await tx.tenantMembership.findUnique({ where: { userId_tenantId: { userId, tenantId: invitation.tenantId } }, select: { groupId: true } });
            if (!existing) await tx.tenantMembership.create({ data: { userId, tenantId: invitation.tenantId, groupId: invitation.groupId } });
            return { tenantId: invitation.tenantId, tenantName: invitation.tenant.name, joined: !existing };
        });
    },

    /**
     * Creates an account from a link and adds it to the tenant. The password follows the rules of
     * Settings > Passwords. The person signs in on the login page afterwards. The link is used up
     * before the account is made, so two requests at once never make two accounts, and an email of
     * a domain the provider of another tenant claims is refused, see `claimedEmailRefusal`.
     */
    async acceptWithNewAccount(token: string, account: { name: string; email: string; password: string }) {
        const invitation = await openInvitation(token);
        if (!invitation) throw new NotFoundError("Invitation", "link");
        const key = hashOf(token);
        const refuse = async (error: Error): Promise<never> => {
            const failed = (failures().get(key) ?? 0) + 1;
            failures().set(key, failed);
            if (failed >= MAX_FAILED_SIGN_UPS) {
                // Spent, the admin makes a new one.
                await prisma.tenantInvitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date() } });
                failures().delete(key);
            }
            throw error;
        };

        const email = account.email.trim().toLowerCase();
        if (!account.name.trim()) throw new ValidationError("Enter your name.");
        if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
            return refuse(new ConflictError("An account with this email exists already. Sign in with it to accept the invitation."));
        }
        const claimed = await claimedEmailRefusal(email, [invitation.tenantId], false);
        if (claimed) return refuse(new ValidationError(claimed));

        const now = new Date();
        const { count } = await prisma.tenantInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } });
        if (count === 0) throw new NotFoundError("Invitation", "link");
        let created: Awaited<ReturnType<typeof authService.createUser>>;
        try {
            created = await authService.createUser({ name: account.name.trim(), email, password: account.password });
        } catch (error: unknown) {
            // No account came of it, so the link works again.
            await prisma.tenantInvitation.updateMany({ where: { id: invitation.id, acceptedById: null }, data: { acceptedAt: null } });
            return refuse(error instanceof Error ? error : new Error(String(error)));
        }
        failures().delete(key);
        // Better Auth signs a new account in on the server, where no browser gets the session.
        await prisma.session.deleteMany({ where: { userId: created.user.id } });
        await prisma.$transaction([
            prisma.tenantInvitation.update({ where: { id: invitation.id }, data: { acceptedById: created.user.id } }),
            prisma.tenantMembership.create({ data: { userId: created.user.id, tenantId: invitation.tenantId, groupId: invitation.groupId } }),
        ]);
        return { tenantId: invitation.tenantId, tenantName: invitation.tenant.name, joined: true, userId: created.user.id, email };
    },
};
