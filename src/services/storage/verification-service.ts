import { registry } from "@/lib/core/registry";
import { StorageAdapter, BackupMetadata } from "@/lib/core/interfaces";
import { calculateFileChecksum } from "@/lib/crypto/checksum";
import { privateTempPath } from "@/lib/private-temp-dir";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { ServiceError, wrapError } from "@/lib/logging/errors";
import { createConcurrencyGate } from "@/lib/concurrency";
import { reserveTempSpace } from "@/services/restore/temp-space";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { openDestination } from "@/services/sharing/destination-access";
import { readSidecarText } from "@/lib/adapters/storage/common/read-sidecar";

const log = logger.child({ service: "VerificationService" });

registerAdapters();

export type VerifyStatus = 'passed' | 'failed' | 'no_checksum' | 'no_metadata' | 'download_error' | 'skipped';

export interface FileVerificationResult {
    status: VerifyStatus;
    expectedChecksum?: string;
    actualChecksum?: string;
    verifiedAt: string;
    /** How the copy was checked, for a check that got that far. */
    method?: 'native' | 'download';
}

export interface VerifyOptions {
    skipIfPassed?: boolean;
    /** The size of the backup in bytes, where the caller knows it, so a download is promised its space first. */
    size?: number;
    /** Bytes of a download so far, for a copy that has to be downloaded to be hashed. */
    onProgress?: (processed: number, total: number) => void;
}

/**
 * Whether a destination of this adapter checks a copy by the checksum it keeps, without a
 * download. It can still fall back to a download when that checksum is missing for a file.
 */
export function checksNatively(adapterId: string): boolean {
    const adapter = registry.get(adapterId) as StorageAdapter | undefined;
    return typeof adapter?.verifyChecksum === "function";
}

/** The most checks that download a whole backup at once, in the process every tenant shares. */
export const WHOLE_DOWNLOADS_AT_ONCE = 2;

/** What a check reads that needs more temporary space than the server has free. */
export const VERIFY_SPACE_REFUSED = "This check downloads the whole backup, which needs more temporary space than the server has free. Ask the administrator of DBackup to free up space.";

const wholeDownloadGate = createConcurrencyGate(WHOLE_DOWNLOADS_AT_ONCE);

/**
 * Runs a check that downloads the whole backup into the temporary folder every tenant shares. At
 * most `WHOLE_DOWNLOADS_AT_ONCE` run at once and the others wait their turn, and a backup of a
 * known size is promised its space first like the staged entries of a restore (`reserveTempSpace`).
 */
async function wholeDownload<T>(size: number | undefined, check: () => Promise<T>): Promise<T> {
    return wholeDownloadGate(async () => {
        let space: Awaited<ReturnType<typeof reserveTempSpace>> | undefined;
        if (size !== undefined && Number.isFinite(size) && size > 0) {
            try {
                space = await reserveTempSpace([size], 1);
            } catch {
                throw new ServiceError("VerificationService", "tempSpace", VERIFY_SPACE_REFUSED);
            }
        }
        try {
            return await check();
        } finally {
            space?.release();
        }
    });
}

