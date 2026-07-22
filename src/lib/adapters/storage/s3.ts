import { StorageAdapter, FileInfo, UploadOptions } from "@/lib/core/interfaces";
import { S3GenericSchema, S3AWSSchema, S3R2Schema, S3HetznerSchema } from "@/lib/adapters/definitions";
import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand, PutObjectCommand, HeadObjectCommand, HeadBucketCommand, StorageClass } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Transform, Readable } from "stream";
import path from "path";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ adapter: "s3" });

interface S3InternalConfig {
    endpoint?: string;
    region: string;
    bucket: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
    forcePathStyle?: boolean;
    pathPrefix?: string;
    storageClass?: string;
}

class S3ClientFactory {
    static create(config: S3InternalConfig) {
        return new S3Client({
            region: config.region,
            endpoint: config.endpoint,
            credentials: config.credentials,
            forcePathStyle: config.forcePathStyle,
        });
    }

    static getTargetKey(config: S3InternalConfig, remotePath: string): string {
        const prefix = config.pathPrefix ? config.pathPrefix.replace(/^\/+|\/+$/g, '') : '';
        return prefix ? `${prefix}/${remotePath}` : remotePath;
    }
}

// --- Shared Implementation ---

async function s3Upload(internalConfig: S3InternalConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, options?: UploadOptions): Promise<boolean> {
    const client = S3ClientFactory.create(internalConfig);
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, remotePath);

    if (onLog) onLog(`Starting S3 upload to bucket: ${internalConfig.bucket}, key: ${targetKey}`, 'info', 'storage');

    const fileStream = createReadStream(localPath);
    try {
        const parallelUploads3 = new Upload({
            client: client,
            params: {
                Bucket: internalConfig.bucket,
                Key: targetKey,
                Body: fileStream,
                StorageClass: (internalConfig.storageClass as StorageClass) || undefined,
                Metadata: options?.checksumSha256 ? { 'dbackup-sha256': options.checksumSha256 } : undefined,
            },
        });

        parallelUploads3.on("httpUploadProgress", (progress) => {
            if (onProgress && progress.loaded && progress.total) {
                const percent = Math.round((progress.loaded / progress.total) * 100);
                onProgress(percent);
            }
        });

        await parallelUploads3.done();
        if (onLog) onLog(`S3 upload completed successfully`, 'info', 'storage');
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

async function s3List(internalConfig: S3InternalConfig, dir: string = ""): Promise<FileInfo[]> {
    const client = S3ClientFactory.create(internalConfig);
    const prefix = S3ClientFactory.getTargetKey(internalConfig, dir);

    // Ensure prefix ends with / if it serves as a directory listing, unless empty
    const listPrefix = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;

    try {
        const command = new ListObjectsV2Command({
            Bucket: internalConfig.bucket,
            Prefix: listPrefix,
        });

        const response = await client.send(command);

        if (!response.Contents) return [];

        return response.Contents.map(obj => ({
            name: path.basename(obj.Key || ""),
            path: obj.Key || "",
            size: obj.Size || 0,
            lastModified: obj.LastModified || new Date(),
            storageClass: obj.StorageClass || undefined,
        })).filter(f => f.name && f.size > 0); // Filter folders or empty keys
    } catch (error) {
        log.error("S3 list failed", { bucket: internalConfig.bucket, prefix: listPrefix }, wrapError(error));
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
    const targetKey = remotePath; // Usually getting full path from list() result

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
    try {
        const response = await client.send(new GetObjectCommand({
            Bucket: internalConfig.bucket,
            Key: remotePath,
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

async function s3Read(internalConfig: S3InternalConfig, remotePath: string): Promise<string | null> {
    const client = S3ClientFactory.create(internalConfig);
    // Note: remotePath here is usually the full path/key from list(), so we don't apply prefix again
    // unless list() returns relative paths. Current implementation of s3List returns full keys.

    try {
        const command = new GetObjectCommand({
            Bucket: internalConfig.bucket,
            Key: remotePath,
        });

        const response = await client.send(command);
        if (!response.Body) return null;

        // AWS SDK v3 body has a transformToString method
        return await response.Body.transformToString("utf-8");
    } catch (_error) {
        // If file doesn't exist (e.g. meta.json missing), return null instead of throwing
        return null;
    } finally {
        client.destroy();
    }
}

async function s3Delete(
    internalConfig: S3InternalConfig,
    remotePath: string,
    _onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<boolean> {
    const client = S3ClientFactory.create(internalConfig);

    try {
        const command = new DeleteObjectCommand({
            Bucket: internalConfig.bucket,
            Key: remotePath,
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
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    list: (config, ...args) => s3List({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    download: (config, ...args) => s3Download({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    downloadRange: (config, ...args) => s3DownloadRange({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    delete: (config, ...args) => s3Delete({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    test: (config) => s3Test({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle,
    }, 's3-generic'),
    ping: (config) => s3Ping({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle,
    }),
    read: (config, ...args) => s3Read({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args),
    verifyChecksum: (config, remotePath, checksums) => s3VerifyChecksum({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
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
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix,
        storageClass: config.storageClass
    }, ...args),
    list: (config, ...args) => s3List({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    download: (config, ...args) => s3Download({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    downloadRange: (config, ...args) => s3DownloadRange({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    delete: (config, ...args) => s3Delete({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    test: (config) => s3Test({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, 's3-aws'),
    ping: (config) => s3Ping({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
    read: (config, ...args) => s3Read({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    verifyChecksum: (config, remotePath, checksums) => s3VerifyChecksum({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
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
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    list: (config, ...args) => s3List({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    download: (config, ...args) => s3Download({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    downloadRange: (config, ...args) => s3DownloadRange({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    delete: (config, ...args) => s3Delete({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    test: (config) => s3Test({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, 's3-r2'),
    ping: (config) => s3Ping({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
    read: (config, ...args) => s3Read({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    verifyChecksum: (config, remotePath, checksums) => s3VerifyChecksum({
        endpoint: r2Endpoint(config.accountId, config.jurisdiction),
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
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
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    list: (config, ...args) => s3List({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    download: (config, ...args) => s3Download({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    downloadRange: (config, ...args) => s3DownloadRange({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    delete: (config, ...args) => s3Delete({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    test: (config) => s3Test({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, 's3-hetzner'),
    ping: (config) => s3Ping({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
    read: (config, ...args) => s3Read({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    verifyChecksum: (config, remotePath, checksums) => s3VerifyChecksum({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, remotePath, checksums),
};
