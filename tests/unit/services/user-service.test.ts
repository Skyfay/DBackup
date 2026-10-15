import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userService } from '@/services/user/user-service';
import { membershipService } from '@/services/tenant/membership-service';
import { NotFoundError } from '@/lib/logging/errors';
import { HOME_TENANT_ID } from '@/lib/tenant/home';
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
    group: {
      findUnique: vi.fn(),
    },
    tenantMembership: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    twoFactor: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback),
  },
}));

const trash = vi.hoisted(() => ({ keepInTrash: vi.fn(async () => 'trash-1') }));
vi.mock('@/services/trash/trash-snapshot', () => trash);

// prisma.$transaction([p1, p2]) returns Promise<[r1, r2]>, and a callback gets the client as its transaction.
const transaction = async (work: Promise<any>[] | ((tx: unknown) => unknown)) =>
  typeof work === 'function' ? work(prisma) : Promise.all(work);
(prisma.$transaction as any).mockImplementation(transaction);

/** A group as the membership service reads it. */
const role = (permissions: string[], fullAccess = false) => ({ permissions: JSON.stringify(permissions), fullAccess });
const MANAGERS = role(['users:read', 'users:write']);
const VIEWERS = role(['jobs:read']);
const FULL_ACCESS = role([], true);

/** Who changes a membership: the admin of a tenant, held by the guard, or a platform admin, who manages every tenant. */
const CUSTOMER_ADMIN = { platformAdmin: false };
const PLATFORM_ADMIN = { platformAdmin: true };

