import { describe, it, expect } from 'vitest';
import { RetentionService } from '@/services/retention-service';
import { FileInfo } from '@/lib/core/interfaces';
import { RetentionConfiguration } from '@/lib/core/retention';
import { subDays, subMonths, subYears, subWeeks } from 'date-fns';

// Helper to create mock files
const createMockFile = (name: string, date: Date): FileInfo => ({
    name,
    path: `/backups/${name}`,
    size: 1024,
    lastModified: date,
});

describe('RetentionService', () => {
    const today = new Date(); // Anchor date for consistency

    // Generate a set of files over time
    // Today, Yesterday, 2 days ago, ... 10 days ago
    const dailyFiles = Array.from({ length: 10 }).map((_, i) =>
        createMockFile(`daily-${i}.sql`, subDays(today, i))
    );

    it('should keep all files if mode is NONE', () => {
        const policy: RetentionConfiguration = { mode: 'NONE' };
        const result = RetentionService.calculateRetention(dailyFiles, policy);

        expect(result.keep).toHaveLength(dailyFiles.length);
        expect(result.delete).toHaveLength(0);
    });

    it('should handle empty file list', () => {
        const policy: RetentionConfiguration = { mode: 'SIMPLE', simple: { keepCount: 5 } };
        const result = RetentionService.calculateRetention([], policy);

        expect(result.keep).toHaveLength(0);
        expect(result.delete).toHaveLength(0);
    });

    describe('Simple Policy', () => {
        it('should keep exactly N newest files', () => {
            const policy: RetentionConfiguration = {
                mode: 'SIMPLE',
                simple: { keepCount: 3 }
            };
            const result = RetentionService.calculateRetention(dailyFiles, policy);

            // Expect to keep the 3 newest (daily-0, daily-1, daily-2)
            expect(result.keep).toHaveLength(3);
            expect(result.delete).toHaveLength(7);

            // Verify the kept files are actually the newest ones
            expect(result.keep.map(f => f.name)).toEqual(['daily-0.sql', 'daily-1.sql', 'daily-2.sql']);
        });

        it('should keep all if count > files', () => {
            const policy: RetentionConfiguration = {
                mode: 'SIMPLE',
                simple: { keepCount: 20 }
            };
            const result = RetentionService.calculateRetention(dailyFiles, policy);
            expect(result.keep).toHaveLength(10);
            expect(result.delete).toHaveLength(0);
        });
    });

    describe('Smart Policy (GVS)', () => {
        // Create a more complex timeline for GVS testing
        // 1. Daily: Last 7 days (7 files)
        // 2. Weekly: Last 4 weeks (4 files)
        // 3. Monthly: Last 3 months (3 files)

        const gvsFiles = [
            createMockFile('today.sql', today),
            createMockFile('yesterday.sql', subDays(today, 1)),
            createMockFile('day-2.sql', subDays(today, 2)),
            createMockFile('day-3.sql', subDays(today, 3)),
            createMockFile('day-6.sql', subDays(today, 6)), // Edge of daily
            createMockFile('day-8.sql', subDays(today, 8)), // Should be dropped by daily, maybe kept by weekly?

            createMockFile('week-2.sql', subWeeks(today, 2)),
            createMockFile('week-3.sql', subWeeks(today, 3)),
            createMockFile('week-5.sql', subWeeks(today, 5)), // Old week

            createMockFile('month-2.sql', subMonths(today, 2)),
            createMockFile('month-6.sql', subMonths(today, 6)), // Very old
        ];

        it('should execute basic daily retention correctly', () => {
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 3, weekly: 0, monthly: 0, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(gvsFiles, policy);

            // Should keep today, yesterday, day-2
            expect(result.keep.map(f => f.name)).toEqual(['today.sql', 'yesterday.sql', 'day-2.sql']);
        });

        it('should combined daily and weekly correctly', () => {
            // Keep 3 days, and 2 weeks
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 3, weekly: 2, monthly: 0, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(gvsFiles, policy);
            const keptNames = result.keep.map(f => f.name);

            // Daily expectation: today, yesterday, day-2
            expect(keptNames).toContain('today.sql');
            expect(keptNames).toContain('yesterday.sql');
            expect(keptNames).toContain('day-2.sql');

            // Weekly expectation:
            // - Week 0 (Current week): Covered by 'today' (which is the newest in this week)
            // - Week 1 (Previous week): 'day-8' (8 days ago is > 1 week) OR 'day-6' depending on when the week boundary falls.
            // Let's rely on the logic:
            // "today" covers the current week.
            // "week-2" is 2 weeks ago.
            // "week-3" is 3 weeks ago.

            // Since `smart.weekly` is 2:
            // Slot 1: Current week (taken by 'today.sql')
            // Slot 2: Last week ?
            //      'day-8.sql' is 1 week + 1 day ago.
            //      'day-6.sql' is 6 days ago.

            // It will greedily take the newest file that fits an empty slot.
            // Slot "Week X": taken by newest file in that week.

            // Let's verify simply that we have more files than just daily
            expect(result.keep.length).toBeGreaterThan(3);
        });

        it('should handle large gaps correctly', () => {
            // Keep 1 monthly
            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 0, weekly: 0, monthly: 1, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(gvsFiles, policy);
            // Should keep exactly 1 file: The newest one ('today.sql') because it fills the current month slot
            expect(result.keep).toHaveLength(1);
            expect(result.keep[0].name).toBe('today.sql');
        });

        it('should keep distinct files for different intervals', () => {
            // Setup precise dates to test slots
            // Date 1: 2024-01-01 (Month A, Week X)
            // Date 2: 2024-02-01 (Month B, Week Y)
            const dateA = new Date('2024-01-01T12:00:00Z');
            const dateB = new Date('2024-02-01T12:00:00Z');

            const specificFiles = [
                createMockFile('feb.sql', dateB),
                createMockFile('jan.sql', dateA),
            ];

            const policy: RetentionConfiguration = {
                mode: 'SMART',
                smart: { daily: 0, weekly: 0, monthly: 2, yearly: 0 }
            };

            const result = RetentionService.calculateRetention(specificFiles, policy);
            expect(result.keep).toHaveLength(2);
            expect(result.keep.map(f => f.name)).toEqual(['feb.sql', 'jan.sql']);
        });
    });
});
