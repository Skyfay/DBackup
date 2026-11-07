import { StorageAdapter, FileInfo, DirectoryBrowseEntry, UploadOptions, ListTreeOptions, ListTreeResult, StorageReadOptions } from "@/lib/core/interfaces";
import { S3GenericSchema, S3AWSSchema, S3R2Schema, S3HetznerSchema } from "@/lib/adapters/definitions";
import { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand, HeadObjectCommand, HeadBucketCommand, StorageClass } from "@aws-sdk/client-s3";
// Type-only, deliberately. The unit suites replace the whole SDK module with a factory that
// exports the command classes and nothing else, so a value import would break them.
import type { _Object } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, createWriteStream } from "fs";
import { stat } from "fs/promises";
import { pipeline } from "stream/promises";
import { Transform, Readable } from "stream";
import path from "path";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { stripSlashes } from "@/lib/paths";
import { formatBytes } from "@/lib/utils";
import { resolveS3UploadTuning } from "@/lib/adapters/s3-upload-tuning";
import { STATELESS_READ_CONCURRENCY } from "@/lib/adapters/storage/common/read-concurrency";
import { assertReadSize, collectCapped, isFileTooLarge, readLimitOf, textOf } from "@/lib/adapters/storage/common/read-limit";
import { createListingGuard, createPageGuard } from "@/lib/adapters/storage/common/listing-limits";
import { sendListPage } from "@/lib/adapters/storage/s3-listing";
import { limitResponseBodies } from "@/lib/adapters/storage/s3-response-limit";
import { guardedAgents } from "@/lib/network/pinned-http";
import { reachOf, type ReachPolicy } from "@/lib/network/reach-policy";

const log = logger.child({ adapter: "s3" });

interface S3InternalConfig {
    endpoint?: string;
    region: string;
    bucket: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
    /** The policy of a tenant that blocks the local network, whose client dials checked addresses only, see `pinned-http.ts`. */
    reach?: ReachPolicy | null;
    forcePathStyle?: boolean;
    pathPrefix?: string;
    storageClass?: string;
}

/**
 * What the upload path needs on top of the connection details.
 *
 * A separate type rather than three optional fields on `S3InternalConfig`, so the compiler asks
 * for `adapterId` at exactly the four call sites that upload and at none of the thirty that
 * list, download or delete. Optional everywhere would let one adapter silently miss its wiring
 * and fall back to the defaults, which is the one failure this change cannot notice by itself.
 */
interface S3UploadConfig extends S3InternalConfig {
    /** Which of the four S3 adapters this is, so the tuning range is looked up correctly. */
    adapterId: string;
    /** Parts uploaded at the same time, as stored on the connection. */
    uploadConcurrency?: number;
    /** Megabytes per part, as stored on the connection. */
    uploadPartSizeMb?: number;
}

class S3ClientFactory {
    /** A client whose every answer is read with a bound, see `limitResponseBodies`. */
    static create(config: S3InternalConfig) {
        return limitResponseBodies(new S3Client({
            region: config.region,
            endpoint: config.endpoint,
            credentials: config.credentials,
            forcePathStyle: config.forcePathStyle,
            // The SDK takes the options of its Node.js handler here, the agents among them.
            ...(config.reach ? { requestHandler: guardedAgents(config.reach, { keepAlive: true }) } : {}),
        }));
    }

    static getTargetKey(config: S3InternalConfig, remotePath: string): string {
        const prefix = config.pathPrefix ? stripSlashes(config.pathPrefix) : '';
        return prefix ? `${prefix}/${remotePath}` : remotePath;
    }

    /**
     * Inverse of getTargetKey: turns a full bucket key into one relative to the adapter's
     * configured path prefix.
     *
     * Every other storage adapter's list() already returns paths relative to its root, and
     * the whole app - directory-backup relative paths, restore write-back, retention - relies
     * on that. Object storage has no such root, so a raw key carries the prefix; stripping it
     * here makes S3 obey the same contract instead of leaking the prefix into stored file
     * paths (which surfaced as an extra folder named after the prefix on restore).
     */
    static stripPrefix(config: S3InternalConfig, key: string): string {
        const prefix = config.pathPrefix ? stripSlashes(config.pathPrefix) : '';
        if (!prefix) return key;
        const withSlash = `${prefix}/`;
        return key.startsWith(withSlash) ? key.slice(withSlash.length) : key;
    }
}

