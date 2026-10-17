import prisma from "@/lib/prisma";
import { runAsTenant } from "@/lib/tenant/context";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { ValidationError } from "@/lib/logging/errors";
import { authService } from "@/services/auth/auth-service";
import { accountRefusal, type AccountActor, type AccountTarget } from "@/lib/auth/account-access";
import { EVERY_PERMISSION, PLATFORM_ADMIN_ROLE, permissionsIn } from "@/lib/auth/owner-permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { keepInTrash } from "@/services/trash/trash-snapshot";
import { claimedEmailRefusal } from "@/services/sso/email-domain-claims";
import { platformGroupService } from "./platform-group-service";
import type { DeleteOptions } from "@/services/trash/trash-types";

export const userService = {
  /**
   * Creates a user with their password and, with a group, their role in a tenant. Better Auth signs
   * a new user in while creating them, on the server where no browser gets the session, so that
   * session is removed again instead of staying open until it runs out.
   */
  async createUser(data: { name: string; email: string; password: string; groupId: string | null; tenantId: string }) {
    // An account of no tenant shows in the home tenant alone, so elsewhere it would vanish from the list it was made in.
    if (!data.groupId && data.tenantId !== HOME_TENANT_ID) throw new ValidationError("Pick the group the person works with in this tenant.");
    // A platform admin in All tenants names the tenant, which may be gone since the page loaded.
    if (!(await prisma.tenant.findUnique({ where: { id: data.tenantId }, select: { id: true } }))) throw new ValidationError("The tenant no longer exists.");
    // A group of that tenant only, looked up there whichever tenant the admin works in.
    if (data.groupId && !(await runAsTenant(data.tenantId, () => prisma.group.findUnique({ where: { id: data.groupId! }, select: { id: true } })))) {
      throw new ValidationError("The group no longer exists.");
    }
    const result = await authService.createUser(data);
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId: result.user.id } }),
      ...(data.groupId ? [prisma.tenantMembership.create({ data: { userId: result.user.id, tenantId: data.tenantId, groupId: data.groupId } })] : []),
    ]);
    return result.user;
  },

  /** The name of a user, which a run or a task they start records as who started it. */
  async nameOf(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name ?? null;
  },

  /** The names of users to report them by, the email for one without a name. */
  async namesOf(userIds: string[]): Promise<{ id: string; name: string }[]> {
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
    return users.map((user) => ({ id: user.id, name: user.name || user.email }));
  },

  /** Whether the user can sign in with a password, which SSO alone does not give. */
  async hasPassword(userId: string): Promise<boolean> {
    const account = await prisma.account.findFirst({ where: { userId, providerId: "credential" }, select: { id: true } });
    return account !== null;
  },

  /**
   * What an account may do in a tenant, as its session would there: every permission for a platform
   * admin, else what its group there and its platform group give. For a check made in a tenant
   * other than the one the account works in now, like New user of the list of every account.
   */
  async permissionsIn(userId: string, tenantId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        platformRole: true,
        memberships: { select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } } },
        platformGroup: { select: { platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } } },
      },
    });
    if (!user) return [];
    if (user.platformRole === PLATFORM_ADMIN_ROLE) return [...EVERY_PERMISSION];
    return permissionsIn(user.memberships, tenantId, user.platformGroup);
  },

  /** Whom an account belongs to, which decides who may change it, see `accountRefusal`. */
  async accountOf(userId: string): Promise<AccountTarget | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, platformGroupId: true, memberships: { select: { tenantId: true } } } });
    if (!user) return null;
    const platformGroup = user.platformGroupId ? (await platformGroupService.shapeOf(userId))?.shape ?? null : null;
    return { isPlatformAdmin: user.platformRole === PLATFORM_ADMIN_ROLE, tenantIds: user.memberships.map((membership) => membership.tenantId), platformGroup };
  },

  /**
   * Why someone may not change their own email to this one, null when they may: an email of a
   * domain the provider of a tenant they do not work in claims, see `claimedEmailRefusal`. The
   * people of the platform count as people of the home tenant.
   */
  async ownEmailRefusal(userId: string, email: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, platformGroupId: true, memberships: { select: { tenantId: true } } } });
    if (!user) return null;
    const tenantIds = user.memberships.map((membership) => membership.tenantId);
    if (user.platformGroupId || tenantIds.length === 0) tenantIds.push(HOME_TENANT_ID);
    return claimedEmailRefusal(email, tenantIds, user.platformRole === PLATFORM_ADMIN_ROLE);
  },

  /**
   * Why the caller may not change an account, its password, second factor, sessions, name, email
   * or the account itself, null when they may or the account is gone. See `accountRefusal`.
   */
  async accountRefusalFor(caller: AccountActor & { id: string }, userId: string): Promise<string | null> {
    const target = await this.accountOf(userId);
    if (!target) return null;
    // Only an account of a platform group needs the caller's own platform group to compare.
    const platformGroupShape = target.platformGroup && !caller.isPlatformAdmin ? (await platformGroupService.shapeOf(caller.id))?.shape ?? null : null;
    return accountRefusal({ ...caller, platformGroupShape }, target);
  },

  /** Ends one session of a user. False when the user holds no such session. */
  async revokeSession(userId: string, sessionId: string) {
    const { count } = await prisma.session.deleteMany({ where: { id: sessionId, userId } });
    return count > 0;
  },

  /**
   * Ends every session of a user but the one to keep, which is the viewer's own when someone
   * signs themselves out everywhere else. Returns how many ended.
   */
  async revokeSessions(userId: string, keepSessionId: string | null = null) {
    const { count } = await prisma.session.deleteMany({ where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) } });
    return count;
  },

  /**
   * Reset a user's two-factor authentication.
   */
  async resetTwoFactor(userId: string) {
    return await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          passkeyTwoFactor: false,
        },
      }),
      // Use deleteMany in case no record exists - safer than delete
      prisma.twoFactor.deleteMany({
        where: { userId },
      }),
    ]);
  },

  /** Deletes a user, who waits in Recently deleted unless `permanently`. Their sessions end either way. The last platform admin stays. */
  async deleteUser(userId: string, options: DeleteOptions = {}) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, platformRole: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.platformRole === PLATFORM_ADMIN_ROLE) {
      const platformAdmins = await prisma.user.count({ where: { platformRole: PLATFORM_ADMIN_ROLE } });
      if (platformAdmins <= 1) {
        throw new Error("Cannot delete the last platform admin.");
      }
    }

    // Check if user is the last one
    const userCount = await prisma.user.count();
    if (userCount <= 1) {
      throw new Error("Cannot delete the last user.");
    }

    return prisma.$transaction(async (tx) => {
      if (!options.permanently) await keepInTrash(tx, "user", userId, options.by);
      return tx.user.delete({ where: { id: userId } });
    });
  },

  /**
   * Deletes several users, reporting per-user outcomes.
   *
   * Every user goes through `deleteUser`, so the last-platform-admin and last-user guards are
   * re-evaluated after each deletion rather than against the state the batch started in.
   * That is what keeps "delete everyone" from emptying the instance: the guard trips on
   * whoever is left, not on who was there when the request arrived.
   */
  async deleteUsers(userIds: string[], options: DeleteOptions = {}): Promise<BulkResult> {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const names = new Map(users.map((user) => [user.id, user.name || user.email]));

    return runBulk(userIds, (id) => this.deleteUser(id, options).then(() => undefined), (id) => names.get(id));
  },

  /**
   * Toggle passkey two-factor authentication for a user.
   */
  async togglePasskeyTwoFactor(userId: string, enabled: boolean) {
    return await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        passkeyTwoFactor: enabled,
        twoFactorEnabled: enabled, // Force enable native 2FA flag to trigger 2FA flow
      },
    });
  },

  /**
   * Update user profile details.
   */
  async updateUser(
    userId: string,
    data: {
      name?: string;
      email?: string;
      timezone?: string;
      dateFormat?: string;
      timeFormat?: string;
    }
  ) {
    return await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        name: data.name,
        email: data.email,
        timezone: data.timezone,
        dateFormat: data.dateFormat,
        timeFormat: data.timeFormat,
      },
    });
  },
};
