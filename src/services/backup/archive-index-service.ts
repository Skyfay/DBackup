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
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { BackupMetadata } from "@/lib/core/interfaces";
import { privateTempPath } from "@/lib/private-temp-dir";
import { READ_NO_FOLLOW } from "@/lib/server/no-follow";
import { deriveArchiveKeys } from "@/lib/crypto/kdf";
import { indexTextBytes, parseIndex } from "@/lib/archive/index-file";
import { browseLevel, BrowseEntry } from "@/lib/archive/browse";
import { parseArchiveIndex, readArchiveIndex, readArchiveManifest, readEmbeddedIndexBytes } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import { ArchiveIndex, DumpFormat } from "@/lib/archive/types";
import { archiveIndexVerifier, KeyOverride, resolveBackupKey } from "./key-resolution";
import { logger } from "@/lib/logging/logger";
import { EncryptionKeyRequiredError, wrapError } from "@/lib/logging/errors";
import { openDestination } from "@/services/sharing/destination-access";
import { currentTenantId } from "@/lib/tenant/current";
import { INDEX_SIDECAR_SUFFIX } from "@/lib/archive/format";
import { INDEX_MAX_STORED_BYTES } from "@/lib/archive/limits";
import { assertEncryptionKept, EncryptionDowngradeError } from "@/services/restore/recorded-encryption";
import { isFileTooLarge } from "@/lib/adapters/storage/common/read-limit";

const log = logger.child({ service: "ArchiveIndexService" });

/** What the restore dialog needs to render its entry pickers. */
export interface ArchiveSummary {
    databases: string[];
    /** The same databases with what a download dialog shows next to each name. */
    databaseDetails: { name: string; format: DumpFormat; size: number }[];
    directories: {
        jobSourceId: string;
        label: string;
        fileCount: number;
        totalSize: number;
        excludePatterns: string[];
        /**
         * Where this source was collected from, when its JobSource still exists. Powers
         * the "Original location" quick-fill in the restore dialog.
         */
        origin?: { configId: string; configName: string; path: string };
    }[];
    sourceType?: string;
    encrypted?: boolean;
    /** Incremental chain membership, so the dialog can explain multi-archive reads. */
    chain?: { type: 'full' | 'incremental'; index: number; deps: string[] };
}

/**
 * How long a parsed index stays cached. Browsing a tree fires one request per expanded
 * folder, and re-fetching plus re-decrypting the sidecar for each of them would make the
 * UI crawl. Short enough that a deleted or replaced backup is not served for long.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Cap on cached indexes, so browsing many large backups cannot grow without bound. */
const CACHE_MAX_ENTRIES = 8;

/**
 * Cap on the NDJSON the cached indexes inflated to, all of them together, since eight indexes of
 * the largest size an index may have would hold gigabytes in the process every tenant shares. About
 * a million and a half files of a usual index. An index larger than this alone is handed to the
 * callers that wait for it and then dropped, so the next read of it opens the sidecar again. The
 * text is a fair weight because `parseIndex` keeps only strings, numbers, flags and short lists of
 * strings on a line, never an object or a list of them, see `knownLineFields`.
 */
export const CACHE_MAX_TEXT_BYTES = 256 * 1024 * 1024;

export class ArchiveIndexService {
    /**
     * Caches the in-flight read, not just its result. The restore page asks for the same
     * index several times at once (one file tree per directory source, plus the dry run),
     * and caching only finished reads let all of them download and decrypt the sidecar
     * separately - including logging the same failure once per caller. `bytes` is the NDJSON
     * the index inflated to, set once the read finished.
     */
    private cache = new Map<string, { index: Promise<ArchiveIndex | null>; expiresAt: number; bytes?: number }>();

    /** @param maxCachedTextBytes - The cap on what the cached indexes hold, `CACHE_MAX_TEXT_BYTES` unless a test sets one */
    constructor(private readonly maxCachedTextBytes: number = CACHE_MAX_TEXT_BYTES) { }