// --- Shared Implementation ---

async function s3Upload(internalConfig: S3UploadConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, options?: UploadOptions): Promise<boolean> {
    const client = S3ClientFactory.create(internalConfig);
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, remotePath);

    if (onLog) onLog(`Starting S3 upload to bucket: ${internalConfig.bucket}, key: ${targetKey}`, 'info', 'storage');

    // The size only picks the part size, so a stat that fails must not fail the upload. Without
    // it the configured size is used as-is, which is correct for the small sidecars and the only
    // case it could be wrong - an archive past 80 GB needing larger parts to stay under the
    // 10.000-part limit - cannot arise from a file the runner has just finished writing.
    let fileSize: number | undefined;
    try {
        fileSize = (await stat(localPath)).size;
    } catch {
        fileSize = undefined;
    }

    const { queueSize, partSize, adjustment } = resolveS3UploadTuning(
        internalConfig.adapterId,
        internalConfig,
        fileSize
    );

    // A file that fits in one part is a plain PutObject however the connection is configured,
    // so neither the parallelism nor a transfer rate says anything about it. The metadata
    // sidecar is a kilobyte of JSON, and reporting it at "2.88 KB/s" reads like a fault.
    const isMultipart = !!fileSize && fileSize > partSize;

    const fileStream = createReadStream(localPath);
    const startedAt = Date.now();
    try {
        const parallelUploads3 = new Upload({
            client: client,
            // Both are set explicitly. The SDK's own defaults are 4 parts of 5 MB, which leaves
            // most of a fast link idle: measured against R2 over a 10 Gbit line, that is 27 MB/s
            // while the same run reads and hashes the file locally at over 400 MB/s.
            queueSize,
            partSize,
            params: {
                Bucket: internalConfig.bucket,
                Key: targetKey,
                Body: fileStream,
                StorageClass: (internalConfig.storageClass as StorageClass) || undefined,
                Metadata: options?.checksumSha256 ? { 'dbackup-sha256': options.checksumSha256 } : undefined,
            },
        });

        // Only worth a line where it says something, and it reports what actually ran rather
        // than what the connection stores - the two differ whenever the archive forced a
        // different part size, which is exactly when someone reading the log needs to know.
        if (onLog && isMultipart) {
            const detail = adjustment === 'raised-for-part-limit'
                ? ` (raised above the configured maximum to stay within S3's 10,000-part limit)`
                : adjustment === 'lowered-to-fill-parallelism'
                    ? ` (lowered from the configured maximum so every connection gets a part)`
                    : '';
            onLog(
                `Multipart upload: ${queueSize} parallel parts of ${formatBytes(partSize)}${detail}`,
                'info',
                'storage'
            );
        }

        parallelUploads3.on("httpUploadProgress", (progress) => {
            if (onProgress && progress.loaded && progress.total) {
                const percent = Math.round((progress.loaded / progress.total) * 100);
                onProgress(percent);
            }
        });

        await parallelUploads3.done();
        // The throughput is the whole reason the two settings above exist, and it used to reach
        // only the live progress detail - gone the moment the run ended. Anyone tuning the
        // numbers had to rediscover it by subtracting log timestamps, at one-second resolution.
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = isMultipart && elapsed > 0 ? ` at ${formatBytes(fileSize! / elapsed)}/s` : '';
        if (onLog) onLog(`S3 upload completed successfully${rate}`, 'info', 'storage');
        return true;
    } catch (error: unknown) {
        log.error("S3 upload failed", { bucket: internalConfig.bucket, targetKey }, wrapError(error));
        if (onLog && error instanceof Error) onLog(`S3 upload failed: ${error.message}`, 'error', 'storage', error instanceof Error ? error.stack : undefined);
        return false;
    } finally {
        fileStream.destroy();
        client.destroy();
    }
}

/** The prefix a listing scans, with the trailing slash S3 needs to treat it as a folder. */
function listPrefixFor(internalConfig: S3InternalConfig, dir: string): string {
    const prefix = S3ClientFactory.getTargetKey(internalConfig, dir);
    return prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
}

