import type { BackupMetadata } from "@/lib/core/interfaces";
import type { RichFileInfo } from "./storage-service";

/**
 * The listing fields that come from a backup's `.meta.json`, derived in one place.
 *
 * Two callers need them: the explorer, when it builds a listing from the sidecars it just read,
 * and the runner, which appends a row for a file it has only this moment uploaded rather than
 * making the next listing re-read the whole destination. Deriving them separately is what let
 * the two drift: the seekable (v2) archive keeps compression and encryption per entry under
 * `archive.*` and leaves the whole-file fields unset, and the runner's copy still read only the
 * latter - so every file backup was cached as uncompressed and unencrypted, and stayed that way,
 * because reconciliation only enriches files it has not seen before.
 */
export function describeBackupFromMetadata(
    fileName: string,
    sidecar: BackupMetadata
    // Everything a listing row holds except its identity, which the caller supplies from the
    // storage listing (or, for a fresh upload, from what it just wrote).
): Omit<RichFileInfo, "name" | "path" | "size" | "lastModified" | "storageClass"> {
    const isConfigBackup = sidecar.sourceType === "SYSTEM" || fileName.startsWith("config_backup_");

    let count = 0;
    let label = "Unknown";
    if (isConfigBackup) {
        count = 1;
        label = "System Config";
    } else {
        count = typeof sidecar.databases === 'object'
            ? (sidecar.databases as { count: number }).count
            : (typeof sidecar.databases === 'number' ? sidecar.databases : 0);
        if (sidecar.combined) {
            const { databases: dbCount, directorySources: dirCount } = sidecar.combined;
            count = dbCount;
            label = dbCount > 0
                ? `${dbCount} DB${dbCount === 1 ? '' : 's'} + ${dirCount} Dir${dirCount === 1 ? '' : 's'}`
                : `${dirCount} Directory Source${dirCount === 1 ? '' : 's'}`;
        } else {
            label = count === 0 ? "Unknown" : (count === 1 ? "Single DB" : `${count} DBs`);
        }
    }

    const names = Array.isArray(sidecar.databases) ? sidecar.databases : sidecar.databases?.names;

    return {
        ...(sidecar.jobId ? { jobId: sidecar.jobId } : {}),
        jobName: sidecar.jobName || (isConfigBackup ? "Config Backup" : undefined),
        ...(sidecar.timestamp ? { createdAt: sidecar.timestamp } : {}),
        ...(names && names.length > 0 ? { databases: names } : {}),
        sourceName: sidecar.sourceName || (isConfigBackup ? "System" : undefined),
        sourceType: sidecar.sourceType || (isConfigBackup ? "SYSTEM" : undefined),
        engineVersion: sidecar.engineVersion,
        engineEdition: sidecar.engineEdition,
        dbInfo: { count, label },
        isEncrypted: fileName.endsWith('.enc') || !!sidecar.encryption?.enabled || !!sidecar.archive?.encrypted,
        encryptionProfileId: sidecar.encryption?.profileId ?? sidecar.archive?.profileId,
        compression: sidecar.compression ?? sidecar.archive?.compression,
        locked: sidecar.locked ?? false,
        trigger: sidecar.trigger as { type: string; actor?: string } | undefined,
        checksum: sidecar.checksum,
        checksumMd5: sidecar.checksumMd5,
        hasFileIndex: sidecar.archive?.formatVersion === 2,
        // Backups written before this field existed are full by construction - incremental mode
        // did not exist yet.
        backupType: sidecar.backupType ?? sidecar.chain?.type ?? 'full',
        ...(sidecar.combined ? { combined: sidecar.combined } : {}),
        ...(sidecar.chain ? { chain: sidecar.chain } : {}),
        ...(typeof sidecar.logicalSize === 'number' ? { logicalSize: sidecar.logicalSize } : {}),
        verification: sidecar.verification ? {
            verifiedAt: sidecar.verification.verifiedAt,
            passed: sidecar.verification.passed,
            trigger: sidecar.verification.trigger,
        } : undefined,
    };
}
