
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RestoreService } from '@/services/restore-service';
import prisma from '@/lib/prisma';
import { registry } from '@/lib/core/registry';
import { compareVersions } from '@/lib/utils';

// Mocks
vi.mock('@/lib/prisma', () => ({
    default: {
        adapterConfig: {
            findUnique: vi.fn(),
        },
        execution: {
            create: vi.fn()
        }
    }
}));

// Mock adapters registration to prevent side effects
vi.mock('@/lib/adapters', () => ({
    registerAdapters: vi.fn(),
}));

vi.mock('@/lib/core/registry', () => ({
    registry: {
        get: vi.fn(),
        register: vi.fn(),
    }
}));

vi.mock('@/lib/crypto', () => ({
    decryptConfig: vi.fn((c) => c),
}));

vi.mock('@/lib/utils', () => ({
    compareVersions: vi.fn(),
    formatBytes: vi.fn(),
}));

vi.mock('@/services/encryption-service', () => ({
    getProfileMasterKey: vi.fn(),
}));

describe('Restore Service Safety Checks', () => {
    let service: RestoreService;
    let mockStorageAdapter: any;
    let mockTargetAdapter: any;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new RestoreService();

        mockStorageAdapter = {
            read: vi.fn(),
        };

        mockTargetAdapter = {
            test: vi.fn(),
            prepareRestore: vi.fn(),
        };

        // @ts-ignore
        registry.get.mockImplementation((id: string) => {
            if (id === 's3') return mockStorageAdapter;
            if (id === 'postgres') return mockTargetAdapter;
            return null;
        });

        // Default Prisma mocks
        // @ts-ignore
        prisma.adapterConfig.findUnique.mockImplementation(({ where }: any) => {
            if (where.id === 'storage-1') return { id: 'storage-1', adapterId: 's3', config: '{}', type: 'storage' };
            if (where.id === 'target-1') return { id: 'target-1', adapterId: 'postgres', config: '{}', type: 'database' };
            return null;
        });

        // Strategy: We mock prisma.execution.create to throw a specific error.
        // If the code reaches execution creation, it means all pre-flight checks passed.
        // If it throws "marker", we know it passed checks.
        // If it throws something else (like "Version mismatch"), it failed checks.
    });


    it('should throw error if backup version is newer than target server', async () => {
        // Mock Metadata
        mockStorageAdapter.read.mockResolvedValue(JSON.stringify({
            engineVersion: '15.0.0'
        }));

        // Mock Target Version
        mockTargetAdapter.test.mockResolvedValue({
            success: true,
            version: '14.0.0'
        });

        // Mock compareVersions logic: 15 > 14 returns 1
        // @ts-ignore
        compareVersions.mockReturnValue(1);

        await expect(service.restore({
            storageConfigId: 'storage-1',
            file: '/backup.sql',
            targetSourceId: 'target-1'
        })).rejects.toThrow(/newer database version/);

        // Ensure we didn't start execution
        expect(prisma.execution.create).not.toHaveBeenCalled();
    });

    it('should pass if backup version is older or equal', async () => {
        // Mock Metadata
        mockStorageAdapter.read.mockResolvedValue(JSON.stringify({
            engineVersion: '13.0.0'
        }));

        // Mock Target Version
        mockTargetAdapter.test.mockResolvedValue({
            success: true,
            version: '14.0.0'
        });

        // @ts-ignore
        compareVersions.mockReturnValue(-1);

        // Expect to reach execution creation
        // @ts-ignore
        prisma.execution.create.mockRejectedValue(new Error('PASSED_CHECKS'));

        await expect(service.restore({
            storageConfigId: 'storage-1',
            file: '/backup.sql',
            targetSourceId: 'target-1'
        })).rejects.toThrow('PASSED_CHECKS');
    });

    it('should skip check if metadata is missing', async () => {
        mockStorageAdapter.read.mockResolvedValue(null);

        // @ts-ignore
        prisma.execution.create.mockRejectedValue(new Error('PASSED_CHECKS'));

        await expect(service.restore({
             storageConfigId: 'storage-1',
             file: '/backup.sql',
             targetSourceId: 'target-1'
         })).rejects.toThrow('PASSED_CHECKS');
    });

    it('should fail if target adapter is not found', async () => {
        // @ts-ignore
        prisma.adapterConfig.findUnique.mockResolvedValue(null);

        await expect(service.restore({
            storageConfigId: 'storage-1',
            file: '/backup.sql',
            targetSourceId: 'invalid-id'
        })).rejects.toThrow('Target source not found');
    });
});