describe('User Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as any).mockImplementation(transaction);
  });

  // The group of a user is their role in a tenant, which the membership service sets.
  describe('membershipService.setRole', () => {
    beforeEach(() => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1' });
      (prisma.tenantMembership.findMany as any).mockResolvedValue([]);
    });

    it('should give the user the group in the tenant', async () => {
      (prisma.group.findUnique as any).mockResolvedValue(VIEWERS);
      (prisma.tenantMembership.findUnique as any).mockResolvedValue({ group: VIEWERS });

      await membershipService.setRole('1', 'tenant-a', 'new-group', CUSTOMER_ADMIN);

      expect(prisma.tenantMembership.upsert).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: '1', tenantId: 'tenant-a' } },
        create: { userId: '1', tenantId: 'tenant-a', groupId: 'new-group' },
        update: { groupId: 'new-group' },
      });
    });

    it('should end the membership in the tenant without a group', async () => {
      (prisma.tenantMembership.findUnique as any).mockResolvedValue({ group: VIEWERS });

      await membershipService.setRole('1', 'tenant-a', null, CUSTOMER_ADMIN);

      expect(prisma.tenantMembership.delete).toHaveBeenCalledWith({ where: { userId_tenantId: { userId: '1', tenantId: 'tenant-a' } } });
      expect(prisma.tenantMembership.upsert).not.toHaveBeenCalled();
    });

    it('should leave a user without a membership as they are when no group is picked', async () => {
      (prisma.tenantMembership.findUnique as any).mockResolvedValue(null);

      await membershipService.setRole('1', 'tenant-a', null, CUSTOMER_ADMIN);

      expect(prisma.tenantMembership.delete).not.toHaveBeenCalled();
      expect(prisma.tenantMembership.upsert).not.toHaveBeenCalled();
    });

    it('should throw when user is not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);
      (prisma.group.findUnique as any).mockResolvedValue(VIEWERS);
      (prisma.tenantMembership.findUnique as any).mockResolvedValue(null);

      await expect(membershipService.setRole('nonexistent', 'tenant-a', 'group-1', CUSTOMER_ADMIN)).rejects.toThrow(NotFoundError);
      expect(prisma.tenantMembership.upsert).not.toHaveBeenCalled();
    });

    it('should throw when the group no longer exists', async () => {
      (prisma.group.findUnique as any).mockResolvedValue(null);
      (prisma.tenantMembership.findUnique as any).mockResolvedValue(null);

      await expect(membershipService.setRole('1', 'tenant-a', 'gone', CUSTOMER_ADMIN)).rejects.toThrow('The group no longer exists.');
      expect(prisma.tenantMembership.upsert).not.toHaveBeenCalled();
    });

    it('should keep the last member who manages the members of a tenant when anyone but a platform admin changes it', async () => {
      (prisma.group.findUnique as any).mockResolvedValue(VIEWERS);
      (prisma.tenantMembership.findUnique as any).mockResolvedValue({ group: MANAGERS });
      // The others in the tenant only look.
      (prisma.tenantMembership.findMany as any).mockResolvedValue([{ group: VIEWERS }]);

      const refused = 'Nobody else manages the members of this tenant. Give someone that right first.';
      await expect(membershipService.setRole('1', 'tenant-a', 'viewers', CUSTOMER_ADMIN)).rejects.toThrow(refused);
      await expect(membershipService.setRole('1', 'tenant-a', null, CUSTOMER_ADMIN)).rejects.toThrow(refused);
      expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', userId: { not: '1' } } }));
      expect(prisma.tenantMembership.upsert).not.toHaveBeenCalled();
      expect(prisma.tenantMembership.delete).not.toHaveBeenCalled();
    });

    it('should count the full access group as managing the members', async () => {
      (prisma.group.findUnique as any).mockResolvedValue(VIEWERS);
      (prisma.tenantMembership.findUnique as any).mockResolvedValue({ group: FULL_ACCESS });

      await expect(membershipService.setRole('1', 'tenant-a', 'viewers', CUSTOMER_ADMIN)).rejects.toThrow('Nobody else manages the members of this tenant.');
      expect(prisma.tenantMembership.upsert).not.toHaveBeenCalled();
    });

    it('should let the last manager move to another group that manages the members too', async () => {
      (prisma.group.findUnique as any).mockResolvedValue(FULL_ACCESS);
      (prisma.tenantMembership.findUnique as any).mockResolvedValue({ group: MANAGERS });

      await membershipService.setRole('1', 'tenant-a', 'admins', CUSTOMER_ADMIN);

      expect(prisma.tenantMembership.findMany).not.toHaveBeenCalled();
      expect(prisma.tenantMembership.upsert).toHaveBeenCalled();
    });

    it('should let a platform admin take the last manager out of a tenant, since they manage every tenant', async () => {
      (prisma.group.findUnique as any).mockResolvedValue(VIEWERS);
      (prisma.tenantMembership.findUnique as any).mockResolvedValue({ group: MANAGERS });
      (prisma.tenantMembership.findMany as any).mockResolvedValue([{ group: VIEWERS }]);

      await membershipService.setRole('1', 'tenant-a', 'viewers', PLATFORM_ADMIN);

      expect(prisma.tenantMembership.findMany).not.toHaveBeenCalled();
      expect(prisma.tenantMembership.upsert).toHaveBeenCalled();
    });

    it('should let a platform admin leave a tenant with no members at all', async () => {
      // The platform admin is the last member, with full access, and leaves.
      (prisma.tenantMembership.findUnique as any).mockResolvedValue({ group: FULL_ACCESS });

      await membershipService.setRole('1', 'tenant-a', null, PLATFORM_ADMIN);

      expect(prisma.tenantMembership.delete).toHaveBeenCalledWith({ where: { userId_tenantId: { userId: '1', tenantId: 'tenant-a' } } });
    });

    it('should let a manager step down while someone else manages the members', async () => {
      (prisma.group.findUnique as any).mockResolvedValue(VIEWERS);
      (prisma.tenantMembership.findUnique as any).mockResolvedValue({ group: MANAGERS });
      (prisma.tenantMembership.findMany as any).mockResolvedValue([{ group: VIEWERS }, { group: FULL_ACCESS }]);

      await membershipService.setRole('1', 'tenant-a', 'viewers', CUSTOMER_ADMIN);

      expect(prisma.tenantMembership.upsert).toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('should delete user if safe, into Recently deleted', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', platformRole: null });
      (prisma.user.count as any).mockResolvedValue(5);

      await userService.deleteUser('1', { by: 'admin' });

      expect(trash.keepInTrash).toHaveBeenCalledWith(prisma, 'user', '1', 'admin');
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('skips Recently deleted for a user deleted permanently', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', platformRole: null });
      (prisma.user.count as any).mockResolvedValue(5);

      await userService.deleteUser('1', { permanently: true });

      expect(trash.keepInTrash).not.toHaveBeenCalled();
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw when user is not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);

      await expect(userService.deleteUser('nonexistent')).rejects.toThrow('User not found');
    });

    it('should prevent deleting last platform admin', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', platformRole: 'ADMIN' });
      (prisma.user.count as any).mockResolvedValue(1);

      await expect(userService.deleteUser('1')).rejects.toThrow('Cannot delete the last platform admin.');
      expect(prisma.user.count).toHaveBeenCalledWith({ where: { platformRole: 'ADMIN' } });
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('should prevent deleting last user in system', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', platformRole: null });
      (prisma.user.count as any).mockResolvedValue(1);

      await expect(userService.deleteUser('1')).rejects.toThrow('Cannot delete the last user');
    });

    it('should delete a platform admin when other platform admins exist', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', platformRole: 'ADMIN' });
      (prisma.user.count as any)
        .mockResolvedValueOnce(2) // platform admins > 1
        .mockResolvedValueOnce(5); // total userCount > 1
      (prisma.user.delete as any).mockResolvedValue({ id: '1' });

      await userService.deleteUser('1');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should never count a full access group as a platform admin', async () => {
      // Only platformRole makes a platform admin, the last holder of a full access group is just a user.
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1', platformRole: null, memberships: [{ tenantId: HOME_TENANT_ID, group: FULL_ACCESS }] });
      (prisma.user.count as any).mockResolvedValue(5);

      await userService.deleteUser('1');

      expect(prisma.user.count).not.toHaveBeenCalledWith({ where: { platformRole: 'ADMIN' } });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });
  });

  describe('membershipService.setPlatformAdmin', () => {
    it('should keep the last platform admin one', async () => {
      (prisma.user.count as any).mockResolvedValue(0);

      await expect(membershipService.setPlatformAdmin('1', false)).rejects.toThrow('The last platform admin stays one.');
      expect(prisma.user.count).toHaveBeenCalledWith({ where: { platformRole: 'ADMIN', id: { not: '1' } } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should take it back while another platform admin is left, and give it without asking in place of a platform group', async () => {
      (prisma.user.count as any).mockResolvedValue(1);

      await membershipService.setPlatformAdmin('1', false);
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: '1' }, data: { platformRole: null } });

      (prisma.user.count as any).mockClear();
      await membershipService.setPlatformAdmin('2', true);
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: '2' }, data: { platformRole: 'ADMIN', platformGroupId: null } });
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
