# Storage Adapters

Storage adapters handle file operations: upload, download, list, and delete.

## Available Adapters

| Adapter | ID | Description |
| :--- | :--- | :--- |
| Local | `local-filesystem` | Local filesystem |
| S3 Generic | `s3-generic` | Any S3-compatible storage |
| AWS S3 | `s3-aws` | Amazon S3 |
| Cloudflare R2 | `s3-r2` | Cloudflare R2 |
| Hetzner | `s3-hetzner` | Hetzner Object Storage |
| SFTP | `sftp` | SSH File Transfer |
| SMB | `smb` | SMB/CIFS network shares |

## Interface

```typescript
interface StorageAdapter {
  id: string;
  type: "storage";
  name: string;
  configSchema: ZodSchema;

  // Core operations
  upload(
    config: unknown,
    localPath: string,
    remotePath: string,
    onProgress?: (percent: number) => void,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
  ): Promise<boolean>;

  download(
    config: unknown,
    remotePath: string,
    localPath: string,
    onProgress?: (processed: number, total: number) => void,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
  ): Promise<boolean>;

  list(config: unknown, path: string): Promise<FileInfo[]>;
  delete(config: unknown, path: string): Promise<boolean>;

  // Connection test
  test(config: unknown): Promise<TestResult>;

  // Optional: Read small files (for metadata)
  read?(config: unknown, path: string): Promise<string | null>;
}
```

## FileInfo Interface

```typescript
interface FileInfo {
  name: string;           // Filename only
  path: string;           // Full path
  size: number;           // Size in bytes
  lastModified: Date;     // Last modified
  locked?: boolean;       // Locked from deletion
}
```

## Local Adapter

Simple filesystem operations:

```typescript
const LocalAdapter: StorageAdapter = {
  id: "local-filesystem",
  type: "storage",
  name: "Local Storage",
  configSchema: LocalStorageSchema,

  async upload(config, localPath, remotePath) {
    const validated = LocalSchema.parse(config);
    const fullPath = path.join(validated.basePath, remotePath);

    // Ensure directory exists
    await mkdir(path.dirname(fullPath), { recursive: true });

    // Copy file
    await copyFile(localPath, fullPath);
  },

  async download(config, remotePath, localPath) {
    const validated = LocalSchema.parse(config);
    const fullPath = path.join(validated.basePath, remotePath);
    await copyFile(fullPath, localPath);
  },

  async list(config, dirPath) {
    const validated = LocalSchema.parse(config);
    const fullPath = path.join(validated.basePath, dirPath);

    const entries = await readdir(fullPath, { withFileTypes: true });

    return Promise.all(
      entries.map(async (entry) => {
        const stats = await stat(path.join(fullPath, entry.name));
        return {
          name: entry.name,
          path: path.join(dirPath, entry.name),
          size: stats.size,
          modifiedAt: stats.mtime,
          isDirectory: entry.isDirectory(),
        };
      })
    );
  },

  async delete(config, filePath) {
    const validated = LocalSchema.parse(config);
    const fullPath = path.join(validated.basePath, filePath);
    await unlink(fullPath);
  },

  async test(config) {
    const validated = LocalSchema.parse(config);

    try {
      await access(validated.basePath);
      return { success: true, message: "Path accessible" };
    } catch {
      return { success: false, message: "Path not accessible" };
    }
  },

  async read(config, filePath) {
    const validated = LocalSchema.parse(config);
    const fullPath = path.join(validated.basePath, filePath);
    return readFile(fullPath, "utf-8");
  },
};
```

## S3 Adapter

Uses AWS SDK for S3-compatible storage:

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const S3Adapter: StorageAdapter = {
  id: "s3-generic",
  type: "storage",
  name: "S3 Compatible",
  configSchema: S3GenericSchema,

  async upload(config, localPath, remotePath) {
    const validated = S3Schema.parse(config);
    const client = createS3Client(validated);

    const fileStream = createReadStream(localPath);

    // Use multipart upload for large files
    const upload = new Upload({
      client,
      params: {
        Bucket: validated.bucket,
        Key: remotePath,
        Body: fileStream,
      },
    });

    await upload.done();
  },

  async download(config, remotePath, localPath) {
    const validated = S3Schema.parse(config);
    const client = createS3Client(validated);

    const response = await client.send(
      new GetObjectCommand({
        Bucket: validated.bucket,
        Key: remotePath,
      })
    );

    const fileStream = createWriteStream(localPath);
    await pipeline(response.Body as Readable, fileStream);
  },

  async list(config, prefix) {
    const validated = S3Schema.parse(config);
    const client = createS3Client(validated);

    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: validated.bucket,
        Prefix: prefix,
      })
    );

    return (response.Contents || []).map((item) => ({
      name: path.basename(item.Key!),
      path: item.Key!,
      size: item.Size || 0,
      modifiedAt: item.LastModified || new Date(),
      isDirectory: false,
    }));
  },

  async delete(config, filePath) {
    const validated = S3Schema.parse(config);
    const client = createS3Client(validated);

    await client.send(
      new DeleteObjectCommand({
        Bucket: validated.bucket,
        Key: filePath,
      })
    );
  },

  async test(config) {
    const validated = S3Schema.parse(config);
    const client = createS3Client(validated);

    try {
      await client.send(
        new ListObjectsV2Command({
          Bucket: validated.bucket,
          MaxKeys: 1,
        })
      );
      return { success: true, message: "S3 connection successful" };
    } catch (error) {
      return { success: false, message: `S3 error: ${error}` };
    }
  },

  async read(config, filePath) {
    const validated = S3Schema.parse(config);
    const client = createS3Client(validated);

    const response = await client.send(
      new GetObjectCommand({
        Bucket: validated.bucket,
        Key: filePath,
      })
    );

    return response.Body!.transformToString();
  },
};

