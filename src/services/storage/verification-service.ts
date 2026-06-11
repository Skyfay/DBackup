import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { StorageAdapter, BackupMetadata } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { calculateFileChecksum } from "@/lib/crypto/checksum";
import { getTempDir } from "@/lib/temp-dir";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

const log = logger.child({ service: "VerificationService" });

registerAdapters();

export type VerifyStatus = 'passed' | 'failed' | 'no_checksum' | 'no_metadata' | 'download_error' | 'skipped';

export interface FileVerificationResult {
    status: VerifyStatus;
    expectedChecksum?: string;
    actualChecksum?: string;
    verifiedAt: string;
}

export class VerificationService {
    async verifyFile(
        adapterConfigId: string,
        remotePath: string,
        trigger: 'manual' | 'post-upload' | 'scheduled',
        options?: { skipIfPassed?: boolean }
    ): Promise<FileVerificationResult> {
        const verifiedAt = new Date().toISOString();

        const adapterConfig = await prisma.adapterConfig.findUnique({ where: { id: adapterConfigId } });
        if (!adapterConfig) throw new Error("Storage configuration not found");

        const adapter = registry.get(adapterConfig.adapterId) as StorageAdapter;
        if (!adapter) throw new Error(`Adapter '${adapterConfig.adapterId}' not found`);

        const config = await resolveAdapterConfig(adapterConfig);

        // 1. Read .meta.json sidecar
        const metaPath = remotePath + ".meta.json";
        let metadata: BackupMetadata | null = null;

        try {
            if (adapter.read) {
                const content = await adapter.read(config, metaPath);
                if (content) metadata = JSON.parse(content) as BackupMetadata;
            }

            if (!metadata) {
                const tempMeta = path.join(getTempDir(), `verify_meta_${crypto.randomUUID()}.json`);
                try {
                    const ok = await adapter.download(config, metaPath, tempMeta);
                    if (ok) {
                        const content = await fs.readFile(tempMeta, 'utf-8');
                        metadata = JSON.parse(content) as BackupMetadata;
                    }
                } finally {
                    await fs.unlink(tempMeta).catch(() => {});
                }
            }
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
                    });
                    return { status: nativeResult, expectedChecksum: metadata.checksum, verifiedAt };
                }
            } catch (e: unknown) {
                log.warn("Native checksum verification error, falling back to download", { remotePath }, wrapError(e));
            }
        }

        // 3. Fallback: download + compute SHA-256
        if (!metadata.checksum) {
            return { status: 'no_checksum', verifiedAt };
        }

        const tempFile = path.join(getTempDir(), `verify_${crypto.randomUUID()}_${path.basename(remotePath)}`);
        try {
            const downloadOk = await adapter.download(config, remotePath, tempFile);
            if (!downloadOk) {
                return { status: 'download_error', verifiedAt };
            }

            const actual = await calculateFileChecksum(tempFile);
            const passed = actual === metadata.checksum;

            await this.writeVerificationResult(adapterConfigId, adapter, config, metaPath, metadata, {
                verifiedAt,
                passed,
                trigger,
                actualChecksum: passed ? undefined : actual,
            });

            return {
                status: passed ? 'passed' : 'failed',
                expectedChecksum: metadata.checksum,
                actualChecksum: passed ? undefined : actual,
                verifiedAt,
            };
        } catch (e: unknown) {
            log.error("Download-based verification failed", { remotePath }, wrapError(e));
            return { status: 'download_error', verifiedAt };
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
        const tempPath = path.join(getTempDir(), `meta-verify-${Date.now()}.json`);
        await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2));
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
                },
            }).catch(() => {});
        });
    }
}

export const verificationService = new VerificationService();
