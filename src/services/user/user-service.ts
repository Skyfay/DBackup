import prisma from "@/lib/prisma";
import { runAsTenant } from "@/lib/tenant/context";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { ValidationError } from "@/lib/logging/errors";
import { authService } from "@/services/auth/auth-service";
import { accountRefusal, emailClaimScope, type AccountActor, type AccountTarget } from "@/lib/auth/account-access";
import { EVERY_PERMISSION, PLATFORM_ADMIN_ROLE, permissionsIn } from "@/lib/auth/owner-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { PlatformReach } from "@/lib/auth/platform-group-caps";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { keepInTrash } from "@/services/trash/trash-snapshot";
import { claimedEmailRefusal, foreignClaimsOf } from "@/services/sso/email-domain-claims";
import { platformGroupService } from "./platform-group-service";
import type { DeleteOptions } from "@/services/trash/trash-types";

/** Whether an authenticator app is the second factor of the account. better-auth counts its code as set up unless it waits for its first code. */
async function hasAuthenticatorApp(userId: string): Promise<boolean> {
  const app = await prisma.twoFactor.findUnique({ where: { userId }, select: { verified: true } });
  return !!app && app.verified !== false;
}

/**
 * The tenant an account of no tenant counts as one of when no platform role or group holds it: the
 * tenant other than the home tenant whose provider claims its email, null for the home tenant. See
 * `userService.accountOf`.
 */
async function placelessClaimOf(user: { id: string; email: string; platformRole: string | null; platformGroupId: string | null }): Promise<string | null> {
  if (user.platformRole || user.platformGroupId) return null;
  return (await foreignClaimsOf([user])).get(user.id) ?? null;
}

