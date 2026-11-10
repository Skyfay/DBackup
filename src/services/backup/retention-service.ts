import { FileInfo } from '@/lib/core/interfaces';
import { effectiveBackupTime, chainFolderOf } from '@/lib/core/backup-files';
import { RetentionConfiguration } from '@/lib/core/retention';
import { formatInTimeZone } from 'date-fns-tz';

type FileWithReasons = {
    file: FileInfo;
    keep: boolean;
    reasons: string[];
};

/** Marks a file the policy itself would have dropped, kept only to keep its chain intact. */
const CHAIN_KEEP_REASON = 'Part of a retained incremental chain';

export interface RetentionResult {
    keep: FileInfo[];
    delete: FileInfo[];
    /**
     * Subset of `keep` that the policy alone would have deleted - these survive only
     * because another snapshot of their chain is still needed. Reported so a destination
     * holding more backups than the policy says is explainable rather than surprising.
     */
    keptForChain: FileInfo[];
}

export class RetentionService {
    /**
     * Calculates which files to keep and which to delete based on the policy.
     * @param files List of backup files (metadata)
     * @param policy The retention policy configuration
     * @param timezone IANA timezone string used for day/week/month/year bucketing (defaults to 'UTC')
     * @returns The files to keep and to delete, plus the ones kept only because a chain
     *          they belong to is still needed - the reason a destination can hold more
     *          backups than the policy asks for, which is otherwise invisible.
     */
    static calculateRetention(files: FileInfo[], policy: RetentionConfiguration, timezone: string = 'UTC'): RetentionResult {
        if (!policy || policy.mode === 'NONE') {
            return { keep: files, delete: [], keptForChain: [] };
        }

        // Separate locked files (Always keep, do not count towards policy)
        const lockedFiles = files.filter(f => f.locked);
        const processingFiles = files.filter(f => !f.locked);

        // Sort files by date (newest first). Every tier below takes the first file it sees
        // in a bucket, so this ordering is what makes "keep the newest of each bucket" true.
        const sortedFiles = [...processingFiles].sort(
            (a, b) => effectiveBackupTime(b).getTime() - effectiveBackupTime(a).getTime()
        );

        const processedFiles: FileWithReasons[] = sortedFiles.map(f => ({ file: f, keep: false, reasons: [] }));

        if (policy.mode === 'SIMPLE' && policy.simple) {
            this.applySimplePolicy(processedFiles, policy.simple.keepCount);
        } else if (policy.mode === 'SMART' && policy.smart) {
            this.applySmartPolicy(processedFiles, policy.smart, timezone);
        } else {
            // The mode is neither NONE nor a mode with the settings it needs. Nothing marked
            // a file as kept, so falling through would delete every unlocked backup on the
            // destination. A policy we cannot read is a reason to keep, never to delete.
            return { keep: files, delete: [], keptForChain: [] };
        }

        // Incremental chains can only be deleted whole. A later snapshot references bytes
        // in earlier archives of its chain, so removing one member would silently gut the
        // others. GFS still evaluates individual snapshots - keepDaily 7 means 7 days, not
        // 7 chains - and a chain simply survives until every one of its snapshots expires.
        this.protectIncompleteChains(processedFiles, lockedFiles);

        const keptFromPolicy = processedFiles.filter(f => f.keep).map(f => f.file);
        const deletedFromPolicy = processedFiles.filter(f => !f.keep).map(f => f.file);
        const keptForChain = processedFiles
            .filter(f => f.reasons.includes(CHAIN_KEEP_REASON))
            .map(f => f.file);

        return {
            keep: [...keptFromPolicy, ...lockedFiles], // Add locked files to keep list
            delete: deletedFromPolicy,
            keptForChain,
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
        // The physical chain-* folder is authoritative even when a FULL sidecar is
        // unreadable. Flat legacy FULL backups must not become chain members.
        const keyOf = (file: FileInfo): string | null => {
            const folder = chainFolderOf(file.path);
            return folder ? `folder:${folder}` : file.chainId ? `id:${file.chainId}` : null;
        };
        const groups = new Map<string, { keep: boolean; unsafe: boolean; typed: boolean; full: boolean }>();
        for (const entry of [...files.map((item) => ({ file: item.file, keep: item.keep })),
                             ...lockedFiles.map((file) => ({ file, keep: true }))]) {
            const key = keyOf(entry.file);
            if (!key) continue;
            const group = groups.get(key) ?? { keep: false, unsafe: false, typed: false, full: false };
            group.keep ||= entry.keep;
            group.unsafe ||= entry.file.chainMetadataUnsafe === true;
            group.typed ||= entry.file.chainType !== undefined;
            group.full ||= entry.file.chainType === 'full';
            groups.set(key, group);
        }
        for (const group of groups.values()) {
            // If sidecars are readable but a chain has no FULL, preserve the orphaned
            // folder for operator recovery. Read-less adapters can still prune whole
            // folders: lack of a readable sidecar alone is not an infinite block.
            group.keep ||= group.unsafe || (group.typed && !group.full);
        }
        for (const entry of files) {
            const key = keyOf(entry.file);
            if (entry.keep || !key || !groups.get(key)?.keep) continue;
            entry.keep = true;
            entry.reasons.push(CHAIN_KEEP_REASON);
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
        // A policy written before the hourly tier existed has no value for it. 0 disables
        // the tier, which is what an absent value has to mean.
        const { hourly = 0, daily, weekly, monthly, yearly } = policy;

        // SMART/GFS is applied as non-overlapping tiers, finest first.
        // Hourly picks newest unique hours, then Daily picks newest unique days.
        // Weekly/Monthly/Yearly then pick additional representatives from older buckets.
        //
        // Every tier only counts what it adds itself, and buckets already covered by a
        // finer tier are skipped. The tiers are therefore additive rather than overlapping:
        // hourly 24 with daily 7 reaches back the roughly one day the 24 hourly slots span
        // plus 7 further days, not 7 days in total. restic and borg evaluate the same
        // numbers as a union instead, so the totals differ for an identical config.
        //
        // All buckets are computed in the configured timezone so that "day" aligns with
        // local midnight rather than UTC midnight. The cost is that the repeated hour of a
        // daylight saving change collapses into one hourly bucket once a year.
        this.applyTier(
            files,
            hourly,
            (date) => formatInTimeZone(date, timezone, 'yyyy-MM-dd-HH'),
            'Hourly'
        );

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
        // `!limit` catches an undefined limit, which is what a tier added after a policy was
        // written looks like. `undefined <= 0` is false in JavaScript, so the bare comparison
        // would let the tier run with no upper bound and keep one file per bucket forever.
        if (!limit || limit <= 0) return;

        const usedBuckets = new Set<string>();

        // Existing keeps from earlier tiers reserve their bucket in this tier.
        for (const entry of files) {
            if (!entry.keep) continue;
            usedBuckets.add(getBucketKey(effectiveBackupTime(entry.file)));
        }

        let keptInTier = 0;
        for (const entry of files) {
            if (entry.keep) continue;

            const bucketKey = getBucketKey(effectiveBackupTime(entry.file));
            if (usedBuckets.has(bucketKey)) continue;

            entry.keep = true;
            entry.reasons.push(`${reasonPrefix} (${bucketKey})`);
            usedBuckets.add(bucketKey);
            keptInTier++;

            if (keptInTier >= limit) break;
        }
    }
}