/**
 * Yields every object under a prefix, one ListObjectsV2 page at a time.
 *
 * ListObjectsV2 answers with at most 1000 keys plus a continuation token, and taking only the
 * first page is not a smaller listing - it is the lexicographically first 1000 keys. Backup
 * filenames carry timestamps, so that page held the oldest backups and every recent one was
 * invisible to retention, integrity checks, the destination browser and the dashboard alike,
 * with no error and no log line to say so.
 *
 * The signal is checked before each request rather than after, so an already-cancelled walk
 * costs nothing at all.
 *
 * `MaxKeys` is the 1000 S3 answers by default, and the answer of a page is read only up to a bound,
 * see `s3-listing.ts`. No `Delimiter`, because `list()` is deliberately recursive - see the
 * comment in `05-retention.ts` about incremental chains living in subfolders.
 */
async function* s3ListPages(
    client: S3Client,
    bucket: string,
    listPrefix: string,
    signal?: AbortSignal
): AsyncGenerator<_Object[]> {
    let continuationToken: string | undefined;
    // A server that hands out a token again, or empty pages without end, would list forever.
    const pages = createPageGuard();

    do {
        signal?.throwIfAborted();

        const response = await sendListPage(client, {
            Bucket: bucket,
            Prefix: listPrefix,
            ContinuationToken: continuationToken,
        });

        yield response.Contents ?? [];

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
        pages.next(continuationToken, response.Contents?.length ?? 0);
    } while (continuationToken);
}

/**
 * Turns one listed object into a `FileInfo`, or `null` for something that is not a file.
 *
 * Folder markers are recognised by their key ending in `/`, which is what actually makes them
 * markers. The old test was `size > 0`, which caught them by accident and threw away every
 * genuine empty file with them - so an empty file was missing from a directory backup, read as
 * a deleted object during cache reconciliation, and read as a missing link in a backup chain.
 *
 * The check has to run on the raw key: `path.basename("backups/foo/")` is `"foo"`, so testing
 * the name instead would let every marker through.
 */
function s3ObjectToFileInfo(internalConfig: S3InternalConfig, obj: _Object): FileInfo | null {
    const key = obj.Key || "";
    if (!key || key.endsWith('/')) return null;

    const name = path.basename(key);
    if (!name) return null;

    return {
        name,
        // Relative to the adapter's path prefix, so it matches every other adapter's
        // list() and can be fed straight back to download/delete (which re-apply the
        // prefix) without the prefix leaking into stored paths.
        path: S3ClientFactory.stripPrefix(internalConfig, key),
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
        storageClass: obj.StorageClass || undefined,
    };
}

async function s3List(internalConfig: S3InternalConfig, dir: string = ""): Promise<FileInfo[]> {
    const client = S3ClientFactory.create(internalConfig);
    const listPrefix = listPrefixFor(internalConfig, dir);

    try {
        const files: FileInfo[] = [];
        // Every key passes the guard as it arrives, like those of `s3ListTree`.
        const guard = createListingGuard();

        for await (const page of s3ListPages(client, internalConfig.bucket, listPrefix)) {
            for (const obj of page) {
                // Before the folder markers are dropped, so a server that answers pages of
                // markers alone without end still reaches the limit, see `s3ListTree`.
                guard.add(obj.Key ?? "");
                const file = s3ObjectToFileInfo(internalConfig, obj);
                if (file) files.push(file);
            }
        }

        return files;
    } catch (error) {
        log.error("S3 list failed", { bucket: internalConfig.bucket, prefix: listPrefix }, wrapError(error));
        throw error;
    } finally {
        client.destroy();
    }
}

