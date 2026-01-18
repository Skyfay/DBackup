
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userService } from '@/services/user-service';
import prisma from '@/lib/prisma';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    twoFactor: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback), // Simple pass through usually, or array handling
  },
}));

// Mock transaction implementation for array inputs
// prisma.$transaction([p1, p2]) returns Promise<[r1, r2]>
(prisma.$transaction as any).mockImplementation(async (promises: Promise<any>[]) => {
    return Promise.all(promises);
});

describe('User Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resetTwoFactor', () => {
    it('should disable 2FA flags and delete twoFactor records', async () => {
      const userId = 'user-123';

      const mockUserUpdate = { id: userId, twoFactorEnabled: false };
      const mockDeleteMany = { count: 1 };

      (prisma.user.update as any).mockResolvedValue(mockUserUpdate);
      (prisma.twoFactor.deleteMany as any).mockResolvedValue(mockDeleteMany);

      await userService.resetTwoFactor(userId);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          passkeyTwoFactor: false,
        },
      });

      expect(prisma.twoFactor.deleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
    });
  });

  describe('togglePasskeyTwoFactor', () => {
    it('should enable passkey and generic 2FA when enabled is true', async () => {
        const userId = 'user-123';
        await userService.togglePasskeyTwoFactor(userId, true);

        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: userId },
            data: {
                passkeyTwoFactor: true,
                twoFactorEnabled: true,
            }
        });
    });

    it('should disable passkey and generic 2FA when enabled is false', async () => {
        const userId = 'user-123';
        await userService.togglePasskeyTwoFactor(userId, false);

        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: userId },
            data: {
                passkeyTwoFactor: false,
                twoFactorEnabled: false,
            }
        });
    });
  });

  describe('updateUserGroup', () => {
      it('should update user group', async () => {
          (prisma.user.findUnique as any).mockResolvedValue({ id: '1', group: { name: 'User' } });
          (prisma.user.update as any).mockResolvedValue({ id: '1', groupId: 'new-group' });

          await userService.updateUserGroup('1', 'new-group');

          expect(prisma.user.update).toHaveBeenCalledWith({
              where: { id: '1' },
              data: { groupId: 'new-group' }
          });
      });

      it('should prevent removing last SuperAdmin', async () => {
          (prisma.user.findUnique as any).mockResolvedValue({ id: '1', groupId: 'admin', group: { name: 'SuperAdmin' } });
          (prisma.user.count as any).mockResolvedValue(1);

          await expect(userService.updateUserGroup('1', 'other')).rejects.toThrow('Cannot remove the last user from the SuperAdmin group');
      });

      it('should allow removing SuperAdmin if others exist', async () => {
        (prisma.user.findUnique as any).mockResolvedValue({ id: '1', groupId: 'admin', group: { name: 'SuperAdmin' } });
        (prisma.user.count as any).mockResolvedValue(2);
        (prisma.user.update as any).mockResolvedValue({});

        await userService.updateUserGroup('1', 'other');
        expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
      it('should delete user if safe', async () => {
           (prisma.user.findUnique as any).mockResolvedValue({ id: '1', group: { name: 'User' } });
           (prisma.user.count as any).mockResolvedValue(5); // plenty of users

           await userService.deleteUser('1');

           expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: '1' } });
      });

      it('should prevent deleting last SuperAdmin', async () => {
        (prisma.user.findUnique as any).mockResolvedValue({ id: '1', group: { name: 'SuperAdmin' } });
        (prisma.user.count as any).mockResolvedValue(1); // will count superadmins

        await expect(userService.deleteUser('1')).rejects.toThrow('Cannot delete the last SuperAdmin user');
      });

      it('should prevent deleting last user in system', async () => {
        (prisma.user.findUnique as any).mockResolvedValue({ id: '1', group: { name: 'User' } });
        // The first count in the function is for SuperAdmin check - we need to handle that mock sequence or logic
        // If it's NOT superadmin, it skips the first count.

        // Logic: if not superadmin, checks total count.
        (prisma.user.count as any).mockResolvedValue(1); // total users

        await expect(userService.deleteUser('1')).rejects.toThrow('Cannot delete the last user');
      });
  });
});
