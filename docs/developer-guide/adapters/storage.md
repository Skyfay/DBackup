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
| Docker Volumes | `docker-volume` | Docker volume contents. Directory source only - see below |

## Roles

A storage config is either a backup destination or a directory source, never both. That is
normally the user's choice, because most storage serves either end equally well. An adapter
that only works one way round declares it on its **definition**, not on the runtime adapter:

```typescript
{
  id: "docker-volume", type: "storage", group: "Containers", name: "Docker Volumes",
  supportedRoles: [STORAGE_ROLES.SOURCE],
  configSchema: DockerVolumeSchema,
}
```

It lives on the definition because the role picker runs in the browser, and definitions are
plain data - importing the runtime adapters there would pull ssh2 and the cloud SDKs into
the client bundle. `validateStorageRole` enforces it on all three write paths: create,
update, and clone, the last of which exists specifically to produce a config with the
opposite role.

## Preparing a source before it is read

Some sources cannot be read as they are. A Docker volume is only reachable from inside a
container, and an SMB share can offer a point-in-time shadow copy instead of a live tree.
Both go through the same three optional members:

```typescript
supportsSnapshot?(config, remotePath): Promise<{ supported: boolean; message: string }>;
createSnapshot?(config, remotePaths: string[], options?): Promise<SnapshotHandle>;
releaseSnapshot?(config, handle): Promise<void>;

/** Prepare unconditionally, rather than only when the config asks for it. */
alwaysSnapshot?: true;

/** Group this adapter's sources so shared preparation happens once. */
planSourceGroups?(config, remotePaths: string[]): Promise<string[][]>;
```

The handle's `configOverride` is merged onto the config the collection reads through, which
is how a prepared source hands its state to `downloadDirectory` without the runner knowing a
connection exists.

`planSourceGroups` exists for preparation that reaches beyond the source itself. Backing up
a container volume means stopping the containers holding it, two volumes of one container
must stop it once rather than twice, and a container whose volumes are done should start
again without waiting out the rest of the job. The runner collects each returned group in
turn and releases it as soon as the group is finished - which is why an adapter without this
member behaves exactly as it always did, with one source per group.

The returned partition has to cover the given paths exactly once. A dropped path is a
directory missing from a backup that would otherwise report success, so the runner refuses
it before anything is collected.

## Keeping a library at arm's length

`storage/docker/` is worth reading as a pattern for an adapter built on a client library.
Everything above `engine/dockerode-engine.ts` speaks volumes and containers; that one file
speaks dockerode, and a lint guard holds the line. The point is not a second implementation
- there will not be one - but that the grouping, the container bookkeeping and the crash
recovery are testable against a fake with fourteen methods instead of a mock reproducing
`getVolume(...).remove()`.

## Interface

```typescript
interface StorageAdapter {
  id: string;
  type: "storage";
  name: string;

  // Core operations
  upload(
    config: unknown,
    localPath: string,
    remotePath: string,
    onProgress?: (percent: number) => void,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    options?: UploadOptions
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

  // Connection tests
  test?(config: unknown): Promise<TestResult>;  // Full write/delete test (~15 s timeout)
  ping?(config: unknown): Promise<TestResult>;  // Lightweight check — no test file written

  // Optional: native checksum verification (avoids full re-download)
  // Implemented by: S3, Google Drive, OneDrive
  verifyChecksum?(
    config: unknown,
    remotePath: string,
    checksums: { sha256?: string; md5?: string }
  ): Promise<boolean>;

  // Optional: persistent session for multiple uploads in one job run
  // Avoids reconnecting for each destination file
  openSession?(
    config: unknown,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
  ): Promise<StorageSession>;

  // Optional: read small files directly (used for .meta.json sidecar retrieval)
  read?(config: unknown, path: string): Promise<string | null>;
}
```

::: info No `configSchema` on the adapter
The Zod schema lives in `src/lib/adapters/definitions/storage.ts`, registered in `ADAPTER_DEFINITIONS`. It is not a property on the adapter instance.
:::

::: tip `ping()` vs `test()`
`ping()` is used by the health check system (every minute) — it must be fast and must not write any files to storage. `test()` is used for manual "Test Connection" clicks and may write and delete a test file (~15 s timeout). If `ping()` is not implemented, the health check falls back to `test()`.
:::

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
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

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

The adapter form renders fields dynamically from the Zod schema and splits them into parts, listed on the left of the dialog. The layout comes from `storage-form-layout.ts`, which reads these arrays:

**Connection part** - Add any new connection-related field keys your schema introduces. Keys a credential profile fills in, like `username` or `accessKeyId`, are hidden automatically:
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

**Location and Options parts** - Add any new config-related field keys. The keys also listed in `STORAGE_LOCATION_KEYS` go to the **Location** part, the rest and `STORAGE_ADVANCED_KEYS` to **Options**:
```typescript
export const STORAGE_CONFIG_KEYS = [
    'pathPrefix', 'storageClass', 'forcePathStyle',
    'maxProtocol',                    // ← SMB added this
    'options'
];
```