/**
 * Collection walk over a prefix, which is `list()` plus progress and cancellation.
 *
 * Same pagination helper as `list()`, on purpose. Two loops would drift, and retention and
 * collection would end up disagreeing about what is in a destination - the reason `ftp.ts`
 * keeps one walker behind both of its entry points.
 *
 * Without this, `listTreeForCollection()` falls back to `list()`, which reports progress only
 * once it has finished and cannot be interrupted at all. That was harmless while a listing
 * stopped at 1000 keys and is not once it paginates: a large bucket lists for minutes behind a
 * frozen progress row and a cancel button that does nothing.
 *
 * `pruned` is always empty, and that is a decision rather than an omission. `excludePatterns`
 * are advisory and the caller applies them again anyway, a flat scan has no directory it could
 * decline to descend into, and rebuilding this as a `Delimiter` walk to gain one would cost S3
 * more requests rather than fewer. `concurrency` is ignored for the same kind of reason:
 * pagination is serial by construction, because the next token only exists once the previous
 * response has arrived. `unsupportedSymlinks` stays unset - object storage has no links.
 */
async function s3ListTree(
    internalConfig: S3InternalConfig,
    dir: string = "",
    options?: ListTreeOptions
): Promise<ListTreeResult> {
    const client = S3ClientFactory.create(internalConfig);
    const listPrefix = listPrefixFor(internalConfig, dir);

    try {
        const files: FileInfo[] = [];
        // Every key passes the guard first, so a bucket of any size stops the walk, see `listing-limits.ts`.
        const guard = createListingGuard();

        for await (const page of s3ListPages(client, internalConfig.bucket, listPrefix, options?.signal)) {
            for (const obj of page) {
                // Every object counts, a folder marker too. A server that answered page after page
                // of markers alone moved neither the count nor the rule of empty pages, since each
                // page held objects, and listed forever.
                guard.add(obj.Key ?? "");
                const file = s3ObjectToFileInfo(internalConfig, obj);
                if (file) files.push(file);
            }

            // One report per page. No self-throttling: listTreeForCollection() already rate
            // limits what reaches the execution's progress row.
            options?.onProgress?.({
                files: files.length,
                directories: 0,
                prunedDirectories: 0,
                currentPath: "",
            });
        }

        return { files, pruned: [] };
    } catch (error) {
        log.error("S3 tree listing failed", { bucket: internalConfig.bucket, prefix: listPrefix }, wrapError(error));
        throw error;
    } finally {
        client.destroy();
    }
}

/**
 * Lists one level of "folders" below a prefix.
 *
 * Object storage has no directories - a key is a flat string. Asking S3 for a delimiter
 * makes it group keys by the next `/` and return those groups as CommonPrefixes, which is
 * the same tree the console shows. Pagination matters here: a bucket with many prefixes
 * returns them across several pages, and stopping at the first would silently hide folders.
 */
async function s3BrowseDirectories(
    internalConfig: S3InternalConfig,
    subPath: string = ""
): Promise<DirectoryBrowseEntry[]> {
    const client = S3ClientFactory.create(internalConfig);
    const listPrefix = listPrefixFor(internalConfig, subPath);

    try {
        const entries: DirectoryBrowseEntry[] = [];
        let continuationToken: string | undefined;
        // Bounded like a listing for a collection, see `listing-limits.ts`.
        const guard = createListingGuard();
        const pages = createPageGuard();

        do {
            const response = await sendListPage(client, {
                Bucket: internalConfig.bucket,
                Prefix: listPrefix,
                Delimiter: "/",
                ContinuationToken: continuationToken,
            });

            for (const obj of response.Contents ?? []) guard.add(obj.Key ?? "");
            for (const group of response.CommonPrefixes ?? []) {
                guard.add(group.Prefix ?? "");
                if (!group.Prefix) continue;
                const name = group.Prefix.slice(listPrefix.length).replace(/\/$/, "");
                if (!name) continue;
                entries.push({ name, path: subPath ? `${subPath}/${name}` : name });
            }

            continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
            pages.next(continuationToken, (response.Contents?.length ?? 0) + (response.CommonPrefixes?.length ?? 0));
        } while (continuationToken);

        return entries;
    } catch (error) {
        log.error("S3 browseDirectories failed", { bucket: internalConfig.bucket, subPath }, wrapError(error));
        throw error;
    } finally {
        client.destroy();
    }
}

