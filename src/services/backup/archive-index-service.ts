/**
 * Reads a seekable archive's index sidecar from a storage destination.
 *
 * The point of the sidecar is that browsing a backup must not cost a download of the
 * backup. It is a small file (a few MB even for very large trees) sitting next to the
 * archive, and it describes every database, directory source and file inside it.
 *
 * When the job is encrypted the sidecar is sealed too, because a cleartext file list next
 * to an encrypted archive would publish the table of contents: paths are usually the most
 * sensitive metadata in a backup, and a SHA-256 over plaintext is a confirmation oracle
 * against known files. The KDF salt and nonce prefix needed to open it are carried in the
 * `.meta.json`, which is why no part of the archive itself has to be read here.
 */

import fs from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { BackupMetadata, StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { getTempDir } from "@/lib/temp-dir";
import { deriveArchiveKeys } from "@/lib/crypto/kdf";
import { parseIndex } from "@/lib/archive/index-file";
import { readArchiveIndex, readArchiveManifest } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import { ArchiveIndex } from "@/lib/archive/types";
import { getProfileMasterKey } from "./encryption-service";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ service: "ArchiveIndexService" });

/** What the restore dialog needs to render its entry pickers. */
export interface ArchiveSummary {
    databases: string[];
    directories: {
        jobSourceId: string;
        label: string;
        fileCount: number;
        totalSize: number;
        excludePatterns: string[];
    }[];
    sourceType?: string;
}

export class ArchiveIndexService {
    /**
     * Loads and parses the index sidecar for one backup file.
     *
     * @param configId - Storage adapter config holding the backup
     * @param file - Remote path of the backup file, without the sidecar suffix
     * @param meta - The backup's already-read `.meta.json`
     * @returns The parsed index, or null when the sidecar is missing or unreadable
     */
    async load(configId: string, file: string, meta: BackupMetadata): Promise<ArchiveIndex | null> {
        if (meta.archive?.formatVersion !== 2) return null;

        const bytes = await this.fetchSidecar(configId, file, meta.archive.indexFile);
        if (!bytes) return null;

        try {
            if (!meta.archive.encrypted) return await parseIndex(bytes);

            if (!meta.archive.profileId || !meta.archive.kdfSalt || !meta.archive.noncePrefix) {
                throw new Error("Backup metadata is missing the crypto parameters needed to open the index");
            }
            const masterKey = await getProfileMasterKey(meta.archive.profileId);
            const { indexKey } = deriveArchiveKeys(masterKey, Buffer.from(meta.archive.kdfSalt, "hex"));
            return await parseIndex(bytes, {
                indexKey,
                noncePrefix: Buffer.from(meta.archive.noncePrefix, "hex"),
            });
        } catch (e: unknown) {
            log.warn("Failed to parse archive index sidecar", { configId, file }, wrapError(e));
            return null;
        }
    }

    /** Index reduced to what the restore dialog's entry pickers need. */
    async summarize(configId: string, file: string, meta: BackupMetadata): Promise<ArchiveSummary | null> {
        return this.toSummary(await this.load(configId, file, meta), meta);
    }

    /**
     * Same summary, read from an archive already on local disk.
     *
     * Every archive carries a copy of its index as its last member, so this is the
     * fallback for a missing or corrupt sidecar. It costs the download the sidecar exists
     * to avoid, which is why it is only ever reached after the sidecar has failed.
     */
    async summarizeFromArchive(archivePath: string, meta: BackupMetadata): Promise<ArchiveSummary | null> {
        try {
            const source = await localFileSource(archivePath);
            const manifest = await readArchiveManifest(source);
            const masterKey = manifest.encryption
                ? await getProfileMasterKey(manifest.encryption.profileId)
                : undefined;
            return this.toSummary(await readArchiveIndex(source, manifest, { masterKey }), meta);
        } catch (e: unknown) {
            log.warn("Failed to read the embedded archive index", { archivePath }, wrapError(e));
            return null;
        }
    }

    private toSummary(index: ArchiveIndex | null, meta: BackupMetadata): ArchiveSummary | null {
        if (!index) return null;

        return {
            databases: index.databases.map((d) => d.name),
            directories: index.directories.map((d) => ({
                jobSourceId: d.src,
                label: d.label,
                fileCount: d.fileCount,
                totalSize: d.totalSize,
                excludePatterns: d.excludePatterns,
            })),
            sourceType: meta.sourceType !== "directory-only" ? meta.sourceType : undefined,
        };
    }

    /**
     * Downloads the sidecar bytes to a temp file and reads them back.
     *
     * Deliberately not using the adapter's `read()` shortcut: it returns a string, and a
     * sealed index is binary, so any text decoding would silently corrupt it.
     */
    private async fetchSidecar(configId: string, file: string, suffix: string): Promise<Buffer | null> {
        const config = await prisma.adapterConfig.findUnique({ where: { id: configId } });
        if (!config || config.type !== "storage") return null;

        const adapter = registry.get(config.adapterId) as StorageAdapter | undefined;
        if (!adapter) return null;

        const resolved = await resolveAdapterConfig(config);
        const remotePath = file + suffix;

        let tempFile: string | null = null;
        try {
            tempFile = path.join(getTempDir(), `archive-index-${process.pid}-${path.basename(file)}${suffix}`);
            const downloaded = await adapter.download(resolved, remotePath, tempFile);
            if (!downloaded) return null;
            return await fs.readFile(tempFile);
        } catch (e: unknown) {
            log.warn("Failed to fetch archive index sidecar", { configId, remotePath }, wrapError(e));
            return null;
        } finally {
            if (tempFile) await fs.unlink(tempFile).catch(() => { });
        }
    }
}

export const archiveIndexService = new ArchiveIndexService();