**Placeholders** - Add helpful placeholder values for your adapter's fields:
```typescript
export const PLACEHOLDERS: Record<string, string> = {
    // WebDAV
    "webdav.url": "https://nextcloud.example.com/remote.php/dav/files/user/",
    "webdav.username": "backupuser",
    "webdav.password": "secure-password",
    "webdav.pathPrefix": "backups/server1",
};
```

::: tip
A key your schema introduces that no array names still shows up, in the **Options** part, so a new field is never invisible. List it anyway when it belongs in the Connection or Location part, or when its position matters.
:::

The parts that depend on the role are added by the layout itself: **Speed** holds parallel transfers for a directory source and the parallel upload parts for a destination with `multipartUpload`, and **Behavior** holds the role, the health alerts and, for a destination, the integrity checks.

#### 6. UI: Adapter icon (`src/components/adapter/utils.ts`)

Add a bundled Iconify icon for your adapter. See the [Icon System](/developer-guide/core/icons) guide for full details.

1. Import the icon data (prefer **SVG Logos**, fall back to **Simple Icons** or **Lucide**):

```typescript
import myBrandIcon from "@iconify-icons/logos/my-brand-icon";
```

2. Add it to `ADAPTER_ICON_MAP`:

```typescript
"my-adapter": myBrandIcon,
```

3. If using Simple Icons (monochrome), also add a brand color to `ADAPTER_COLOR_MAP`.

#### 7. UI: Location column (`src/components/adapter/connection-summary.ts`)

Add a case to `connectionAddress()` so the Location column of the connection table shows where the adapter points:

```typescript
case "webdav":
    return text(config.pathPrefix) || text(config.url) || null;
```

Return a plain string. The table styles it, and `null` shows a dash.

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
| 5 | `src/components/adapter/form-constants.ts` | `STORAGE_CONNECTION_KEYS`, `STORAGE_CONFIG_KEYS`, `STORAGE_LOCATION_KEYS`, `PLACEHOLDERS` |
| 6 | `src/components/adapter/utils.ts` | `ADAPTER_ICON_MAP` + optional `ADAPTER_COLOR_MAP` ([Icon System](/developer-guide/core/icons)) |
| 7 | `src/components/adapter/connection-summary.ts` | `connectionAddress()` case for the Location column |
| 8 | `src/app/api/adapters/test-connection/route.ts` | Add ID to storage permission regex |
| 9 | `src/app/api/adapters/access-check/route.ts` | Add ID to storage permission regex |
| 10 | `Dockerfile` | System CLI tools (if needed) |
| 11 | `scripts/setup-dev-macos.sh` | Local dev CLI setup (if needed) |
| 12 | `docs/` | User guide + developer guide + changelog |

### OAuth-Specific Additional Steps

If the new adapter requires browser-based OAuth (e.g., Google Drive, Dropbox, OneDrive), these additional steps are needed on top of the standard checklist:

| # | File | What to do |
| :--- | :--- | :--- |
| 13 | `src/app/api/adapters/<name>/auth/route.ts` | OAuth authorization URL generation endpoint |
| 14 | `src/app/api/adapters/<name>/callback/route.ts` | OAuth callback - exchange code for tokens, store refresh token encrypted |
| 15 | `src/components/adapter/oauth-authorization.tsx` | An entry in `PROVIDERS` with the drive's name, whose sign-in page opens and the segment of its routes. An adapter whose primary credential is `OAUTH` gets the authorization box and the Location folder field on its own. |
| 16 | `src/components/adapter/cloud-folder-field.tsx` | Render the provider's folder browser, if it has one |
| 17 | `src/lib/crypto.ts` | Add OAuth secret fields to `SENSITIVE_KEYS` (e.g., `clientSecret`, `refreshToken`) |
| 18 | `src/app/api/system/filesystem/<name>/route.ts` | Folder browse API (if provider supports folder selection) |
| 19 | `src/components/adapter/<name>-folder-browser.tsx` | Folder browser dialog (if provider supports folder selection) |

**Reference implementations**: See the Google Drive, Dropbox, and OneDrive adapters for complete examples of this pattern:
- Storage adapters: `src/lib/adapters/storage/google-drive.ts`, `src/lib/adapters/storage/dropbox.ts`, `src/lib/adapters/storage/onedrive.ts`
- OAuth routes: `src/app/api/adapters/google-drive/`, `src/app/api/adapters/dropbox/`, and `src/app/api/adapters/onedrive/` (each with `auth/` + `callback/`)
- OAuth authorization: `src/components/adapter/oauth-authorization.tsx`, one component for all three providers
- Folder browsers: `src/components/adapter/google-drive-folder-browser.tsx`, `src/components/adapter/dropbox-folder-browser.tsx`, `src/components/adapter/onedrive-folder-browser.tsx`
- Folder browse APIs: `src/app/api/system/filesystem/google-drive/route.ts`, `src/app/api/system/filesystem/dropbox/route.ts`, `src/app/api/system/filesystem/onedrive/route.ts`

## Related Documentation

- [Adapter System](/developer-guide/core/adapters)
- [Database Adapters](/developer-guide/adapters/database)
- [Notification Adapters](/developer-guide/adapters/notification)
