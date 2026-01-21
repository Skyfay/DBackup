import { FileInfo } from '@/lib/core/interfaces';
import { RetentionConfiguration, RetentionMode } from '@/lib/core/retention';
import { format, getISOWeek, getYear, getMonth } from 'date-fns';

type FileWithReasons = {
    file: FileInfo;
    keep: boolean;
    reasons: string[];
};

export class RetentionService {
    /**
     * Calculates which files to keep and which to delete based on the policy.
     * @param files List of backup files (metadata)
     * @param policy The retention policy configuration
     * @returns Object with lists of file paths to keep and delete
     */
    static calculateRetention(files: FileInfo[], policy: RetentionConfiguration): { keep: FileInfo[]; delete: FileInfo[] } {
        if (!policy || policy.mode === 'NONE') {
            return { keep: files, delete: [] };
        }

        // Separate locked files (Always keep, do not count towards policy)
        const lockedFiles = files.filter(f => f.locked);
        const processingFiles = files.filter(f => !f.locked);

        // Sort files by date (newest first)
        const sortedFiles = [...processingFiles].sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

        const processedFiles: FileWithReasons[] = sortedFiles.map(f => ({ file: f, keep: false, reasons: [] }));

        if (policy.mode === 'SIMPLE' && policy.simple) {
            this.applySimplePolicy(processedFiles, policy.simple.keepCount);
        } else if (policy.mode === 'SMART' && policy.smart) {
            this.applySmartPolicy(processedFiles, policy.smart);
        }

        const keptFromPolicy = processedFiles.filter(f => f.keep).map(f => f.file);
        const deletedFromPolicy = processedFiles.filter(f => !f.keep).map(f => f.file);

        return {
            keep: [...keptFromPolicy, ...lockedFiles], // Add locked files to keep list
            delete: deletedFromPolicy
        };
    }

    private static applySimplePolicy(files: FileWithReasons[], count: number) {
        for (let i = 0; i < files.length; i++) {
            if (i < count) {
                files[i].keep = true;
                files[i].reasons.push('Simple Count Limit');
            }
        }
    }

    private static applySmartPolicy(files: FileWithReasons[], policy: NonNullable<RetentionConfiguration['smart']>) {
        const { daily, weekly, monthly, yearly } = policy;

        // Track used slots
        const usedDays = new Set<string>();
        const usedWeeks = new Set<string>();
        const usedMonths = new Set<string>();
        const usedYears = new Set<string>();

        for (const entry of files) {
            const date = entry.file.lastModified;

            // Keys based on local time or UTC? Ideally UTC strictly, but date-fns objects work well.
            // Using standard formats
            const dayKey = format(date, 'yyyy-MM-dd');
            const weekKey = `${getYear(date)}-W${getISOWeek(date)}`;
            const monthKey = format(date, 'yyyy-MM');
            const yearKey = format(date, 'yyyy');

            // 1. Daily Check
            if (usedDays.size < daily) {
                if (!usedDays.has(dayKey)) {
                    entry.keep = true;
                    entry.reasons.push(`Daily (${dayKey})`);
                    usedDays.add(dayKey);
                }
            }

            // 2. Weekly Check
            if (usedWeeks.size < weekly) {
                if (!usedWeeks.has(weekKey)) {
                    entry.keep = true;
                    entry.reasons.push(`Weekly (${weekKey})`);
                    usedWeeks.add(weekKey);
                }
            }

            // 3. Monthly Check
            if (usedMonths.size < monthly) {
                if (!usedMonths.has(monthKey)) {
                    entry.keep = true;
                    entry.reasons.push(`Monthly (${monthKey})`);
                    usedMonths.add(monthKey);
                }
            }

            // 4. Yearly Check
            if (usedYears.size < yearly) {
                if (!usedYears.has(yearKey)) {
                    entry.keep = true;
                    entry.reasons.push(`Yearly (${yearKey})`);
                    usedYears.add(yearKey);
                }
            }
        }
    }
}
