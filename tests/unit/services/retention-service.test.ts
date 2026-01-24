import { describe, it, expect } from 'vitest';
import { RetentionService } from '@/services/retention-service';
import { FileInfo } from '@/lib/core/interfaces';
import { RetentionConfiguration } from '@/lib/core/retention';
import { subDays, subWeeks, subMonths, subYears } from 'date-fns';

// Helper to generate mock files
const createMockFiles = (dates: Date[]): FileInfo[] => {
    return dates.map((date, index) => ({
        path: `/backups/backup-${index}.sql`,
        name: `backup-${index}.sql`,
        size: 1024,
        lastModified: date,
        logs: [],
        startedAt: date,
        completedAt: date,
        success: true,
        locked: false
    }));
};

describe('RetentionService', () => {

    describe('Simple Policy', () => {
        it('should keep the specified number of most recent files', () => {
            const now = new Date();
            const dates = [
                now,                        // Keep (1)
                subDays(now, 1),           // Keep (2)
                subDays(now, 2),           // Keep (3)
                subDays(now, 3),           // Delete
                subDays(now, 4)            // Delete
            ];
            const files = createMockFiles(dates);

            const policy: RetentionConfiguration = {
                mode: 'SIMPLE',
                simple: { keepCount: 3 }
            };

            const result = RetentionService.calculateRetention(files, policy);

            expect(result.keep).toHaveLength(3);
            expect(result.delete).toHaveLength(2);
            expect(result.delete.map(f => f.lastModified)).toContainEqual(dates[3]);
            expect(result.delete.map(f => f.lastModified)).toContainEqual(dates[4]);
        });

        it('should keep all files if count is greater than file count', () => {
            const files = createMockFiles([new Date(), subDays(new Date(), 1)]);
            const policy: RetentionConfiguration = {
                mode: 'SIMPLE',
                simple: { keepCount: 5 }
            };

            const result = RetentionService.calculateRetention(files, policy);

            expect(result.keep).toHaveLength(2);
            expect(result.delete).toHaveLength(0);
        });
    });

    describe('Locked Files', () => {
        it('should never delete locked files, even if they exceed policy', () => {
            const now = new Date();
            const dates = [
                now,
                subDays(now, 1),
                subDays(now, 2), // Older, normally would be kept as #3
                subDays(now, 10), // Very old, normally delete
            ];
            const files = createMockFiles(dates);

            // Lock the very old file
            files[3].locked = true;

            const policy: RetentionConfiguration = {
                mode: 'SIMPLE',
                simple: { keepCount: 2 }
            };

            const result = RetentionService.calculateRetention(files, policy);

            // Should keep 2 recent ones + 1 locked one = 3 total
            expect(result.keep).toHaveLength(3);

            // Check that the locked file is in the keep list
            const lockedFile = result.keep.find(f => f.locked);
            expect(lockedFile).toBeDefined();
            expect(lockedFile?.lastModified).toEqual(dates[3]);

            // The 3rd file (index 2) should be deleted because limit is 2, and locked file doesn't count towards limit usually?
            // Or does it? Implementing implies locked files are separate from "processingFiles".
            expect(result.delete).toHaveLength(1);
            expect(result.delete[0].lastModified).toEqual(dates[2]);
        });
    });

    describe('Smart Policy (GVS)', () => {
        it('should correctly handle daily, weekly, monthly, and yearly retention', () => {
            const now = new Date('2026-01-24T12:00:00Z');

            // Construct specific GVS scenarios rather than a loop
            const dates: Date[] = [
                // DAILY: Days 0-6 (7 backups)
                now,
                subDays(now, 1),
                subDays(now, 2),
                subDays(now, 3),
                subDays(now, 4),
                subDays(now, 5),
                subDays(now, 6),

                // WEEKLY: 4 weeks back
                subWeeks(now, 1),
                subWeeks(now, 2),
                subWeeks(now, 3),
                subWeeks(now, 4),

                // MONTHLY: 12 months back
                subMonths(now, 1),
                subMonths(now, 2),
                subMonths(now, 3),
                subMonths(now, 6),
                subMonths(now, 12),

                // YEARLY: 2 years back
                subYears(now, 1),
                subYears(now, 2),

                // NOISE: Some random old dates that should be deleted
                subDays(now, 8),   // Too old for daily, barely not weekly
                subMonths(now, 14), // Too old for monthly
                subYears(now, 3)    // Too old for yearly
            ];

            const files = createMockFiles(dates);

            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: {
                    daily: 7,
                    weekly: 4,
                    monthly: 6,  // Reduced from 12 to force strictness
                    yearly: 3    // Increased to 3 to allow 2026, 2025, 2024
                }
            };

            const result = RetentionService.calculateRetention(files, policy);

            // 1. Verify Daily (All last 7 days kept)
            for(let i=0; i<7; i++) {
                expect(result.keep.map(f => f.lastModified.getTime())).toContain(dates[i].getTime());
            }

            // 2. Verify Weekly (1-4 weeks back kept)
            // Note:
            // - Daily backups cover Jan 24 (W04) through Jan 18 (W03).
            // - W04 slot is taken by Jan 24 (Day 0).
            // - W03 slot is taken by Jan 18 (Day 6).
            // - Capacity is 4. So we have room for W02 and W01.

            // subWeeks(now, 1) is Jan 17 (W03). Superseded by Jan 18 (Day 6) which is newer.
            // subWeeks(now, 2) is Jan 10 (W02). Should be kept.
            // subWeeks(now, 3) is Jan 3 (W01). Should be kept.
            // subWeeks(now, 4) is Dec 27 (W52). Dropped because 4 slots (W04, W03, W02, W01) are full.

            expect(result.keep.map(f => f.lastModified.getTime())).toContain(subWeeks(now, 2).getTime());
            expect(result.keep.map(f => f.lastModified.getTime())).toContain(subWeeks(now, 3).getTime());

            // Verify subWeeks(now, 1) is NOT explicitly kept (it was superseded)
            expect(result.keep.map(f => f.lastModified.getTime())).not.toContain(subWeeks(now, 1).getTime());

            // 3. Verify Monthly
            // Slots:
            // 1. 2026-01 (Jan 24)
            // 2. 2025-12 (subMonths 1)
            // 3. 2025-11 (subMonths 2)
            // 4. 2025-10 (subMonths 3)
            // 5. 2025-07 (subMonths 6)
            // 6. 2025-01 (subMonths 12)
            expect(result.keep.map(f => f.lastModified.getTime())).toContain(subMonths(now, 6).getTime());
            expect(result.keep.map(f => f.lastModified.getTime())).toContain(subMonths(now, 12).getTime());

            // 4. Verify Yearly
            // Slots:
            // 1. 2026 (Jan 24)
            // 2. 2025 (subMonths 1 - Dec 24 is newest 2025 file)
            // 3. 2024 (subMonths 14 - Nov 24 is newest 2024 file)

            // subMonths(14) is Nov 2024. It takes the 2024 slot.
            expect(result.keep.map(f => f.lastModified.getTime())).toContain(subMonths(now, 14).getTime());

            // subYears(2) is Jan 2024. It is OLDER than Nov 2024. So it is dropped for the Yearly slot.
            // And Monthly slots (6) are full with 2025/2026 stuff.
            const deletedTimes = result.delete.map(f => f.lastModified.getTime());
            expect(deletedTimes).toContain(subYears(now, 2).getTime());

            // 5. Verify Deletions (Noise)
            // subYears(3) is 2023. Yearly capacity 3 (26, 25, 24). So 2023 is dropped.
            expect(deletedTimes).toContain(subYears(now, 3).getTime());
        });

        it('should prioritize keeping the newest backup when intervals overlap', () => {
            // If a backup satisfies both "Daily" and "Weekly", it should be kept once
            const now = new Date();
            const files = createMockFiles([now]);

            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 1, weekly: 1, monthly: 1, yearly: 1 }
            };

            const result = RetentionService.calculateRetention(files, policy);
            expect(result.keep).toHaveLength(1);
            expect(result.delete).toHaveLength(0);
        });
    });
});
