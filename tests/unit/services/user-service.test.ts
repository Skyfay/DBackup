
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userService } from '@/services/user/user-service';
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
    $transaction: vi.fn((callback) => callback),
  },
}));

// prisma.$transaction([p1, p2]) returns Promise<[r1, r2]>
(prisma.$transaction as any).mockImplementation(async (promises: Promise<any>[]) => {
    return Promise.all(promises);
});

describe('User Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as any).mockImplementation(async (promises: Promise<any>[]) => {
      return Promise.all(promises);
    });
  });

  describe('updateUserGroup', () => {
    it('should update user group', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', group: { name: 'User' } });
      (prisma.user.update as any).mockResolvedValue({ id: '1', groupId: 'new-group' });

      await userService.updateUserGroup('1', 'new-group');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { groupId: 'new-group' },
      });
    });

    it('should map "none" groupId to null', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', group: { name: 'User' } });
      (prisma.user.update as any).mockResolvedValue({ id: '1', groupId: null });

      await userService.updateUserGroup('1', 'none');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { groupId: null },
      });
    });

    it('should throw when user is not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);

      await expect(userService.updateUserGroup('nonexistent', 'group-1')).rejects.toThrow('User not found');
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
      (prisma.user.count as any).mockResolvedValue(5);

      await userService.deleteUser('1');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw when user is not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);

      await expect(userService.deleteUser('nonexistent')).rejects.toThrow('User not found');
    });

    it('should prevent deleting last SuperAdmin', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', group: { name: 'SuperAdmin' } });
      (prisma.user.count as any).mockResolvedValue(1);

      await expect(userService.deleteUser('1')).rejects.toThrow('Cannot delete the last SuperAdmin user');
    });

    it('should prevent deleting last user in system', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', group: { name: 'User' } });
      (prisma.user.count as any).mockResolvedValue(1);

      await expect(userService.deleteUser('1')).rejects.toThrow('Cannot delete the last user');
    });

    it('should delete SuperAdmin user when other SuperAdmins exist', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', group: { name: 'SuperAdmin' } });
      (prisma.user.count as any)
        .mockResolvedValueOnce(2) // superAdminCount > 1
        .mockResolvedValueOnce(5); // total userCount > 1
      (prisma.user.delete as any).mockResolvedValue({ id: '1' });

      await userService.deleteUser('1');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });
  });

  describe('updateUser', () => {
    it('should update user profile fields', async () => {
      const updatedUser = { id: '1', name: 'New Name', email: 'new@example.com' };
      (prisma.user.update as any).mockResolvedValue(updatedUser);

      const result = await userService.updateUser('1', {
        name: 'New Name',
        email: 'new@example.com',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          name: 'New Name',
          email: 'new@example.com',
          timezone: undefined,
          dateFormat: undefined,
          timeFormat: undefined,
        },
      });
      expect(result).toEqual(updatedUser);
    });
  });
});
