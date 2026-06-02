import { describe, it, expect } from 'vitest';
import { RetentionService } from '@/services/backup/retention-service';
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

    describe('Realistic daily retention scenarios', () => {
        it('keeps all backups when count is within daily limit (5 days, daily=5)', () => {
            // Simulates a user running one backup per day for 5 days expecting all 5 to be kept
            const now = new Date('2026-06-05T10:00:00Z');
            const files = createMockFiles([
                now,
                subDays(now, 1),
                subDays(now, 2),
                subDays(now, 3),
                subDays(now, 4),
            ]);

            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 1, monthly: 1, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            expect(result.keep).toHaveLength(5);
            expect(result.delete).toHaveLength(0);
        });

        it('deletes only the oldest when 6th backup arrives with daily=5', () => {
            const now = new Date('2026-06-06T10:00:00Z');
            const files = createMockFiles([
                now,
                subDays(now, 1),
                subDays(now, 2),
                subDays(now, 3),
                subDays(now, 4),
                subDays(now, 5), // oldest → should be deleted
            ]);

            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 1, monthly: 1, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            expect(result.keep).toHaveLength(6); // 5 daily + 1 weekly (day 5 → older week)
            expect(result.delete).toHaveLength(0);
        });

        it('two backups on the same day: keeps only the newest as the daily representative', () => {
            // GFS design: one representative per calendar day
            const day = new Date('2026-06-05T00:00:00Z');
            const morning = new Date('2026-06-05T08:00:00Z');
            const evening = new Date('2026-06-05T20:00:00Z');

            const files = createMockFiles([evening, morning]);

            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 0, monthly: 0, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            expect(result.keep).toHaveLength(1);
            expect(result.keep[0].lastModified).toEqual(evening);
            expect(result.delete).toHaveLength(1);
            expect(result.delete[0].lastModified).toEqual(morning);
        });

        it('timezone: 23:30 local (UTC+2) counts as the correct local day', () => {
            // 2026-06-05 23:30 local (Europe/Berlin, UTC+2) = 2026-06-05 21:30 UTC
            // In UTC this is still June 5. In UTC+2 it's also June 5.
            // 2026-06-06 00:30 local (UTC+2) = 2026-06-05 22:30 UTC  ← same UTC day!
            // Without timezone awareness both would land in the same UTC day "2026-06-05"
            // and only 1 would be kept. With timezone awareness they are different local days.
            const day1 = new Date('2026-06-05T21:30:00Z'); // 2026-06-05 23:30 Europe/Berlin
            const day2 = new Date('2026-06-05T22:30:00Z'); // 2026-06-06 00:30 Europe/Berlin

            const files = createMockFiles([day2, day1]);

            const policyUTC: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 0, monthly: 0, yearly: 0 }
            };

            // In UTC both are on 2026-06-05 → same bucket → 1 kept
            const utcResult = RetentionService.calculateRetention(files, policyUTC, 'UTC');
            expect(utcResult.keep).toHaveLength(1);

            // In Europe/Berlin day1=June5, day2=June6 → different buckets → both kept
            const tzResult = RetentionService.calculateRetention(files, policyUTC, 'Europe/Berlin');
            expect(tzResult.keep).toHaveLength(2);
        });
    });

    describe('Smart Policy (GFS)', () => {
        it('keeps additional backups from older tiers instead of collapsing to the same newest file', () => {
            const now = new Date('2026-01-24T12:00:00Z');

            // Construct specific GFS scenarios rather than a loop
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

            // 2. Verify Weekly (older unique weeks are retained additionally)
            expect(result.keep.map(f => f.lastModified.getTime())).toContain(subWeeks(now, 2).getTime());
            expect(result.keep.map(f => f.lastModified.getTime())).toContain(subWeeks(now, 3).getTime());
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

            // 4. Verify the policy keeps multiple representatives across tiers
            expect(result.keep.length).toBeGreaterThan(7);
        });

        it('keeps weekly representatives from older weeks when daily slots are limited', () => {
            const now = new Date('2026-05-27T00:06:00Z');
            const files = createMockFiles(
                Array.from({ length: 14 }, (_, i) => subDays(now, i))
            );

            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 1, weekly: 1, monthly: 3, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy);

            // Daily keeps the newest day and weekly keeps an additional older week.
            expect(result.keep).toHaveLength(2);
            expect(result.keep.map(f => f.lastModified.getTime())).toContain(now.getTime());
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