async function s3Download(
    internalConfig: S3InternalConfig,
    remotePath: string,
    localPath: string,
    onProgress?: (processed: number, total: number) => void,
    _onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<boolean> {
    const client = S3ClientFactory.create(internalConfig);
    // list() now returns prefix-relative paths, so the prefix is re-applied here - the same
    // as upload does - rather than assuming the caller passes a full key.
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, remotePath);

    try {
        const command = new GetObjectCommand({
            Bucket: internalConfig.bucket,
            Key: targetKey,
        });

        const response = await client.send(command);
        const webStream = response.Body as any; // Type assertion needed for NodeJS streams compatibility

        if (!webStream) throw new Error("Empty response body");

        const total = response.ContentLength ?? 0;

        if (onProgress && total > 0) {
            let processed = 0;
            const tracker = new Transform({
                transform(chunk, _encoding, callback) {
                    processed += chunk.length;
                    onProgress(processed, total);
                    callback(null, chunk);
                }
            });
            await pipeline(webStream, tracker, createWriteStream(localPath));
        } else {
            await pipeline(webStream, createWriteStream(localPath));
        }
        return true;
    } catch (error) {
        const err = error as any;
        if (err?.name === "InvalidObjectState" || err?.Code === "InvalidObjectState") {
            log.error("S3 download failed - object is archived", { bucket: internalConfig.bucket, targetKey }, wrapError(error));
            throw new Error(
                `The backup "${path.basename(targetKey)}" is stored in S3 Glacier or Deep Archive and cannot be downloaded directly. ` +
                "Please restore the object via the AWS Console first (S3 - select object - Actions - Initiate restore), then try again."
            );
        }
        log.error("S3 download failed", { bucket: internalConfig.bucket, targetKey }, wrapError(error));
        return false;
    } finally {
        client.destroy();
    }
}

/**
 * Streams a byte range of an object via the HTTP Range header.
 *
 * Used by file-level restore to pull a single archive entry out of a large backup. The
 * client is destroyed once the caller has consumed the stream, not before - destroying it
 * eagerly would abort the transfer mid-flight.
 */
async function s3DownloadRange(
    internalConfig: S3InternalConfig,
    remotePath: string,
    start: number,
    end: number
): Promise<NodeJS.ReadableStream> {
    // An empty range is legal - a zero-length file's archive entry produces one - but S3
    // has no way to express it, so it is answered locally.
    if (end < start) return Readable.from([]);

    const client = S3ClientFactory.create(internalConfig);
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, remotePath);
    try {
        const response = await client.send(new GetObjectCommand({
            Bucket: internalConfig.bucket,
            Key: targetKey,
            Range: `bytes=${start}-${end}`,
        }));

        const body = response.Body as unknown as NodeJS.ReadableStream | undefined;
        if (!body) throw new Error("Empty response body");

        body.on("end", () => client.destroy());
        body.on("error", () => client.destroy());
        return body;
    } catch (error) {
        client.destroy();
        log.error("S3 ranged download failed", { bucket: internalConfig.bucket, remotePath, start, end }, wrapError(error));
        throw error;
    }
}

async function s3ReadBytes(internalConfig: S3InternalConfig, remotePath: string, options?: StorageReadOptions): Promise<Buffer | null> {
    const client = S3ClientFactory.create(internalConfig);
    // list() returns prefix-relative paths, so the prefix is re-applied here.
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, remotePath);
    const limit = readLimitOf(options);

    try {
        const command = new GetObjectCommand({
            Bucket: internalConfig.bucket,
            Key: targetKey,
        });

        const response = await client.send(command);
        if (!response.Body) return null;
        const body = response.Body as unknown as NodeJS.ReadableStream & { destroy?: () => void };
        try {
            // The size the server announces, then the bytes it really sends, see `read-limit.ts`.
            assertReadSize(response.ContentLength, limit);
        } catch (error) {
            body.destroy?.();
            throw error;
        }
        return await collectCapped(body, limit);
    } catch (error) {
        if (isFileTooLarge(error)) throw error;
        // If file doesn't exist (e.g. meta.json missing), return null instead of throwing
        return null;
    } finally {
        client.destroy();
    }
}

async function s3Read(internalConfig: S3InternalConfig, remotePath: string, options?: StorageReadOptions): Promise<string | null> {
    return textOf(await s3ReadBytes(internalConfig, remotePath, options));
}