function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: config.forcePathStyle,
  });
}
```

## SFTP Adapter

Uses `ssh2-sftp-client` for SSH file transfers:

```typescript
import SftpClient from "ssh2-sftp-client";

const SFTPAdapter: StorageAdapter = {
  id: "sftp",
  type: "storage",
  name: "SFTP",
  configSchema: SFTPSchema,

  async upload(config, localPath, remotePath) {
    const validated = SFTPSchema.parse(config);
    const sftp = new SftpClient();

    try {
      await sftp.connect({
        host: validated.host,
        port: validated.port,
        username: validated.username,
        password: validated.password,
        privateKey: validated.privateKey,
      });

      const fullPath = path.join(validated.basePath || "", remotePath);

      // Ensure directory exists
      await sftp.mkdir(path.dirname(fullPath), true);

      // Upload file
      await sftp.put(localPath, fullPath);
    } finally {
      await sftp.end();
    }
  },

  async download(config, remotePath, localPath) {
    const validated = SFTPSchema.parse(config);
    const sftp = new SftpClient();

    try {
      await sftp.connect(/* ... */);
      const fullPath = path.join(validated.basePath || "", remotePath);
      await sftp.get(fullPath, localPath);
    } finally {
      await sftp.end();
    }
  },

  async list(config, dirPath) {
    const validated = SFTPSchema.parse(config);
    const sftp = new SftpClient();

    try {
      await sftp.connect(/* ... */);
      const fullPath = path.join(validated.basePath || "", dirPath);
      const entries = await sftp.list(fullPath);

      return entries.map((entry) => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        size: entry.size,
        modifiedAt: new Date(entry.modifyTime),
        isDirectory: entry.type === "d",
      }));
    } finally {
      await sftp.end();
    }
  },

  async test(config) {
    const validated = SFTPSchema.parse(config);
    const sftp = new SftpClient();

    try {
      await sftp.connect(/* ... */);
      await sftp.list(validated.basePath || "/");
      return { success: true, message: "SFTP connection successful" };
    } catch (error) {
      return { success: false, message: `SFTP error: ${error}` };
    } finally {
      await sftp.end();
    }
  },
};
```

## The `read()` Method

The optional `read()` method is crucial for the Storage Explorer. It allows reading small text files (like `.meta.json`) without downloading to disk:

```typescript
async read(config, path) {
  // Returns file content as string
  return "{ \"jobName\": \"daily-backup\", ... }";
}
```

If not implemented, the system falls back to:
1. Download to temp file
2. Read temp file
3. Delete temp file

## Streaming Support

For large files, implement streaming methods:

```typescript
createUploadStream(config, remotePath): Writable {
  const validated = S3Schema.parse(config);
  // Return a writable stream that uploads to S3
  return new PassThrough();
}

createDownloadStream(config, remotePath): Readable {
  const validated = S3Schema.parse(config);
  // Return a readable stream from S3
  return response.Body as Readable;
}
```

## Adding a New Storage Adapter

### Example: WebDAV Adapter

1. **Install dependency**:
   ```bash
   pnpm add webdav
   ```

2. **Create schema** in `definitions.ts`:
   ```typescript
   export const WebDAVSchema = z.object({
     url: z.string().url(),
     username: z.string().min(1),
     password: z.string().min(1),
     basePath: z.string().default("/"),
   });
   ```

3. **Create adapter** in `src/lib/adapters/storage/webdav.ts`:
   ```typescript
   import { createClient } from "webdav";

   export const WebDAVAdapter: StorageAdapter = {
     id: "webdav",
     type: "storage",
     name: "WebDAV",
     configSchema: WebDAVSchema,

     async upload(config, localPath, remotePath) {
       const client = createClient(config.url, {
         username: config.username,
         password: config.password,
       });

       const content = await readFile(localPath);
       await client.putFileContents(
         path.join(config.basePath, remotePath),
         content
       );
     },

     // ... implement other methods
   };
   ```

4. **Register** in `src/lib/adapters/index.ts`

5. **Test** with a real WebDAV server (e.g., Nextcloud)

## Related Documentation

- [Adapter System](/developer-guide/core/adapters)
- [Database Adapters](/developer-guide/adapters/database)
- [Notification Adapters](/developer-guide/adapters/notification)
