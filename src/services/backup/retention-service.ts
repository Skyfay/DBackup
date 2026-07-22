import { FileInfo } from '@/lib/core/interfaces';
import { RetentionConfiguration } from '@/lib/core/retention';
import { formatInTimeZone } from 'date-fns-tz';

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
     * @param timezone IANA timezone string used for day/week/month/year bucketing (defaults to 'UTC')
     * @returns Object with lists of file paths to keep and delete
     */
    static calculateRetention(files: FileInfo[], policy: RetentionConfiguration, timezone: string = 'UTC'): { keep: FileInfo[]; delete: FileInfo[] } {
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
            this.applySmartPolicy(processedFiles, policy.smart, timezone);
        }

        // Incremental chains can only be deleted whole. A later snapshot references bytes
        // in earlier archives of its chain, so removing one member would silently gut the
        // others. GFS still evaluates individual snapshots - keepDaily 7 means 7 days, not
        // 7 chains - and a chain simply survives until every one of its snapshots expires.
        this.protectIncompleteChains(processedFiles, lockedFiles);

        const keptFromPolicy = processedFiles.filter(f => f.keep).map(f => f.file);
        const deletedFromPolicy = processedFiles.filter(f => !f.keep).map(f => f.file);

        return {
            keep: [...keptFromPolicy, ...lockedFiles], // Add locked files to keep list
            delete: deletedFromPolicy
        };
    }

    /**
     * Promotes every member of a chain to "keep" when at least one of its snapshots is
     * being kept.
     *
     * The consequence is that slightly more is retained than the policy asks for: a chain
     * lingers until its newest member ages out. That is predictable and explainable, and
     * far preferable to the alternative, which is a retained snapshot whose data has been
     * partially deleted underneath it.
     */
    private static protectIncompleteChains(files: FileWithReasons[], lockedFiles: FileInfo[]) {
        const chainsToKeep = new Set<string>();

        for (const entry of files) {
            if (entry.keep && entry.file.chainId) chainsToKeep.add(entry.file.chainId);
        }
        // A locked backup pins its whole chain too, for the same reason.
        for (const locked of lockedFiles) {
            if (locked.chainId) chainsToKeep.add(locked.chainId);
        }

        for (const entry of files) {
            if (entry.keep || !entry.file.chainId) continue;
            if (!chainsToKeep.has(entry.file.chainId)) continue;
            entry.keep = true;
            entry.reasons.push('Part of a retained incremental chain');
        }
    }

    private static applySimplePolicy(files: FileWithReasons[], count: number) {
        for (let i = 0; i < files.length; i++) {
            if (i < count) {
                files[i].keep = true;
                files[i].reasons.push('Simple Count Limit');
            }
        }
    }

    private static applySmartPolicy(files: FileWithReasons[], policy: NonNullable<RetentionConfiguration['smart']>, timezone: string) {
        const { daily, weekly, monthly, yearly } = policy;

        // SMART/GFS is applied as non-overlapping tiers.
        // Daily picks newest unique days first.
        // Weekly/Monthly/Yearly then pick additional representatives from older buckets.
        // All buckets are computed in the configured timezone so that "day" aligns with
        // local midnight rather than UTC midnight.
        this.applyTier(
            files,
            daily,
            (date) => formatInTimeZone(date, timezone, 'yyyy-MM-dd'),
            'Daily'
        );

        this.applyTier(
            files,
            weekly,
            (date) => formatInTimeZone(date, timezone, "RRRR-'W'II"),
            'Weekly'
        );

        this.applyTier(
            files,
            monthly,
            (date) => formatInTimeZone(date, timezone, 'yyyy-MM'),
            'Monthly'
        );

        this.applyTier(
            files,
            yearly,
            (date) => formatInTimeZone(date, timezone, 'yyyy'),
            'Yearly'
        );
    }

    private static applyTier(
        files: FileWithReasons[],
        limit: number,
        getBucketKey: (date: Date) => string,
        reasonPrefix: string
    ) {
        if (limit <= 0) return;

        const usedBuckets = new Set<string>();

        // Existing keeps from earlier tiers reserve their bucket in this tier.
        for (const entry of files) {
            if (!entry.keep) continue;
            usedBuckets.add(getBucketKey(entry.file.lastModified));
        }

        let keptInTier = 0;
        for (const entry of files) {
            if (entry.keep) continue;

            const bucketKey = getBucketKey(entry.file.lastModified);
            if (usedBuckets.has(bucketKey)) continue;

            entry.keep = true;
            entry.reasons.push(`${reasonPrefix} (${bucketKey})`);
            usedBuckets.add(bucketKey);
            keptInTier++;

            if (keptInTier >= limit) break;
        }
    }
}