export class VerificationService {
    async verifyFile(
        adapterConfigId: string,
        remotePath: string,
        trigger: 'manual' | 'post-upload' | 'scheduled',
        options?: VerifyOptions
    ): Promise<FileVerificationResult> {
        const verifiedAt = new Date().toISOString();

        const { adapter, config } = await openDestination(adapterConfigId);

        // 1. Read .meta.json sidecar
        const metaPath = remotePath + ".meta.json";
        let metadata: BackupMetadata | null = null;

        try {
            // Bounded, see `readSidecarText`.
            const content = await readSidecarText(adapter, config, metaPath);
            if (content) metadata = JSON.parse(content) as BackupMetadata;
        } catch (e: unknown) {
            log.warn("Could not read metadata for verification", { remotePath }, wrapError(e));
        }

        if (!metadata) {
            return { status: 'no_metadata', verifiedAt };
        }

        if (!metadata.checksum && !metadata.checksumMd5) {
            return { status: 'no_checksum', verifiedAt };
        }

        if (options?.skipIfPassed && metadata.verification?.passed === true) {
            return { status: 'skipped', verifiedAt };
        }

        // 2. Try native adapter verification (no download needed for S3, local, GDrive, OneDrive)
        if (adapter.verifyChecksum) {
            try {
                const nativeResult = await adapter.verifyChecksum(config, remotePath, {
                    sha256: metadata.checksum,
                    md5: metadata.checksumMd5,
                });

                if (nativeResult !== 'unsupported') {
                    const passed = nativeResult === 'passed';
                    await this.writeVerificationResult(adapterConfigId, adapter, config, metaPath, metadata, {
                        verifiedAt,
                        passed,
                        trigger,
                        method: 'native',
                    });

                    if (passed) {
                        return { status: 'passed', expectedChecksum: metadata.checksum, verifiedAt, method: 'native' };
                    }

                    // Native check failed — compute actual checksum via download for diagnostics.
                    if (metadata.checksum) {
                        const expected = metadata.checksum;
                        const actual = await wholeDownload(options?.size, async () => {
                            // In the private folder, since a plain backup is the data of the databases.
                            const tempFile = await privateTempPath(`verify_${crypto.randomUUID()}_${path.basename(remotePath)}`);
                            try {
                                const downloadOk = await adapter.download(config, remotePath, tempFile, options?.onProgress);
                                return downloadOk ? await calculateFileChecksum(tempFile) : null;
                            } catch (e: unknown) {
                                log.warn("Could not compute actual checksum after native failure", { remotePath }, wrapError(e));
                                return null;
                            } finally {
                                await fs.unlink(tempFile).catch(() => {});
                            }
                        }).catch((e: unknown) => {
                            log.warn("Could not compute actual checksum after native failure", { remotePath }, wrapError(e));
                            return null;
                        });
                        if (actual) return { status: 'failed', expectedChecksum: expected, actualChecksum: actual, verifiedAt, method: 'native' };
                    }

                    return { status: 'failed', expectedChecksum: metadata.checksum, verifiedAt, method: 'native' };
                }
            } catch (e: unknown) {
                log.warn("Native checksum verification error, falling back to download", { remotePath }, wrapError(e));
            }
        }

        // 3. Fallback: download + compute SHA-256
        if (!metadata.checksum) {
            return { status: 'no_checksum', verifiedAt };
        }

        const read = metadata;
        const expected = metadata.checksum;
        return wholeDownload(options?.size, () => this.downloadAndHash(adapterConfigId, adapter, config, remotePath, metaPath, read, expected, trigger, verifiedAt, options));
    }

    /** The check by a download of the whole backup and its SHA-256, inside `wholeDownload`. */
    private async downloadAndHash(
        adapterConfigId: string,
        adapter: StorageAdapter,
        config: any,
        remotePath: string,
        metaPath: string,
        metadata: BackupMetadata,
        expected: string,
        trigger: 'manual' | 'post-upload' | 'scheduled',
        verifiedAt: string,
        options?: VerifyOptions
    ): Promise<FileVerificationResult> {
        // In the private folder, since a plain backup is the data of the databases.
        const tempFile = await privateTempPath(`verify_${crypto.randomUUID()}_${path.basename(remotePath)}`);
        try {
            const downloadOk = await adapter.download(config, remotePath, tempFile, options?.onProgress);
            if (!downloadOk) {
                return { status: 'download_error', verifiedAt, method: 'download' };
            }

            const actual = await calculateFileChecksum(tempFile);
            const passed = actual === expected;

            await this.writeVerificationResult(adapterConfigId, adapter, config, metaPath, metadata, {
                verifiedAt,
                passed,
                trigger,
                actualChecksum: passed ? undefined : actual,
                method: 'download',
            });

            return {
                status: passed ? 'passed' : 'failed',
                expectedChecksum: expected,
                actualChecksum: passed ? undefined : actual,
                verifiedAt,
                method: 'download',
            };
        } catch (e: unknown) {
            log.error("Download-based verification failed", { remotePath }, wrapError(e));
            return { status: 'download_error', verifiedAt, method: 'download' };
        } finally {
            await fs.unlink(tempFile).catch(() => {});
        }
    }

    private async writeVerificationResult(
        adapterConfigId: string,
        adapter: StorageAdapter,
        config: any,
        metaPath: string,
        metadata: BackupMetadata,
        verification: NonNullable<BackupMetadata['verification']>
    ) {
        metadata.verification = verification;
        // The metadata names the databases, so it goes into the private folder as well.
        const tempPath = await privateTempPath(`meta-verify-${crypto.randomUUID()}.json`);
        // The default mode, not `PRIVATE_FILE_MODE`, since an upload like rsync -a carries the mode of
        // the file to the destination, where the sidecar keeps the mode the backup run gave it. The
        // private folder keeps it from other users here.
        await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2), { flag: "wx" });
        try {
            await adapter.upload(config, tempPath, metaPath);
        } finally {
            await fs.unlink(tempPath).catch(() => {});
        }
        const backupPath = metaPath.replace(/\.meta\.json$/, "");
        import("@/services/storage/storage-service").then(({ storageService }) => {
            storageService.updateStorageListCacheEntry(adapterConfigId, backupPath, {
                verification: {
                    verifiedAt: verification.verifiedAt,
                    passed: verification.passed,
                    trigger: verification.trigger,
                    ...(verification.method ? { method: verification.method } : {}),
                },
            }).catch(() => {});
        });
    }
}

export const verificationService = new VerificationService();
