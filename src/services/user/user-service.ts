import prisma from "@/lib/prisma";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { ValidationError } from "@/lib/logging/errors";
import { authService } from "@/services/auth/auth-service";
import { SUPER_ADMIN_GROUP } from "./users-model";

export const userService = {
  /**
   * Creates a user with their password and the group they start in. Better Auth signs a new user
   * in while creating them, on the server where no browser gets the session, so that session is
   * removed again instead of staying open until it runs out.
   */
  async createUser(data: { name: string; email: string; password: string; groupId: string | null }) {
    if (data.groupId && !(await prisma.group.findUnique({ where: { id: data.groupId }, select: { id: true } }))) {
      throw new ValidationError("The group no longer exists.");
    }
    const result = await authService.createUser(data);
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId: result.user.id } }),
      ...(data.groupId ? [prisma.user.update({ where: { id: result.user.id }, data: { groupId: data.groupId } })] : []),
    ]);
    return result.user;
  },

  /** Whether the group with this id is the SuperAdmin group, which only a SuperAdmin may give. */
  async isSuperAdminGroup(groupId: string | null) {
    if (!groupId || groupId === "none") return false;
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true } });
    return group?.name === SUPER_ADMIN_GROUP;
  },

  /** Whether the user is in the SuperAdmin group. */
  async isSuperAdmin(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { group: { select: { name: true } } } });
    return user?.group?.name === SUPER_ADMIN_GROUP;
  },

  /**
   * Moves users into a group, or into none. Each goes through `updateUserGroup`, so the last
   * SuperAdmin keeps the group.
   */
  async moveUsers(userIds: string[], groupId: string | null): Promise<BulkResult> {
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
    const names = new Map(users.map((user) => [user.id, user.name || user.email]));
    return runBulk(userIds, (id) => this.updateUserGroup(id, groupId ?? "none").then(() => undefined), (id) => names.get(id));
  },

  /** The users among these ids who are in the SuperAdmin group, with the name to report them by. */
  async superAdminsAmong(userIds: string[]) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, group: { name: SUPER_ADMIN_GROUP } },
      select: { id: true, name: true, email: true },
    });
    return users.map((user) => ({ id: user.id, name: user.name || user.email }));
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
   * Update a user's group.
   * Prevents removing the last SuperAdmin.
   */
  async updateUserGroup(userId: string, groupId: string | null) {
    const targetGroupId = groupId === "none" ? null : groupId;

    // Security check: Prevent removing the last SuperAdmin
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { group: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.group?.name === "SuperAdmin" && targetGroupId !== user.groupId) {
      const superAdminCount = await prisma.user.count({
        where: {
          group: {
            name: "SuperAdmin",
          },
        },
      });

      if (superAdminCount <= 1) {
        throw new Error("Cannot remove the last user from the SuperAdmin group.");
      }
    }

    return await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        groupId: targetGroupId,
      },
    });
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

  /**
   * Delete a user.
   * Prevents deleting the last SuperAdmin or the last user.
   */
  async deleteUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { group: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Check if user is the last SuperAdmin
    if (user.group?.name === "SuperAdmin") {
      const superAdminCount = await prisma.user.count({
        where: {
          group: {
            name: "SuperAdmin",
          },
        },
      });
      if (superAdminCount <= 1) {
        throw new Error("Cannot delete the last SuperAdmin user.");
      }
    }

    // Check if user is the last one
    const userCount = await prisma.user.count();
    if (userCount <= 1) {
      throw new Error("Cannot delete the last user.");
    }

    return await prisma.user.delete({
      where: {
        id: userId,
      },
    });
  },

  /**
   * Deletes several users, reporting per-user outcomes.
   *
   * Every user goes through `deleteUser`, so the last-SuperAdmin and last-user guards are
   * re-evaluated after each deletion rather than against the state the batch started in.
   * That is what keeps "delete everyone" from emptying the instance: the guard trips on
   * whoever is left, not on who was there when the request arrived.
   */
  async deleteUsers(userIds: string[]): Promise<BulkResult> {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const names = new Map(users.map((user) => [user.id, user.name || user.email]));

    return runBulk(userIds, (id) => this.deleteUser(id).then(() => undefined), (id) => names.get(id));
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
