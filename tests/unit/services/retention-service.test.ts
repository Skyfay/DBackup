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

    // ─── Realistic GFS daily/weekly/monthly scenarios ────────────────────────────
    //
    // Fixed reference: Monday 2026-06-08 10:00 UTC  (= start of ISO week W24)
    //   W24: Mon Jun  8 … Sun Jun 14
    //   W23: Mon Jun  1 … Sun Jun  7
    //   W22: Mon May 25 … Sun May 31
    //   W21: Mon May 18 … Sun May 24
    //
    // subDays(MONDAY, N) gives a file from N days before that Monday.
    // ─────────────────────────────────────────────────────────────────────────────
    describe('Realistic daily retention scenarios', () => {
        const MONDAY = new Date('2026-06-08T10:00:00Z'); // Mon, W24

        it('daily=5: all 5 backups kept when history is exactly 5 days', () => {
            const files = createMockFiles(
                Array.from({ length: 5 }, (_, i) => subDays(MONDAY, i))
                // Jun 8, 7, 6, 5, 4  — all different days
            );
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 0, monthly: 0, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            expect(result.keep).toHaveLength(5);
            expect(result.delete).toHaveLength(0);
        });

        it('daily=5: on the 6th day the oldest backup is deleted', () => {
            // 6 backups (Jun 8 … Jun 3), all inside W23/W24, no older week available.
            // Daily keeps Jun 8,7,6,5,4. Jun 3 is deleted.
            const files = createMockFiles(
                Array.from({ length: 6 }, (_, i) => subDays(MONDAY, i))
            );
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 0, monthly: 0, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            const keptTimes   = result.keep.map(f => f.lastModified.getTime());
            const deletedTimes = result.delete.map(f => f.lastModified.getTime());

            expect(result.keep).toHaveLength(5);
            expect(result.delete).toHaveLength(1);
            // Jun 8-4 are kept
            for (let i = 0; i < 5; i++) {
                expect(keptTimes).toContain(subDays(MONDAY, i).getTime());
            }
            // Jun 3 (day 5) is deleted
            expect(deletedTimes).toContain(subDays(MONDAY, 5).getTime());
        });

        it('daily=5, weekly=1: backups older than daily window are saved as weekly representative', () => {
            // 9 backups: Jun 8 … May 31
            // Daily:  keeps Jun 8(W24), 7(W23), 6(W23), 5(W23), 4(W23)   → usedWeeks = {W24, W23}
            // Weekly: Jun 3,2,1 are also W23 → skipped
            //         May 31 is W22 → kept as weekly representative
            // Deleted: Jun 3, Jun 2, Jun 1
            const files = createMockFiles(
                Array.from({ length: 9 }, (_, i) => subDays(MONDAY, i))
            );
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 1, monthly: 0, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            const keptTimes    = result.keep.map(f => f.lastModified.getTime());
            const deletedTimes = result.delete.map(f => f.lastModified.getTime());

            expect(result.keep).toHaveLength(6);   // 5 daily + 1 weekly
            expect(result.delete).toHaveLength(3);

            expect(keptTimes).toContain(subDays(MONDAY, 8).getTime()); // May 31 (W22 weekly)
            expect(deletedTimes).toContain(subDays(MONDAY, 5).getTime()); // Jun 3 — W23 overflow
            expect(deletedTimes).toContain(subDays(MONDAY, 6).getTime()); // Jun 2 — W23 overflow
            expect(deletedTimes).toContain(subDays(MONDAY, 7).getTime()); // Jun 1 — W23 overflow
        });

        it('daily=5, weekly=2: fills two weekly slots from two distinct prior weeks', () => {
            // 16 backups: Jun 8 … May 24
            // Daily keeps Jun 8-4 (W24+W23). Weekly adds May 31 (W22) + May 24 (W21). 7 total.
            const files = createMockFiles(
                Array.from({ length: 16 }, (_, i) => subDays(MONDAY, i))
            );
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 2, monthly: 0, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            const keptTimes = result.keep.map(f => f.lastModified.getTime());

            expect(result.keep).toHaveLength(7);   // 5 daily + 2 weekly
            expect(result.delete).toHaveLength(9);

            expect(keptTimes).toContain(subDays(MONDAY, 8).getTime());  // May 31 (W22)
            expect(keptTimes).toContain(subDays(MONDAY, 15).getTime()); // May 24 (W21)
        });

        it('daily=3, weekly=1, monthly=1: monthly slot fills after daily+weekly exhausted', () => {
            // Backups from today going back 5 weeks into the previous month.
            // daily=3: Jun 8, 7, 6
            // weekly=1: oldest unique week not covered → end of May (W22)
            // monthly=1: oldest unique month not covered by any above → April representative
            const jun8  = MONDAY;
            const jun7  = subDays(MONDAY, 1);
            const jun6  = subDays(MONDAY, 2);
            const may31 = subDays(MONDAY, 8);  // W22, still May
            const may24 = subDays(MONDAY, 15); // W21, May
            const apr15 = new Date('2026-04-15T10:00:00Z'); // April — different month

            const files = createMockFiles([jun8, jun7, jun6, may31, may24, apr15]);
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 3, weekly: 1, monthly: 1, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            const keptTimes    = result.keep.map(f => f.lastModified.getTime());
            const deletedTimes = result.delete.map(f => f.lastModified.getTime());

            // Daily: Jun 8, 7, 6
            // Weekly: May 31 (W22, first file in a week not covered by daily)
            // Monthly: Apr 15 (first file in a month not covered by daily/weekly)
            // Deleted: May 24 (W21 — weekly limit already reached, month=May already used by May31)
            expect(result.keep).toHaveLength(5);
            expect(result.delete).toHaveLength(1);

            expect(keptTimes).toContain(jun8.getTime());
            expect(keptTimes).toContain(jun7.getTime());
            expect(keptTimes).toContain(jun6.getTime());
            expect(keptTimes).toContain(may31.getTime());
            expect(keptTimes).toContain(apr15.getTime());
            expect(deletedTimes).toContain(may24.getTime());
        });

        it('two backups on the same UTC day: keeps only the newest one', () => {
            const morning = new Date('2026-06-05T08:00:00Z');
            const evening = new Date('2026-06-05T20:00:00Z');
            const files = createMockFiles([evening, morning]);

            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 0, monthly: 0, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            expect(result.keep).toHaveLength(1);
            expect(result.keep[0].lastModified.getTime()).toBe(evening.getTime());
            expect(result.delete).toHaveLength(1);
            expect(result.delete[0].lastModified.getTime()).toBe(morning.getTime());
        });

        it('timezone: backup crossing midnight counts as the correct local day, not UTC day', () => {
            // 2026-06-05 22:30 UTC = 2026-06-06 00:30 Europe/Berlin (next local day)
            // 2026-06-05 21:30 UTC = 2026-06-05 23:30 Europe/Berlin (still Jun 5 locally)
            //
            // In UTC: both timestamps are on 2026-06-05 → same bucket → only 1 kept
            // In Europe/Berlin: Jun5 vs Jun6 → different buckets → both kept
            const jun5_local = new Date('2026-06-05T21:30:00Z'); // 23:30 Berlin, Jun 5
            const jun6_local = new Date('2026-06-05T22:30:00Z'); // 00:30 Berlin, Jun 6

            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 5, weekly: 0, monthly: 0, yearly: 0 }
            };

            // UTC bucketing — both appear as "2026-06-05" → 1 kept
            const utcResult = RetentionService.calculateRetention(
                createMockFiles([jun6_local, jun5_local]), policy, 'UTC'
            );
            expect(utcResult.keep).toHaveLength(1);
            expect(utcResult.delete).toHaveLength(1);

            // Berlin bucketing — Jun 5 and Jun 6 → 2 kept
            const tzResult = RetentionService.calculateRetention(
                createMockFiles([jun6_local, jun5_local]), policy, 'Europe/Berlin'
            );
            expect(tzResult.keep).toHaveLength(2);
            expect(tzResult.delete).toHaveLength(0);
        });
    });

    // ─── Yearly retention scenarios ───────────────────────────────────────────────
    describe('Yearly retention scenarios', () => {

        it('yearly=1: keeps the single most recent unique-year representative beyond daily', () => {
            // daily=1 keeps 2026-06-08. 2025 and 2024 are candidates for yearly.
            // yearly=1 → only 2025-12-15 is kept; 2024-12-15 is deleted.
            const files = createMockFiles([
                new Date('2026-06-08T10:00:00Z'), // daily
                new Date('2025-12-15T10:00:00Z'), // yearly slot 1
                new Date('2024-12-15T10:00:00Z'), // no slot left → deleted
            ]);
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 1, weekly: 0, monthly: 0, yearly: 1 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            expect(result.keep).toHaveLength(2);
            expect(result.delete).toHaveLength(1);

            const keptTimes    = result.keep.map(f => f.lastModified.getTime());
            const deletedTimes = result.delete.map(f => f.lastModified.getTime());

            expect(keptTimes).toContain(new Date('2026-06-08T10:00:00Z').getTime());
            expect(keptTimes).toContain(new Date('2025-12-15T10:00:00Z').getTime());
            expect(deletedTimes).toContain(new Date('2024-12-15T10:00:00Z').getTime());
        });

        it('yearly=2: keeps representatives from two distinct prior years', () => {
            // daily=1 covers 2026. yearly=2 → keeps 2025 and 2024. 2023 is deleted.
            const y2026 = new Date('2026-06-08T10:00:00Z');
            const y2025 = new Date('2025-12-15T10:00:00Z');
            const y2024 = new Date('2024-12-15T10:00:00Z');
            const y2023 = new Date('2023-12-15T10:00:00Z');

            const files = createMockFiles([y2026, y2025, y2024, y2023]);
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 1, weekly: 0, monthly: 0, yearly: 2 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            const keptTimes    = result.keep.map(f => f.lastModified.getTime());
            const deletedTimes = result.delete.map(f => f.lastModified.getTime());

            expect(result.keep).toHaveLength(3);
            expect(result.delete).toHaveLength(1);

            expect(keptTimes).toContain(y2026.getTime());
            expect(keptTimes).toContain(y2025.getTime());
            expect(keptTimes).toContain(y2024.getTime());
            expect(deletedTimes).toContain(y2023.getTime());
        });

        it('yearly=3, daily=0: keeps the 3 most recent unique-year representatives', () => {
            // No daily/weekly/monthly. Pure yearly retention.
            // 5 files from 5 different years → 3 kept (2026, 2025, 2024), 2 deleted (2023, 2022).
            const files = createMockFiles([
                new Date('2026-03-01T10:00:00Z'),
                new Date('2025-03-01T10:00:00Z'),
                new Date('2024-03-01T10:00:00Z'),
                new Date('2023-03-01T10:00:00Z'), // deleted
                new Date('2022-03-01T10:00:00Z'), // deleted
            ]);
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 0, weekly: 0, monthly: 0, yearly: 3 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            const keptTimes    = result.keep.map(f => f.lastModified.getTime());
            const deletedTimes = result.delete.map(f => f.lastModified.getTime());

            expect(result.keep).toHaveLength(3);
            expect(result.delete).toHaveLength(2);

            expect(keptTimes).toContain(new Date('2026-03-01T10:00:00Z').getTime());
            expect(keptTimes).toContain(new Date('2025-03-01T10:00:00Z').getTime());
            expect(keptTimes).toContain(new Date('2024-03-01T10:00:00Z').getTime());
            expect(deletedTimes).toContain(new Date('2023-03-01T10:00:00Z').getTime());
            expect(deletedTimes).toContain(new Date('2022-03-01T10:00:00Z').getTime());
        });

        it('yearly=1 with multiple backups in the same prior year: keeps only the newest of that year', () => {
            // daily=1 covers 2026. Of the two 2025 backups, only the newer one is the yearly representative.
            const y2026      = new Date('2026-06-08T10:00:00Z');
            const y2025_dec  = new Date('2025-12-15T10:00:00Z'); // newest of 2025 → kept
            const y2025_jan  = new Date('2025-01-10T10:00:00Z'); // older 2025    → deleted

            const files = createMockFiles([y2026, y2025_dec, y2025_jan]);
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 1, weekly: 0, monthly: 0, yearly: 1 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            const keptTimes    = result.keep.map(f => f.lastModified.getTime());
            const deletedTimes = result.delete.map(f => f.lastModified.getTime());

            expect(result.keep).toHaveLength(2);
            expect(result.delete).toHaveLength(1);

            expect(keptTimes).toContain(y2025_dec.getTime()); // newest 2025 = yearly rep
            expect(deletedTimes).toContain(y2025_jan.getTime()); // older 2025 = deleted
        });

        it('year boundary Dec 31 / Jan 1 are treated as different years', () => {
            const dec31 = new Date('2025-12-31T23:00:00Z'); // still 2025 in UTC
            const jan1  = new Date('2026-01-01T01:00:00Z'); // 2026 in UTC

            const files = createMockFiles([jan1, dec31]);
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 0, weekly: 0, monthly: 0, yearly: 2 }
            };

            const result = RetentionService.calculateRetention(files, policy, 'UTC');

            // Both are in different years → both kept
            expect(result.keep).toHaveLength(2);
            expect(result.delete).toHaveLength(0);
        });
    });

    // ─── Full GFS stack ───────────────────────────────────────────────────────────
    //
    // Reference: Monday 2026-06-08 10:00 UTC (ISO week W24)
    //
    // Policy: daily=5, weekly=4, monthly=3, yearly=2
    //
    // Tier resolution (newest-first):
    //
    //   DAILY (limit 5):  Jun 8 (W24), Jun 7 (W23), Jun 6 (W23), Jun 5 (W23), Jun 4 (W23)
    //   WEEKLY (limit 4): weeks already used = {W24, W23}
    //                     Jun 3 → W23 skip
    //                     May 31 → W22 ✓ (slot 1)
    //                     May 24 → W21 ✓ (slot 2)
    //                     May 17 → W20 ✓ (slot 3)
    //                     May 10 → W19 ✓ (slot 4)  ← limit reached
    //   MONTHLY (limit 3): months used = {2026-06, 2026-05}
    //                     Jun 3  → 2026-06 skip
    //                     May 3  → 2026-05 skip
    //                     Apr 15 → 2026-04 ✓ (slot 1)
    //                     Mar 15 → 2026-03 ✓ (slot 2)
    //                     Feb 15 → 2026-02 ✓ (slot 3) ← limit reached
    //   YEARLY (limit 2): years used = {2026}
    //                     Jun 3, May 3, Jan 15 → 2026 skip
    //                     Dec 2025 → 2025 ✓ (slot 1)
    //                     Dec 2024 → 2024 ✓ (slot 2) ← limit reached
    //
    //   DELETED: Jun 3 (W23 overflow), May 3 (W18 overflow), Jan 15 2026 (month overflow), Dec 2023 (year overflow)
    // ─────────────────────────────────────────────────────────────────────────────
    describe('Full GFS stack (daily=5, weekly=4, monthly=3, yearly=2)', () => {
        const MONDAY = new Date('2026-06-08T10:00:00Z');

        // ── Files that should be KEPT ──────────────────────────────────────────
        const dailyFiles = Array.from({ length: 5 }, (_, i) => subDays(MONDAY, i));
        // Jun 8, 7, 6, 5, 4

        const weeklyFiles = [
            subDays(MONDAY, 8),  // May 31 (W22)
            subDays(MONDAY, 15), // May 24 (W21)
            subDays(MONDAY, 22), // May 17 (W20)
            subDays(MONDAY, 29), // May 10 (W19)
        ];

        const monthlyFiles = [
            new Date('2026-04-15T10:00:00Z'), // April
            new Date('2026-03-15T10:00:00Z'), // March
            new Date('2026-02-15T10:00:00Z'), // February
        ];

        const yearlyFiles = [
            new Date('2025-12-15T10:00:00Z'), // 2025
            new Date('2024-12-15T10:00:00Z'), // 2024
        ];

        // ── Files that should be DELETED ──────────────────────────────────────
        const deletedFiles = [
            subDays(MONDAY, 5),              // Jun 3 — W23 overflow (daily limit reached)
            subDays(MONDAY, 36),             // May 3  — W18 overflow (weekly limit reached)
            new Date('2026-01-15T10:00:00Z'), // Jan 15 2026 — 4th month (monthly limit reached)
            new Date('2023-12-15T10:00:00Z'), // Dec 2023 — 3rd year (yearly limit reached)
        ];

        const allFiles = createMockFiles([
            ...dailyFiles,
            ...weeklyFiles,
            ...monthlyFiles,
            ...yearlyFiles,
            ...deletedFiles,
        ]);

        const policy: RetentionConfiguration = {
            mode: 'SMART',
            smart: { daily: 5, weekly: 4, monthly: 3, yearly: 2 }
        };

        let result: ReturnType<typeof RetentionService.calculateRetention>;

        // Run once, share across all assertions in this block
        it('keeps the correct total: 5+4+3+2 = 14 files', () => {
            result = RetentionService.calculateRetention(allFiles, policy, 'UTC');
            expect(result.keep).toHaveLength(14);
            expect(result.delete).toHaveLength(4);
        });

        it('daily tier: Jun 8–4 are all kept', () => {
            result = RetentionService.calculateRetention(allFiles, policy, 'UTC');
            const keptTimes = result.keep.map(f => f.lastModified.getTime());
            for (const d of dailyFiles) {
                expect(keptTimes).toContain(d.getTime());
            }
        });

        it('weekly tier: May 31, 24, 17, 10 are kept as weekly representatives', () => {
            result = RetentionService.calculateRetention(allFiles, policy, 'UTC');
            const keptTimes = result.keep.map(f => f.lastModified.getTime());
            for (const d of weeklyFiles) {
                expect(keptTimes).toContain(d.getTime());
            }
        });

        it('monthly tier: April, March, February representatives are kept', () => {
            result = RetentionService.calculateRetention(allFiles, policy, 'UTC');
            const keptTimes = result.keep.map(f => f.lastModified.getTime());
            for (const d of monthlyFiles) {
                expect(keptTimes).toContain(d.getTime());
            }
        });

        it('yearly tier: 2025 and 2024 representatives are kept', () => {
            result = RetentionService.calculateRetention(allFiles, policy, 'UTC');
            const keptTimes = result.keep.map(f => f.lastModified.getTime());
            for (const d of yearlyFiles) {
                expect(keptTimes).toContain(d.getTime());
            }
        });

        it('overflow files are deleted: Jun 3 (daily overflow), May 3 (weekly overflow), Jan 15 (monthly overflow), Dec 2023 (yearly overflow)', () => {
            result = RetentionService.calculateRetention(allFiles, policy, 'UTC');
            const deletedTimes = result.delete.map(f => f.lastModified.getTime());
            for (const d of deletedFiles) {
                expect(deletedTimes).toContain(d.getTime());
            }
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
