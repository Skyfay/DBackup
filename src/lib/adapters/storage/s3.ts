import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { S3GenericSchema, S3AWSSchema, S3R2Schema, S3HetznerSchema } from "@/lib/adapters/definitions";
import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand, PutObjectCommand, StorageClass } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import { LogLevel, LogType } from "@/lib/core/logs";

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

    static getTargetKey(config: any, remotePath: string): string {
        const prefix = config.pathPrefix ? config.pathPrefix.replace(/^\/+|\/+$/g, '') : '';
        return prefix ? `${prefix}/${remotePath}` : remotePath;
    }
}

// --- Shared Implementation ---

async function s3Upload(internalConfig: S3InternalConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
    const client = S3ClientFactory.create(internalConfig);
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, remotePath);

    try {
        if (onLog) onLog(`Starting S3 upload to bucket: ${internalConfig.bucket}, key: ${targetKey}`, 'info', 'storage');

        const fileStream = createReadStream(localPath);

        const parallelUploads3 = new Upload({
            client: client,
            params: {
                Bucket: internalConfig.bucket,
                Key: targetKey,
                Body: fileStream,
                StorageClass: (internalConfig.storageClass as StorageClass) || undefined,
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
    } catch (error: any) {
        console.error("S3 upload failed:", error);
        if (onLog) onLog(`S3 upload failed: ${error.message}`, 'error', 'storage', error.stack);
        return false;
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
        })).filter(f => f.name && f.size > 0); // Filter folders or empty keys
    } catch (error) {
        console.error("S3 list failed:", error);
        return [];
    }
}

async function s3Download(
    internalConfig: S3InternalConfig,
    remotePath: string,
    localPath: string,
    _onProgress?: (processed: number, total: number) => void,
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

        await pipeline(webStream, createWriteStream(localPath));
        return true;
    } catch (error) {
        console.error("S3 download failed:", error);
        return false;
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
        console.error("S3 delete failed:", error);
        return false;
    }
}

async function s3Test(internalConfig: S3InternalConfig): Promise<{ success: boolean; message: string }> {
    const client = S3ClientFactory.create(internalConfig);
    const testFile = `.backup-manager-test-${Date.now()}`;
    // Use target key logic to respect pathPrefix
    const targetKey = S3ClientFactory.getTargetKey(internalConfig, testFile);

    try {
        // 1. Try to write
        await client.send(new PutObjectCommand({
            Bucket: internalConfig.bucket,
            Key: targetKey,
            Body: "Database Backup Manager - Connection Test"
        }));

        // 2. Try to delete
        await client.send(new DeleteObjectCommand({
            Bucket: internalConfig.bucket,
            Key: targetKey
        }));

        return { success: true, message: "Connection successful (Write/Delete verified)" };
    } catch (error: any) {
        return { success: false, message: error.message || "Connection failed" };
    }
}


// --- Specific Adapters ---

// 1. Generic S3
export const S3GenericAdapter: StorageAdapter = {
    id: "s3-generic",
    type: "storage",
    name: "S3 Compatible (Generic)",
    configSchema: S3GenericSchema,
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
    }),
    read: (config, ...args) => s3Read({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle,
        pathPrefix: config.pathPrefix
    }, ...args)
};

// 2. AWS S3
export const S3AWSAdapter: StorageAdapter = {
    id: "s3-aws",
    type: "storage",
    name: "Amazon S3",
    configSchema: S3AWSSchema,
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
    delete: (config, ...args) => s3Delete({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    test: (config) => s3Test({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
    read: (config, ...args) => s3Read({
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args)
};

// 3. Cloudflare R2
export const S3R2Adapter: StorageAdapter = {
    id: "s3-r2",
    type: "storage",
    name: "Cloudflare R2",
    configSchema: S3R2Schema,
    upload: (config, ...args) => s3Upload({
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    list: (config, ...args) => s3List({
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args),
    download: (config, ...args) => s3Download({
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    delete: (config, ...args) => s3Delete({
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }, ...args),
    test: (config) => s3Test({
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
    read: (config, ...args) => s3Read({
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args)
};

// 4. Hetzner Object Storage
export const S3HetznerAdapter: StorageAdapter = {
    id: "s3-hetzner",
    type: "storage",
    name: "Hetzner Object Storage",
    configSchema: S3HetznerSchema,
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
    }),
    read: (config, ...args) => s3Read({
        endpoint: `https://${config.region}.your-objectstorage.com`,
        region: config.region,
        bucket: config.bucket,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        pathPrefix: config.pathPrefix
    }, ...args)
};