async function s3Delete(
    internalConfig: S3InternalConfig,
    remotePath: string,
    _onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<boolean> {
    const client = S3ClientFactory.create(internalConfig);
    // list() returns prefix-relative paths, so the prefix is re-applied here.
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, remotePath);

    try {
        const command = new DeleteObjectCommand({
            Bucket: internalConfig.bucket,
            Key: targetKey,
        });

        await client.send(command);
        return true;
    } catch (error) {
        log.error("S3 delete failed", { bucket: internalConfig.bucket, remotePath }, wrapError(error));
        return false;
    } finally {
        client.destroy();
    }
}

async function s3VerifyChecksum(
    internalConfig: S3InternalConfig,
    remotePath: string,
    checksums: { sha256?: string; md5?: string }
): Promise<'passed' | 'failed' | 'unsupported'> {
    if (!checksums.sha256) return 'unsupported';
    const client = S3ClientFactory.create(internalConfig);
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, remotePath);
    try {
        const response = await client.send(new HeadObjectCommand({ Bucket: internalConfig.bucket, Key: targetKey }));
        const stored = response.Metadata?.['dbackup-sha256'];
        if (!stored) return 'unsupported';
        return stored === checksums.sha256 ? 'passed' : 'failed';
    } catch {
        return 'unsupported';
    } finally {
        client.destroy();
    }
}

const S3_TEST_SUBFOLDER = '.dbackup/test';

function testTimestamp(): string {
    return new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

async function s3Ping(internalConfig: S3InternalConfig): Promise<{ success: boolean; message: string }> {
    const client = S3ClientFactory.create(internalConfig);
    try {
        await client.send(new HeadBucketCommand({ Bucket: internalConfig.bucket }));
        return { success: true, message: "Connection successful" };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, message: message || "Connection failed" };
    } finally {
        client.destroy();
    }
}

async function s3Test(internalConfig: S3InternalConfig, adapterId: string): Promise<{ success: boolean; message: string }> {
    const client = S3ClientFactory.create(internalConfig);
    const testFile = `${S3_TEST_SUBFOLDER}/connection-test-${adapterId}-${testTimestamp()}`;
    // Use target key logic to respect pathPrefix
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, testFile);
    let uploaded = false;

    try {
        // 1. Try to write
        await client.send(new PutObjectCommand({
            Bucket: internalConfig.bucket,
            Key: targetKey,
            Body: "Database Backup Manager - Connection Test"
        }));
        uploaded = true;

        // 2. Try to delete
        await client.send(new DeleteObjectCommand({
            Bucket: internalConfig.bucket,
            Key: targetKey
        }));
        uploaded = false;

        return { success: true, message: "Connection successful (Write/Delete verified)" };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, message: message || "Connection failed" };
    } finally {
        if (uploaded) await client.send(new DeleteObjectCommand({ Bucket: internalConfig.bucket, Key: targetKey })).catch(() => {});
        client.destroy();
    }
}


// --- Specific Adapters ---

