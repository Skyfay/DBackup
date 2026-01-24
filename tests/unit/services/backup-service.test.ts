import { describe, it, expect, vi, beforeEach } from 'vitest';
// import { prismaMock } from '@/lib/testing/prisma-mock';
import { BackupService } from '@/services/backup-service';
import { runJob } from '@/lib/runner';

// Mock the runner function since we don't want to actually execute a job in this service test
// We just want to check if the service orchestrates the call correctly.
vi.mock('@/lib/runner', () => ({
    runJob: vi.fn()
}));

describe('BackupService', () => {
    let service: BackupService;

    beforeEach(() => {
        service = new BackupService();
        vi.clearAllMocks();
    });

    it('should trigger job execution via runner', async () => {
        // Arrange
        const jobId = 'test-job-id';
        const expectedResult = { status: 'Success', logs: [] };

        // Mock the runner return value
        vi.mocked(runJob).mockResolvedValue(expectedResult as any);

        // Act
        const result = await service.executeJob(jobId);

        // Assert
        expect(runJob).toHaveBeenCalledWith(jobId);
        expect(runJob).toHaveBeenCalledTimes(1);
        expect(result).toBe(expectedResult);
    });
});
