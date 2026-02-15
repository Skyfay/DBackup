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
| WebDAV | `webdav` | WebDAV (Nextcloud, ownCloud, Apache, etc.) |
| FTP / FTPS | `ftp` | FTP with optional TLS encryption |
| Rsync (SSH) | `rsync` | Rsync over SSH (delta transfers) |
| Google Drive | `google-drive` | Google Drive via OAuth 2.0 |
| Dropbox | `dropbox` | Dropbox via OAuth 2.0 |
| OneDrive | `onedrive` | Microsoft OneDrive via OAuth 2.0 |

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

Adding a storage adapter requires changes across multiple layers: backend adapter, schema/definitions, UI integration, and RBAC. Follow **every** step below to avoid missing integration points.

::: info OAuth-Based Cloud Adapters
If your adapter requires browser-based OAuth authorization (like Google Drive, Dropbox, OneDrive), additional steps are needed beyond the standard checklist. See the [OAuth-specific steps](#oauth-specific-additional-steps) section below.
:::

### Step-by-Step Checklist

#### 1. Install dependency

```bash
pnpm add webdav
```

#### 2. Create Zod schema + type in `src/lib/adapters/definitions.ts`

```typescript
export const WebDAVSchema = z.object({
  url: z.string().url("Server URL is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().optional().describe("Password"),
  pathPrefix: z.string().optional().describe("Remote destination folder"),
});

export type WebDAVConfig = z.infer<typeof WebDAVSchema>;
```

Then update the `StorageConfig` union type and add an entry to the `ADAPTER_DEFINITIONS` array:

```typescript
export type StorageConfig = LocalStorageConfig | S3GenericConfig | ... | WebDAVConfig;

// In ADAPTER_DEFINITIONS:
{ id: "webdav", type: "storage", name: "WebDAV", configSchema: WebDAVSchema },
```

#### 3. Create adapter in `src/lib/adapters/storage/webdav.ts`

Implement the full `StorageAdapter` interface. All six methods are required:

```typescript
import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { WebDAVSchema } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "webdav" });

export const WebDAVAdapter: StorageAdapter = {
  id: "webdav",
  type: "storage",
  name: "WebDAV",
  configSchema: WebDAVSchema,

  async upload(config, localPath, remotePath, onProgress, onLog) { /* ... */ },
  async download(config, remotePath, localPath, onProgress, onLog) { /* ... */ },
  async read(config, remotePath) { /* ... */ },
  async list(config, dir) { /* ... */ },
  async delete(config, remotePath) { /* ... */ },
  async test(config) { /* ... */ },
};
```

::: tip read() method
The `read()` method is used by the Storage Explorer to read `.meta.json` sidecar files. If not implemented, the system falls back to download → read → delete, which is slower.
:::

::: tip test() method
The `test()` method is used for both manual connection tests and automatic health checks (online/offline status). It should perform a write + delete to verify full access.
:::

#### 4. Register adapter in `src/lib/adapters/index.ts`

```typescript
import { WebDAVAdapter } from "./storage/webdav";

// Inside registerAdapters():
registry.register(WebDAVAdapter);
```

#### 5. UI: Form field rendering (`src/components/adapter/form-constants.ts`)

The adapter form renders fields dynamically from the Zod schema. Fields are split into two tabs based on these arrays:

**Connection tab** — Add any new connection-related field keys your schema introduces:
```typescript
export const STORAGE_CONNECTION_KEYS = [
    'host', 'port',
    'endpoint', 'region',
    'accountId', 'bucket', 'basePath',
    'address', 'domain',             // ← SMB added these
    'user', 'username',
    'password', 'accessKeyId', 'secretAccessKey',
    'privateKey', 'passphrase'
];
```

**Configuration tab** — Add any new config-related field keys:
```typescript
export const STORAGE_CONFIG_KEYS = [
    'pathPrefix', 'storageClass', 'forcePathStyle',
    'maxProtocol',                    // ← SMB added this
    'options'
];
```

**Placeholders** — Add helpful placeholder values for your adapter's fields:
```typescript
export const PLACEHOLDERS: Record<string, string> = {
    // WebDAV
    "webdav.url": "https://nextcloud.example.com/remote.php/dav/files/user/",
    "webdav.username": "backupuser",
    "webdav.password": "secure-password",
    "webdav.pathPrefix": "backups/server1",
};
```

::: warning
If your schema introduces field keys that are not in either `STORAGE_CONNECTION_KEYS` or `STORAGE_CONFIG_KEYS`, those fields will **not appear** in the form UI. This is the most common issue when adding a new adapter.
:::

#### 6. UI: Adapter icon (`src/components/adapter/utils.ts`)

Add your adapter to the `getAdapterIcon()` function so it gets the correct Lucide icon:

```typescript
if (id.includes('webdav')) return Globe;
```

Available icons already imported: `Database`, `Folder`, `HardDrive`, `Network`, `MessageSquare`, `Mail`, `Disc`. Add a new import from `lucide-react` if needed.

#### 7. UI: Details column (`src/components/adapter/adapter-manager.tsx`)

Add a case to the `getSummary()` function to show a useful detail in the adapter table:

```typescript
case 'webdav':
    return <span className="text-muted-foreground">{config.pathPrefix || config.url}</span>;
```

Always use the `text-muted-foreground` class for consistency.

#### 8. RBAC: Permission regex (`src/app/api/adapters/`)

Two API routes use regex to map adapter IDs to permission groups. Add your adapter ID to the storage regex in **both** files:

- `src/app/api/adapters/test-connection/route.ts`
- `src/app/api/adapters/access-check/route.ts`

```typescript
} else if (/local-filesystem|s3|sftp|smb|webdav|ftp|rsync/i.test(adapterId)) {
    return PERMISSIONS.DESTINATIONS.READ;
}
```

::: warning
If your adapter ID is missing from this regex, the test-connection endpoint will skip RBAC permission checks for your adapter. Health checks may also behave unexpectedly.
:::

#### 9. Dockerfile (if CLI tools needed)

If your adapter depends on a system CLI tool (like `smbclient` for SMB), add it to the `Dockerfile`:

```dockerfile
RUN apk add --no-cache \
    # ... existing packages
    your-package \
```

#### 10. macOS dev setup script (if CLI tools needed)

Update `scripts/setup-dev-macos.sh` to install the CLI dependency:

```bash
echo "Installing YourTool..."
brew install your-package
```

### Integration Checklist Summary

| # | File | What to do |
| :--- | :--- | :--- |
| 1 | `package.json` | Install npm dependency |
| 2 | `src/lib/adapters/definitions.ts` | Zod schema, config type, `StorageConfig` union, `ADAPTER_DEFINITIONS` |
| 3 | `src/lib/adapters/storage/<name>.ts` | Full adapter implementation (6 methods) |
| 4 | `src/lib/adapters/index.ts` | Import + `registry.register()` |
| 5 | `src/components/adapter/form-constants.ts` | `STORAGE_CONNECTION_KEYS`, `STORAGE_CONFIG_KEYS`, `PLACEHOLDERS` |
| 6 | `src/components/adapter/utils.ts` | `getAdapterIcon()` mapping |
| 7 | `src/components/adapter/adapter-manager.tsx` | `getSummary()` case for details column |
| 8 | `src/app/api/adapters/test-connection/route.ts` | Add ID to storage permission regex |
| 9 | `src/app/api/adapters/access-check/route.ts` | Add ID to storage permission regex |
| 10 | `Dockerfile` | System CLI tools (if needed) |
| 11 | `scripts/setup-dev-macos.sh` | Local dev CLI setup (if needed) |
| 12 | `wiki/` | User guide + developer guide + changelog |

### OAuth-Specific Additional Steps

If the new adapter requires browser-based OAuth (e.g., Google Drive, Dropbox, OneDrive), these additional steps are needed on top of the standard checklist:

| # | File | What to do |
| :--- | :--- | :--- |
| 13 | `src/app/api/adapters/<name>/auth/route.ts` | OAuth authorization URL generation endpoint |
| 14 | `src/app/api/adapters/<name>/callback/route.ts` | OAuth callback — exchange code for tokens, store refresh token encrypted |
| 15 | `src/components/adapter/<name>-oauth-button.tsx` | OAuth button component with authorized/unauthorized status |
| 16 | `src/components/adapter/form-sections.tsx` | Special form layout: show OAuth button in connection tab, hide auto-managed fields (e.g., `refreshToken`) |
| 17 | `src/lib/crypto.ts` | Add OAuth secret fields to `SENSITIVE_KEYS` (e.g., `clientSecret`, `refreshToken`) |
| 18 | `src/app/api/system/filesystem/<name>/route.ts` | Folder browse API (if provider supports folder selection) |
| 19 | `src/components/adapter/<name>-folder-browser.tsx` | Folder browser dialog (if provider supports folder selection) |

**Reference implementations**: See the Google Drive, Dropbox, and OneDrive adapters for complete examples of this pattern:
- Storage adapters: `src/lib/adapters/storage/google-drive.ts`, `src/lib/adapters/storage/dropbox.ts`, `src/lib/adapters/storage/onedrive.ts`
- OAuth routes: `src/app/api/adapters/google-drive/`, `src/app/api/adapters/dropbox/`, and `src/app/api/adapters/onedrive/` (each with `auth/` + `callback/`)
- OAuth buttons: `src/components/adapter/google-drive-oauth-button.tsx`, `src/components/adapter/dropbox-oauth-button.tsx`, `src/components/adapter/onedrive-oauth-button.tsx`
- Folder browsers: `src/components/adapter/google-drive-folder-browser.tsx`, `src/components/adapter/dropbox-folder-browser.tsx`, `src/components/adapter/onedrive-folder-browser.tsx`
- Folder browse APIs: `src/app/api/system/filesystem/google-drive/route.ts`, `src/app/api/system/filesystem/dropbox/route.ts`, `src/app/api/system/filesystem/onedrive/route.ts`

## Related Documentation

- [Adapter System](/developer-guide/core/adapters)
- [Database Adapters](/developer-guide/adapters/database)
- [Notification Adapters](/developer-guide/adapters/notification)