// 1. Generic S3
export const S3GenericAdapter: StorageAdapter = {
    id: "s3-generic",
    type: "storage",
    name: "S3 Compatible (Generic)",
    configSchema: S3GenericSchema,
    credentials: { primary: "ACCESS_KEY" },
    upload: (config, ...args) => s3Upload({
        adapterId: "s3-generic",
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix,
        uploadConcurrency: config.uploadConcurrency,
        uploadPartSizeMb: config.uploadPartSizeMb
    }, ...args),
    list: (config, ...args) => s3List({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    listTree: (config, ...args) => s3ListTree({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    download: (config, ...args) => s3Download({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    downloadRange: (config, ...args) => s3DownloadRange({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    browseDirectories: (config, ...args) => s3BrowseDirectories({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    delete: (config, ...args) => s3Delete({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    test: (config) => s3Test({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
    }, 's3-generic'),
    ping: (config) => s3Ping({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
    }),
    readConcurrency: STATELESS_READ_CONCURRENCY,
    read: (config, ...args) => s3Read({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    readBytes: (config, ...args) => s3ReadBytes({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    verifyChecksum: (config, remotePath, checksums) => s3VerifyChecksum({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, remotePath, checksums),
};

// 2. AWS S3
export const S3AWSAdapter: StorageAdapter = {
    id: "s3-aws",
    type: "storage",
    name: "Amazon S3",
    configSchema: S3AWSSchema,
    credentials: { primary: "ACCESS_KEY" },
    upload: (config, ...args) => s3Upload({
        adapterId: "s3-aws",
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix,
        storageClass: config.storageClass,
        uploadConcurrency: config.uploadConcurrency,
        uploadPartSizeMb: config.uploadPartSizeMb
    }, ...args),
    list: (config, ...args) => s3List({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    listTree: (config, ...args) => s3ListTree({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    download: (config, ...args) => s3Download({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    downloadRange: (config, ...args) => s3DownloadRange({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    browseDirectories: (config, ...args) => s3BrowseDirectories({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    delete: (config, ...args) => s3Delete({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    test: (config) => s3Test({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
    }, 's3-aws'),
    ping: (config) => s3Ping({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
    }),
    readConcurrency: STATELESS_READ_CONCURRENCY,
    read: (config, ...args) => s3Read({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    readBytes: (config, ...args) => s3ReadBytes({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    verifyChecksum: (config, remotePath, checksums) => s3VerifyChecksum({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, remotePath, checksums),
};

function r2Endpoint(accountId: string, jurisdiction?: string): string {
    if (jurisdiction === "eu") return `https://${accountId}.eu.r2.cloudflarestorage.com`;
    if (jurisdiction === "fedramp") return `https://${accountId}.fedramp.r2.cloudflarestorage.com`;
    return `https://${accountId}.r2.cloudflarestorage.com`;
}

// 3. Cloudflare R2
export const S3R2Adapter: StorageAdapter = {
    id: "s3-r2",
    type: "storage",
    name: "Cloudflare R2",
    configSchema: S3R2Schema,
    credentials: { primary: "ACCESS_KEY" },
    upload: (config, ...args) => s3Upload({
        adapterId: "s3-r2",
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix,
        uploadConcurrency: config.uploadConcurrency,
        uploadPartSizeMb: config.uploadPartSizeMb
    }, ...args),
    list: (config, ...args) => s3List({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    listTree: (config, ...args) => s3ListTree({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    download: (config, ...args) => s3Download({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    downloadRange: (config, ...args) => s3DownloadRange({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    browseDirectories: (config, ...args) => s3BrowseDirectories({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    delete: (config, ...args) => s3Delete({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    test: (config) => s3Test({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
    }, 's3-r2'),
    ping: (config) => s3Ping({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
    }),
    readConcurrency: STATELESS_READ_CONCURRENCY,
    read: (config, ...args) => s3Read({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    readBytes: (config, ...args) => s3ReadBytes({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    verifyChecksum: (config, remotePath, checksums) => s3VerifyChecksum({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, remotePath, checksums),
};

// 4. Hetzner Object Storage
export const S3HetznerAdapter: StorageAdapter = {
    id: "s3-hetzner",
    type: "storage",
    name: "Hetzner Object Storage",
    configSchema: S3HetznerSchema,
    credentials: { primary: "ACCESS_KEY" },
    upload: (config, ...args) => s3Upload({
        adapterId: "s3-hetzner",
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix,
        uploadConcurrency: config.uploadConcurrency,
        uploadPartSizeMb: config.uploadPartSizeMb
    }, ...args),
    list: (config, ...args) => s3List({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    listTree: (config, ...args) => s3ListTree({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    download: (config, ...args) => s3Download({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    downloadRange: (config, ...args) => s3DownloadRange({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    browseDirectories: (config, ...args) => s3BrowseDirectories({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    delete: (config, ...args) => s3Delete({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    test: (config) => s3Test({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
    }, 's3-hetzner'),
    ping: (config) => s3Ping({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
    }),
    readConcurrency: STATELESS_READ_CONCURRENCY,
    read: (config, ...args) => s3Read({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    readBytes: (config, ...args) => s3ReadBytes({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, ...args),
    verifyChecksum: (config, remotePath, checksums) => s3VerifyChecksum({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, reach: reachOf(config),
        pathPrefix: config.pathPrefix
    }, remotePath, checksums),
};
