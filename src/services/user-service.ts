import prisma from "@/lib/prisma";
import { User } from "@prisma/client";

export const userService = {
  /**
   * Get all users with their associated group.
   * ordered by creation date desc
   */
  async getUsers() {
    return await prisma.user.findMany({
      orderBy: {
        createdAt: "desc",
      },
      include: {
        group: true,
      },
    });
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