/** The tenants of an account for a claimed email, see `userService.emailTenantsOf`. */
function emailTenantsFrom(user: { platformGroupId: string | null; memberships: { tenantId: string }[] }): string[] {
  const tenantIds = user.memberships.map((membership) => membership.tenantId);
  if (user.platformGroupId || tenantIds.length === 0) tenantIds.push(HOME_TENANT_ID);
  return tenantIds;
}

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

  /**
   * Creates an account of the people of the MSP with its password and its platform group, the
   * built-in Platform admin or another one, and no tenant. Like `createUser`, the session Better Auth
   * opens while creating it is removed again.
   */
  async createPlatformUser(data: { name: string; email: string; password: string }, platform: { kind: "admin" } | { kind: "group"; id: string }) {
    if (platform.kind === "group" && !(await prisma.platformGroup.findUnique({ where: { id: platform.id }, select: { id: true } }))) {
      throw new ValidationError("The platform group no longer exists.");
    }
    const result = await authService.createUser(data);
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId: result.user.id } }),
      prisma.user.update({
        where: { id: result.user.id },
        data: platform.kind === "admin" ? { platformRole: PLATFORM_ADMIN_ROLE, platformGroupId: null } : { platformRole: null, platformGroupId: platform.id },
      }),
    ]);
    return result.user;
  },

  /** The name of a user, which a run or a task they start records as who started it. */
  async nameOf(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name ?? null;
  },

  /** The email an account signs in with, null once it is gone. */
  async emailOf(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return user?.email ?? null;
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

  /**
   * Whom an account belongs to and the group it holds in each tenant, which decide who may change it,
   * see `accountRefusal`. An account of no tenant counts as one of the home tenant, unless no platform
   * role or group holds it and the provider of another tenant claims its email: then it counts as one
   * of that tenant, since the person of the email would sign in there, so the admins of the home
   * tenant never set its password.
   */
  async accountOf(userId: string): Promise<AccountTarget | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, platformRole: true, platformGroupId: true, memberships: { select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } } } },
    });
    if (!user) return null;
    const platformGroup = user.platformGroupId ? (await platformGroupService.shapeOf(userId))?.shape ?? null : null;
    const claim = user.memberships.length === 0 ? await placelessClaimOf(user) : null;
    return {
      isPlatformAdmin: user.platformRole === PLATFORM_ADMIN_ROLE,
      tenantIds: claim ? [claim] : user.memberships.map((membership) => membership.tenantId),
      platformGroup,
      groups: user.memberships.flatMap((membership) => (membership.group ? [{ tenantId: membership.tenantId, group: membership.group }] : [])),
    };
  },

  /**
   * The tenant an account counts as one of once it works in no tenant: the one whose provider claims
   * its email when that is not the home tenant and no platform role or group holds it, else the home
   * tenant, see `accountOf`. Asked before a membership ends, see `membershipEndRefusal`.
   */
  async placelessTenantOf(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, platformRole: true, platformGroupId: true } });
    return (user ? await placelessClaimOf(user) : null) ?? HOME_TENANT_ID;
  },

  /**
   * Why someone may not change their own email to this one, null when they may: an email of a
   * domain the provider of a tenant they do not work in claims, see `claimedEmailRefusal`. The
   * people of the platform count as people of the home tenant. Whoever may give such an email to
   * others, a platform admin or someone with `platform-accounts:write` whose platform group reaches
   * the tenant that claims it, gives it to themselves too, see `emailClaimScope`.
   */
  async ownEmailRefusal(userId: string, email: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, platformGroupId: true, memberships: { select: { tenantId: true } } } });
    if (!user) return null;
    const isPlatformAdmin = user.platformRole === PLATFORM_ADMIN_ROLE;
    // The rights of the platform count from the home tenant, see `permissionsIn`.
    const permissions = isPlatformAdmin ? [] : await this.permissionsIn(userId, HOME_TENANT_ID);
    const scope = emailClaimScope({ isPlatformAdmin, permissions, reach: await this.accountsReachOf({ id: userId, isPlatformAdmin, permissions }) });
    return claimedEmailRefusal(email, [...emailTenantsFrom(user), ...scope.tenantIds], scope.platformLevel);
  },

  /**
   * The tenants whose sign-in providers may claim the email of an account, like `ownEmailRefusal`
   * reads them: the ones it works in, and the home tenant for an account of no tenant or of a
   * platform group. Never the tenant of whoever changes the account. None for an account that is gone.
   */
  async emailTenantsOf(userId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { platformGroupId: true, memberships: { select: { tenantId: true } } } });
    return user ? emailTenantsFrom(user) : [];
  },

  /**
   * Why the caller may not change an account, its password, second factor, sessions, name, email
   * or the account itself, null when they may or the account is gone. See `accountRefusal`, which
   * also weighs the group the account holds in each tenant against what the caller may there.
   */
  async accountRefusalFor(caller: AccountActor & { id: string }, userId: string): Promise<string | null> {
    const target = await this.accountOf(userId);
    if (!target) return null;
    // Only an account of a platform group needs the caller's own platform group to compare.
    const platformGroupShape = target.platformGroup && !caller.isPlatformAdmin ? (await platformGroupService.shapeOf(caller.id))?.shape ?? null : null;
    const permissionsByTenant = await this.permissionsByTenantFor(caller, target.groups ?? []);
    return accountRefusal({ ...caller, platformGroupShape, reach: caller.reach ?? (await this.accountsReachOf(caller)), permissionsByTenant }, target);
  },

  /**
   * What the caller may do in the tenants of these groups other than the one they work in now,
   * which caps the groups an account holds there, see `heldGroupBeyond`. Empty for a platform admin,
   * who passes that check anyway.
   */
  async permissionsByTenantFor(caller: { id: string; isPlatformAdmin: boolean; tenantId: string | null }, groups: readonly { tenantId: string }[]): Promise<Record<string, readonly string[]>> {
    const permissionsByTenant: Record<string, readonly string[]> = {};
    if (caller.isPlatformAdmin) return permissionsByTenant;
    for (const { tenantId } of groups) {
      if (tenantId !== caller.tenantId && !(tenantId in permissionsByTenant)) permissionsByTenant[tenantId] = await this.permissionsIn(caller.id, tenantId);
    }
    return permissionsByTenant;
  },

  /**
   * The tenants whose accounts the caller changes with the right to manage the accounts of the
   * platform, see `accountRefusal`: every tenant for a platform admin, the reach of their platform
   * group while they hold the right, none otherwise.
   */
  async accountsReachOf(caller: { id: string; isPlatformAdmin: boolean; permissions: readonly string[] }): Promise<PlatformReach> {
    if (caller.isPlatformAdmin) return "all";
    return caller.permissions.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE) ? platformGroupService.reachOf(caller.id) : [];
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
    // Read and counted in the transaction that deletes, so two platform admins who delete each
    // other at the same time never leave none, like `setPlatformAdmin`.
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, platformRole: true } });
      if (!user) throw new ValidationError("User not found");
      if (user.platformRole === PLATFORM_ADMIN_ROLE) {
        const otherAdmins = await tx.user.count({ where: { platformRole: PLATFORM_ADMIN_ROLE, id: { not: userId } } });
        if (otherAdmins === 0) throw new ValidationError("Cannot delete the last platform admin.");
      }
      if ((await tx.user.count({ where: { id: { not: userId } } })) === 0) throw new ValidationError("Cannot delete the last user.");
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
   * Switches whether a passkey counts as the second factor of an account. better-auth asks for a
   * second factor while `twoFactorEnabled` is set, so the switch sets it too. Switching the passkey
   * off leaves it set while an authenticator app is the second factor, which only someone who may
   * change the second factor turns off, never the switch of the passkeys.
   */
  async togglePasskeyTwoFactor(userId: string, enabled: boolean) {
    const keepsApp = enabled ? false : await hasAuthenticatorApp(userId);
    return await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        passkeyTwoFactor: enabled,
        twoFactorEnabled: enabled || keepsApp,
      },
    });
  },

  /** Whether an authenticator app is the second factor of the account, without which a passkey switched on starts one. */
  async hasAuthenticatorApp(userId: string): Promise<boolean> {
    return hasAuthenticatorApp(userId);
  },

  /**
   * Whether switching off the passkey as the second factor ends the second factor of the account:
   * it asks for one now and has no authenticator app to keep it, see `togglePasskeyTwoFactor`.
   */
  async passkeyOffEndsTwoFactor(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
    return !!user?.twoFactorEnabled && !(await hasAuthenticatorApp(userId));
  },

  /**
   * Update user profile details. A new email says who set it in `emailSetBy`: an email the person
   * picked themselves (`self`) vouches for nobody, so a sign-in provider no longer links the account
   * by it, one an admin set (`admin`) does, see `allowTenantSsoLink`. Left out, the flag stays.
   */
  async updateUser(
    userId: string,
    data: {
      name?: string;
      email?: string;
      timezone?: string;
      dateFormat?: string;
      timeFormat?: string;
    },
    emailSetBy?: "self" | "admin"
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
        ...(data.email !== undefined && emailSetBy ? { emailVerified: emailSetBy === "admin" } : {}),
      },
    });
  },
};