    /**
     * Loads and parses the index sidecar for one backup file.
     *
     * @param configId - Storage adapter config holding the backup
     * @param file - Remote path of the backup file, without the sidecar suffix
     * @param meta - The backup's already-read `.meta.json`
     * @param override - A key from the recovery dialog, when the vault has none that fits
     * @returns The parsed index, or null when the sidecar is missing or unreadable
     * @throws EncryptionKeyRequiredError when the sidecar is readable but no key opens it
     */
    async load(
        configId: string,
        file: string,
        meta: BackupMetadata,
        override?: KeyOverride
    ): Promise<ArchiveIndex | null> {
        if (meta.archive?.formatVersion !== 2) return null;

        // A recovery attempt neither reads nor writes the cache: it carries a key nobody
        // else supplied, so its result is not the one a plain caller asked for.
        if (override) return this.read(configId, file, meta.archive, override, meta.jobId);

        // A shared destination holds a path once per tenant, so the tenant is part of the key.
        const cacheKey = `${configId}::${(await currentTenantId()) ?? "*"}::${file}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.index;

        const pending = this.read(configId, file, meta.archive, undefined, meta.jobId);
        this.remember(cacheKey, pending);
        return pending;
    }

    /** Fetches and opens the sidecar. Everything cacheable about `load` happens here. */
    private async read(
        configId: string,
        file: string,
        archive: NonNullable<BackupMetadata["archive"]>,
        override: KeyOverride | undefined,
        /** The job the `.meta.json` names, for the warning about a backup without a run. */
        jobId: unknown
    ): Promise<ArchiveIndex | null> {
        const bytes = await this.fetchSidecar(configId, file, archive.indexFile);
        if (!bytes) return null;

        // A plain index is only taken from a backup whose run did not encrypt it, see
        // `recorded-encryption.ts`. Outside the catch below, so the refusal reaches the caller
        // instead of a fallback to the index inside the archive.
        if (!archive.encrypted) await assertEncryptionKept(configId, file, { encrypted: false, jobId });

        try {
            if (!archive.encrypted) return await parseIndex(bytes);

            if (!archive.profileId || !archive.kdfSalt || !archive.noncePrefix) {
                throw new Error("Backup metadata is missing the crypto parameters needed to open the index");
            }

            const masterKey = await resolveBackupKey({
                profileId: archive.profileId,
                override,
                verify: archiveIndexVerifier(bytes, { kdfSalt: archive.kdfSalt, noncePrefix: archive.noncePrefix }),
                log: (msg, level) => level === "warning"
                    ? log.warn(msg, { configId, file })
                    : log.info(msg, { configId, file }),
            });

            const { indexKey } = deriveArchiveKeys(masterKey, Buffer.from(archive.kdfSalt, "hex"));
            return await parseIndex(bytes, {
                indexKey,
                noncePrefix: Buffer.from(archive.noncePrefix, "hex"),
            });
        } catch (e: unknown) {
            // A missing key is answerable - the caller turns it into a prompt for one. Every
            // other failure means this sidecar is unusable, and the caller may still fall
            // back to the archive's embedded copy, so it stays a null.
            if (e instanceof EncryptionKeyRequiredError) throw e;
            log.warn("Failed to parse archive index sidecar", { configId, file }, wrapError(e));
            return null;
        }
    }

    /** Lists one directory level inside a directory source. */
    async browse(
        configId: string,
        file: string,
        meta: BackupMetadata,
        jobSourceId: string,
        prefix?: string,
        override?: KeyOverride
    ): Promise<BrowseEntry[] | null> {
        const index = await this.load(configId, file, meta, override);
        return index ? browseLevel(index, jobSourceId, prefix) : null;
    }

    /**
     * Drops any cached index for a backup, in the view of every tenant, since `load` keeps one per
     * tenant. Call after the backup is deleted or replaced.
     */
    invalidate(configId: string, file: string): void {
        for (const key of [...this.cache.keys()]) {
            if (key.startsWith(`${configId}::`) && key.endsWith(`::${file}`)) this.cache.delete(key);
        }
    }

    /**
     * Drops every cached index.
     *
     * Call when the vault changes. A cached index outlives the key that opened it, so
     * deleting a profile would otherwise leave a backup that still lists its contents but
     * can no longer be restored - which reads as a bug rather than as a missing key.
     */
    clear(): void {
        this.cache.clear();
    }

    private remember(key: string, index: Promise<ArchiveIndex | null>): void {
        if (this.cache.size >= CACHE_MAX_ENTRIES) {
            // Insertion-ordered, so the first key is the oldest.
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, { index, expiresAt: Date.now() + CACHE_TTL_MS });

        // Only a successfully parsed index is worth keeping. A failure - a sidecar that is
        // not there yet, a key the vault does not hold - must be retried by the next caller
        // rather than replayed at them for the rest of the TTL.
        const forget = () => { if (this.cache.get(key)?.index === index) this.cache.delete(key); };
        void index.then((value) => {
            if (value === null) forget();
            else this.weigh(key, index, indexTextBytes(value) ?? 0);
        }, forget);
    }

    /**
     * Records what a finished index holds and keeps the cache within `maxCachedTextBytes`: an index
     * larger than the cap alone is dropped, otherwise the oldest finished ones make room for it.
     */
    private weigh(key: string, index: Promise<ArchiveIndex | null>, bytes: number): void {
        const entry = this.cache.get(key);
        if (entry?.index !== index) return;
        if (bytes > this.maxCachedTextBytes) {
            this.cache.delete(key);
            return;
        }
        entry.bytes = bytes;
        let held = 0;
        for (const cached of this.cache.values()) held += cached.bytes ?? 0;
        // Insertion-ordered, so the oldest go first. A read still in flight weighs nothing yet.
        for (const [otherKey, other] of this.cache) {
            if (held <= this.maxCachedTextBytes) break;
            if (otherKey === key || other.bytes === undefined) continue;
            this.cache.delete(otherKey);
            held -= other.bytes;
        }
    }

    /** Index reduced to what the restore dialog's entry pickers need. */
    async summarize(
        configId: string,
        file: string,
        meta: BackupMetadata,
        override?: KeyOverride
    ): Promise<ArchiveSummary | null> {
        return this.toSummary(await this.load(configId, file, meta, override), meta);
    }

    /**
     * Same summary, read from an archive already on local disk.
     *
     * Every archive carries a copy of its index as its last member, so this is the
     * fallback for a missing or corrupt sidecar. It costs the download the sidecar exists
     * to avoid, which is why it is only ever reached after the sidecar has failed.
     */
    async summarizeFromArchive(
        archivePath: string,
        meta: BackupMetadata,
        override?: KeyOverride,
        /** Where the archive was downloaded from, so a plain one is checked against its run, see `recorded-encryption.ts`. */
        origin?: { configId: string; file: string }
    ): Promise<ArchiveSummary | null> {
        try {
            const source = await localFileSource(archivePath);
            const manifest = await readArchiveManifest(source);

            if (!manifest.encryption) {
                if (origin) await assertEncryptionKept(origin.configId, origin.file, { encrypted: false, jobId: meta.jobId });
                return this.toSummary(await readArchiveIndex(source, manifest), meta);
            }

            // Read the index bytes before resolving the key: they are what proves a
            // candidate fits, so Smart Recovery has nothing to test until they are in hand.
            const indexBytes = await readEmbeddedIndexBytes(source);
            const masterKey = await resolveBackupKey({
                profileId: manifest.encryption.profileId,
                override,
                verify: archiveIndexVerifier(indexBytes, manifest.encryption),
                log: (msg, level) => level === "warning"
                    ? log.warn(msg, { archivePath })
                    : log.info(msg, { archivePath }),
            });

            return this.toSummary(await parseArchiveIndex(indexBytes, manifest, masterKey), meta);
        } catch (e: unknown) {
            if (e instanceof EncryptionKeyRequiredError || e instanceof EncryptionDowngradeError) throw e;
            log.warn("Failed to read the embedded archive index", { archivePath }, wrapError(e));
            return null;
        }
    }

    private async toSummary(index: ArchiveIndex | null, meta: BackupMetadata): Promise<ArchiveSummary | null> {
        if (!index) return null;

        // Resolve each source's original location while the JobSource still exists - a
        // deleted source simply has no origin to offer.
        const origins = new Map<string, ArchiveSummary["directories"][number]["origin"]>();
        for (const dir of index.directories) {
            try {
                const jobSource = await prisma.jobSource.findUnique({
                    where: { id: dir.src },
                    include: { config: true },
                });
                if (jobSource) {
                    origins.set(dir.src, {
                        configId: jobSource.configId,
                        configName: jobSource.config.name,
                        path: jobSource.path,
                    });
                }
            } catch { /* origin is a convenience, never a blocker */ }
        }

        return {
            databases: index.databases.map((d) => d.name),
            databaseDetails: index.databases.map((d) => ({ name: d.name, format: d.format, size: d.s })),
            directories: index.directories.map((d) => ({
                jobSourceId: d.src,
                label: d.label,
                fileCount: d.fileCount,
                totalSize: d.totalSize,
                excludePatterns: d.excludePatterns,
                ...(origins.has(d.src) ? { origin: origins.get(d.src) } : {}),
            })),
            sourceType: meta.sourceType !== "directory-only" ? meta.sourceType : undefined,
            encrypted: meta.archive?.encrypted ?? false,
            ...(meta.chain
                ? { chain: { type: meta.chain.type, index: meta.chain.index, deps: index.deps } }
                : {}),
        };
    }

    /**
     * The bytes of the index sidecar, at most `INDEX_MAX_STORED_BYTES`.
     *
     * Read through `readBytes()`, never `read()`, which decodes text and would corrupt a sealed
     * index. The read stops at the limit, so a sidecar of any size never reaches the memory or the
     * temp folder beyond it. Only an adapter without `readBytes()` downloads it to a temp file,
     * which is refused past the same limit once it is there.
     *
     * @param viewerTenantId - The tenant whose view of the destination the path is in, the tenant of the code that runs when left out
     * @returns The raw sidecar bytes, or null when it is missing or unreadable
     */
    async fetchSidecar(configId: string, file: string, suffix: string, viewerTenantId?: string | null): Promise<Buffer | null> {
        // The suffix is `indexFile` of the `.meta.json`, which whoever writes the destination chose.
        // Every archive names its index the same, and a path in it would reach past the backup at
        // the destination and, joined into the temp name, write and delete any file of the server.
        if (suffix !== INDEX_SIDECAR_SUFFIX) {
            log.warn("Refusing an archive index sidecar the backup names differently", { configId, file });
            return null;
        }
        let opened: Awaited<ReturnType<typeof openDestination>>;
        try {
            opened = await openDestination(configId, viewerTenantId);
        } catch {
            return null;
        }
        const { adapter, config: resolved } = opened;
        const remotePath = file + INDEX_SIDECAR_SUFFIX;

        if (adapter.readBytes) {
            try {
                return await adapter.readBytes(resolved, remotePath, { maxBytes: INDEX_MAX_STORED_BYTES });
            } catch (e: unknown) {
                if (isFileTooLarge(e)) {
                    log.warn("Refusing an archive index sidecar larger than any backup writes", { configId, remotePath });
                } else {
                    log.warn("Failed to fetch archive index sidecar", { configId, remotePath }, wrapError(e));
                }
                return null;
            }
        }

        let tempFile: string | null = null;
        try {
            // Unique per call: the restore page fetches the same backup's index several
            // times at once (one file tree per directory source, plus the dry run), and a
            // shared path means two downloads writing over each other.
            tempFile = await privateTempPath(`archive-index-${process.pid}-${crypto.randomUUID()}${INDEX_SIDECAR_SUFFIX}`);
            const downloaded = await adapter.download(resolved, remotePath, tempFile);
            if (!downloaded) return null;
            // Opened without following a link and checked on the handle, so a link of the server
            // never hands over a file of this one, see `downloaded-file.ts`. Read into memory only
            // within what any writer stores, see `limits.ts`.
            const handle = await fs.open(tempFile, READ_NO_FOLLOW);
            try {
                const stats = await handle.stat();
                if (!stats.isFile()) throw new Error("The downloaded index sidecar is no regular file");
                if (stats.size > INDEX_MAX_STORED_BYTES) {
                    log.warn("Refusing an archive index sidecar larger than any backup writes", { configId, remotePath });
                    return null;
                }
                return await handle.readFile();
            } finally {
                await handle.close();
            }
        } catch (e: unknown) {
            log.warn("Failed to fetch archive index sidecar", { configId, remotePath }, wrapError(e));
            return null;
        } finally {
            if (tempFile) await fs.unlink(tempFile).catch(() => { });
        }
    }
}

export const archiveIndexService = new ArchiveIndexService();
