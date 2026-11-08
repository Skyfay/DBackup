import { createHash, randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { roleRefusal } from "@/lib/auth/account-access";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { authService } from "@/services/auth/auth-service";
import { assertPasswordAllowed } from "@/services/auth/password-policy-service";
import { claimedEmailRefusal } from "@/services/sso/email-domain-claims";
import { countEmailRefusal, emailTriesSpent, MAX_FAILED_SIGN_UPS } from "@/services/user/email-tries";
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
/** The links one person may make within an hour, the used, spent and revoked ones included. */
export const INVITATIONS_PER_HOUR = 20;
export const INVITATIONS_PER_HOUR_REFUSAL = `You made ${INVITATIONS_PER_HOUR} invitations within the last hour. Try again later.`;

/**
 * The answer to an email that cannot get a new account through a link: one that has an account,
 * or whose domain the provider of another tenant claims. Whoever opens a link may be anyone, so it
 * never tells which, and it reads the same for every such email.
 */
export const INVITATION_EMAIL_REFUSED = "This email cannot get a new account through this invitation. If it has an account, sign in with it to accept the invitation, or pick another email.";
/** The answer once whoever made the link met too many emails that have an account, for every email. */
export const INVITATION_SIGN_UPS_PAUSED = "This invitation cannot make new accounts right now. Try again in an hour, or sign in with an account you have.";

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

/** Why the maker of a link cannot use it themselves. */
export const OWN_INVITATION = "You made this invitation, so it is for someone else. Another admin adds you to the tenant.";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * How often a link may fail to make an account before it is spent, so a link is no tool to try one
 * address after the other. An email that has an account also counts against whoever made the link,
 * across all of their links and every other place that sets an email, see `email-tries.ts`.
 */
export { MAX_FAILED_SIGN_UPS };

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
    /**
     * Makes a link for a group in a tenant. The token comes back once, only its hash stays. A tenant
     * has at most `OPEN_INVITATIONS_MAX` open links, and a person makes at most
     * `INVITATIONS_PER_HOUR` within an hour, so links that are spent or taken back make no more room.
     */
    async create(input: { tenantId: string; groupId: string; note?: string | null; days?: number; createdById: string; createdByName: string | null }) {
        const days = Math.min(Math.max(Math.round(input.days ?? INVITATION_DAYS), 1), INVITATION_MAX_DAYS);
        const made = await prisma.tenantInvitation.count({ where: { createdById: input.createdById, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
        if (made >= INVITATIONS_PER_HOUR) throw new ValidationError(INVITATIONS_PER_HOUR_REFUSAL);
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

    /**
     * Takes a link back before anyone used it. Only one of the tenant it was made for. `guard` sees
     * the group the link gives first and throws to keep the link. The row stays as a link that ran
     * out, so it still counts against `INVITATIONS_PER_HOUR` of whoever made it.
     */
    async revoke(id: string, tenantId: string, guard?: (group: { permissions: string; fullAccess: boolean }) => void): Promise<{ groupName: string; note: string | null }> {
        const now = new Date();
        const invitation = await prisma.tenantInvitation.findFirst({
            where: { id, tenantId, acceptedAt: null, expiresAt: { gt: now } },
            select: { note: true, group: { select: { name: true, permissions: true, fullAccess: true } } },
        });
        if (!invitation) throw new NotFoundError("Invitation", id);
        guard?.(invitation.group);
        await prisma.tenantInvitation.update({ where: { id }, data: { expiresAt: now } });
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
     * keeps the group they have, the link adds nobody twice. Whoever made the link, also through an
     * API key of theirs, cannot use it, since nobody gives themselves a group, see `OWN_MEMBERSHIP`.
     */
    async accept(token: string, userId: string): Promise<{ tenantId: string; tenantName: string; joined: boolean }> {
        const invitation = await openInvitation(token);
        if (!invitation) throw new NotFoundError("Invitation", "link");
        if (invitation.createdById === userId) throw new ValidationError(OWN_INVITATION);
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
     *
     * Whoever opens a link may be anyone, so an email that has an account gets the same sentence as
     * a claimed one, `INVITATION_EMAIL_REFUSED`, and counts against the tries of whoever made the
     * link like their own New user would (`email-tries.ts`). Once they ran out, the link makes no
     * account for an hour, whatever the email. The password is checked first, so a weak one never
     * tells a free email from a taken one.
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
        const name = account.name.trim();
        if (!name) throw new ValidationError("Enter your name.");
        // A platform admin sees every account, so their links count nothing, like their New user.
        const maker = invitation.createdById;
        const counts = maker !== null && !(await membershipService.isPlatformAdmin(maker));
        if (counts && emailTriesSpent(maker)) throw new ValidationError(INVITATION_SIGN_UPS_PAUSED);
        try {
            await assertPasswordAllowed(account.password, { name, email });
        } catch (error: unknown) {
            return refuse(error instanceof Error ? error : new Error(String(error)));
        }
        if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
            if (counts) countEmailRefusal(maker);
            return refuse(new ValidationError(INVITATION_EMAIL_REFUSED));
        }
        if (await claimedEmailRefusal(email, [invitation.tenantId], false)) return refuse(new ValidationError(INVITATION_EMAIL_REFUSED));

        const now = new Date();
        const { count } = await prisma.tenantInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } });
        if (count === 0) throw new NotFoundError("Invitation", "link");
        let created: Awaited<ReturnType<typeof authService.createUser>>;
        try {
            created = await authService.createUser({ name, email, password: account.password });
        } catch (error: unknown) {
            // No account came of it, so the link works again.
            await prisma.tenantInvitation.updateMany({ where: { id: invitation.id, acceptedById: null }, data: { acceptedAt: null } });
            // Taken meanwhile reads like taken before, never in the words of Better Auth.
            if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
                if (counts) countEmailRefusal(maker);
                return refuse(new ValidationError(INVITATION_EMAIL_REFUSED));
            }
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
