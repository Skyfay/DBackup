
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performExecution } from '@/lib/runner';
import prisma from '@/lib/prisma';
import { registry } from '@/lib/core/registry';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mocks
vi.mock('@/lib/prisma', () => ({
    default: {
        job: { findUnique: vi.fn() },
        execution: {
            create: vi.fn(),
            update: vi.fn(),
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('@/lib/core/registry', () => ({
    registry: {
        get: vi.fn(),
        register: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
    }
}));

vi.mock('@/lib/queue-manager', () => ({
    processQueue: vi.fn().mockResolvedValue(undefined),
}));

// Mock Crypto (Assume simple pass-through)
vi.mock('@/lib/crypto', () => ({
    decryptConfig: vi.fn((c) => c),
}));

describe('Backup Pipeline Integration', () => {
    const jobId = 'test-job-id';
    const executionId = 'test-exec-id';

    // Create a real temp path
    const tempDir = os.tmpdir();
    let createdFiles: string[] = [];

    // Mock Adapters
    const mockDbAdapter = {
        type: 'database',
        dump: vi.fn().mockImplementation(async (config, destPath, log) => {
            log('Mock Dump Started');
            // Write a small dummy file
            fs.writeFileSync(destPath, 'DUMMY BACKUP CONTENT');
            createdFiles.push(destPath);
            return { success: true, path: destPath, size: 20 };
        }),
    };

    const mockStorageAdapter = {
        type: 'storage',
        upload: vi.fn().mockImplementation(async (config, filePath) => {
            if (!fs.existsSync(filePath)) throw new Error('File not found for upload');
            return { success: true, remotePath: '/remote/backup.sql' };
        }),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        createdFiles = [];

        // Setup Registry
        // @ts-ignore
        registry.get.mockImplementation((id) => {
            if (id === 'mock-db') return mockDbAdapter;
            if (id === 'mock-storage') return mockStorageAdapter;
            return null;
        });

        // Setup Prisma Data
        const mockJob = {
            id: jobId,
            name: 'Integration Test Job',
            source: { id: 's1', adapterId: 'mock-db', config: '{}', name: 'Mock Source', type: 'database' },
            destination: { id: 'd1', adapterId: 'mock-storage', config: '{}', name: 'Mock Dest', type: 'storage' },
            notifications: [],
            notificationEvents: 'ALWAYS'
        };

        const mockExecution = {
            id: executionId,
            jobId: jobId,
            status: 'Pending',
            logs: '[]',
            job: mockJob,
            startedAt: new Date()
        };

        // Prisma Mocks
        // @ts-ignore
        prisma.job.findUnique.mockResolvedValue(mockJob);
        // @ts-ignore
        prisma.execution.update.mockResolvedValue(mockExecution);
        // @ts-ignore
        prisma.execution.create.mockResolvedValue(mockExecution);
    });

    afterEach(() => {
        // Cleanup lingering real files
        createdFiles.forEach(f => {
            if (fs.existsSync(f)) {
                try { fs.unlinkSync(f); } catch {}
            }
        });
    });

    it('should run the full pipeline successfully', async () => {
        await performExecution(executionId, jobId);

        // 1. Verify Dump
        expect(mockDbAdapter.dump).toHaveBeenCalled();
        const dumpCall = mockDbAdapter.dump.mock.calls[0];
        const dumpPath = dumpCall[1];
        // Expect path to be in temp dir
        expect(dumpPath).toContain(tempDir);

        // 2. Verify Upload
        // Expect metadata + file upload
        expect(mockStorageAdapter.upload).toHaveBeenCalled();

        // Check successful status
        expect(prisma.execution.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: executionId },
            data: expect.objectContaining({ status: 'Success' })
        }));

        // 4. Verify Cleanup (File should be gone)
        expect(fs.existsSync(dumpPath)).toBe(false);
    });

    it('should handle dump failure gracefully', async () => {
        mockDbAdapter.dump.mockRejectedValueOnce(new Error('Dump Failed'));

        await performExecution(executionId, jobId);

        // Verify Status is Failed
        expect(prisma.execution.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: executionId },
            data: expect.objectContaining({ status: 'Failed' })
        }));
    });

    it('should handle main upload failure gracefully', async () => {
         // Mock upload to fail for .sql calls
         mockStorageAdapter.upload.mockImplementation(async (config: any, filePath: string) => {
             if (filePath.endsWith('.sql')) throw new Error('Main Upload Failed');
             return { success: true };
         });

         await performExecution(executionId, jobId);

         // Verify Status is Failed
         expect(prisma.execution.update).toHaveBeenCalledWith(expect.objectContaining({
             where: { id: executionId },
             data: expect.objectContaining({ status: 'Failed' })
         }));

        // Cleanup should still happen
        // We need to capture the file path from the dump call
        const dumpCall = mockDbAdapter.dump.mock.calls[0];
        const filePath = dumpCall[1];
        expect(fs.existsSync(filePath)).toBe(false);
    });
});
