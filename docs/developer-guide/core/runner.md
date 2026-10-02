# Runner Pipeline

The Runner is the core engine that executes backups. It uses a **Pipeline Pattern** with discrete steps and a shared context.

## Architecture

```
runJob(jobId)
    │
    ▼
┌─────────────────────────────────────────┐
│           Queue Manager                  │
│   (FIFO queue, concurrency control)     │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│           Runner Pipeline               │
│                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │  Init   │─▶│  Dump   │─▶│ Upload  │ │
│  └─────────┘  └─────────┘  └─────────┘ │
│                    │             │      │
│              ┌─────▼─────┐      │      │
│              │ Compress  │      │      │
│              └─────┬─────┘      │      │
│                    │            │      │
│              ┌─────▼─────┐      │      │
│              │  Encrypt  │──────┘      │
│              └───────────┘             │
│                                         │
│  ┌─────────┐  ┌─────────┐              │
│  │Complete │◀─│Retention│              │
│  └─────────┘  └─────────┘              │
└─────────────────────────────────────────┘
```

## Runner Context

State flows through the pipeline via `RunnerContext`:

```typescript
// src/lib/runner/types.ts

// Per-destination context resolved at initialization
interface DestinationContext {
  configId: string;
  configName: string;
  adapter: StorageAdapter;
  config: Record<string, unknown>; // Decrypted adapter config
  retention: RetentionConfig;
  priority: number;
  uploadResult?: {
    success: boolean;
    path?: string;
    error?: string;
  };
}

interface RunnerContext {
  jobId: string;
  job?: JobWithRelations;      // Job with source, destinations, notifications
  execution?: Execution;

  // Logging
  logs: LogEntry[];
  log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;
  updateProgress: (percent: number, stage?: string) => void;

  // Resolved adapters
  sourceAdapter?: DatabaseAdapter;
  destinations: DestinationContext[]; // All destination adapters (sorted by priority)

  // File paths
  tempFile?: string;           // Local temporary dump file

  // Result data
  dumpSize?: number;
  metadata?: any;

  status: "Success" | "Failed" | "Running" | "Partial" | "Cancelled";
  startedAt: Date;
}
```

> **Partial status:** If some destinations succeed and others fail, the status is set to `"Partial"` instead of flat `"Failed"`. This allows the UI and notification system to distinguish between full and partial failures.

## Pipeline Steps

### Step 1: Initialize (`01-initialize.ts`)

Creates the execution record and resolves adapters.

```typescript
export async function stepInitialize(ctx: RunnerContext): Promise<void> {
  // Update execution status
  await prisma.execution.update({
    where: { id: ctx.execution.id },
    data: { status: "Running", startedAt: new Date() },
  });

  // Decrypt source credentials
  ctx.job.source.config = decryptConfig(ctx.job.source.config);

  // Resolve source adapter
  ctx.sourceAdapter = registry.get(ctx.job.source.adapter) as DatabaseAdapter;

  // Validate source connection
  const sourceTest = await ctx.sourceAdapter.test(ctx.job.source.config);
  if (!sourceTest.success) {
    throw new Error(`Source connection failed: ${sourceTest.message}`);
  }

  // Resolve ALL destination adapters (sorted by priority)
  for (const dest of ctx.job.destinations) {
    const decryptedConfig = decryptConfig(dest.config.config);
    const adapter = registry.get(dest.config.adapter) as StorageAdapter;
    const retention = JSON.parse(dest.retention || "{}");

    ctx.destinations.push({
      configId: dest.configId,
      configName: dest.config.name,
      adapter,
      config: decryptedConfig,
      retention,
      priority: dest.priority,
    });
  }

  ctx.log("Initialization complete");
}
```

> Each destination in `ctx.job.destinations` comes from the `JobDestination` join table (includes the `AdapterConfig` relation). The adapter, config, and retention are resolved per destination.

### Step 2: Dump (`02-dump.ts`)

Executes the database dump with optional compression and encryption.

```typescript
export async function stepDump(ctx: RunnerContext): Promise<void> {
  // Generate temp file path
  ctx.tempFile = path.join(os.tmpdir(), `backup-${Date.now()}.sql`);

  // Create processing pipeline
  const streams: Transform[] = [];

  // Add compression if enabled
  if (ctx.job.compression === "gzip") {
    streams.push(zlib.createGzip());
    ctx.tempFile += ".gz";
  } else if (ctx.job.compression === "brotli") {
    streams.push(zlib.createBrotliCompress());
    ctx.tempFile += ".br";
  }

  // Add encryption if enabled
  if (ctx.encryptionKey) {
    const { stream, iv, getAuthTag } = createEncryptionStream(ctx.encryptionKey);
    streams.push(stream);
    ctx.iv = iv;
    ctx.tempFile += ".enc";
    // Store authTag after stream ends
  }

  // Execute dump through pipeline
  const result = await ctx.sourceAdapter.dump(
    ctx.job.source.config,
    ctx.tempFile,
    streams
  );

  ctx.metadata.size = result.size;
  ctx.logs.push(...result.logs);
}
```

### Step 3: Upload (`03-upload.ts`)

Uploads the backup to **all destinations** sequentially (sorted by priority). The dump file is produced once-each destination receives the same file.

```typescript
export async function stepUpload(ctx: RunnerContext): Promise<void> {
  // Generate remote path (shared across all destinations)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = path.extname(ctx.tempFile!);
  const remotePath = `${ctx.job.name}/${ctx.job.name}_${timestamp}${extension}`;

  // Calculate SHA-256 checksum once
  const checksum = await calculateFileChecksum(ctx.tempFile!);
  ctx.log(`Checksum (SHA-256): ${checksum}`);

  // Build metadata object (shared)
  const metadata: BackupMetadata = { /* jobId, checksum, compression, encryption, etc. */ };

  // Sequential fan-out upload to each destination
  for (const dest of ctx.destinations) {
    try {
      ctx.log(`[${dest.configName}] Uploading backup...`);

      // Upload backup file
      await dest.adapter.upload(dest.config, ctx.tempFile!, remotePath);

      // Upload metadata sidecar
      await dest.adapter.upload(
        dest.config,
        JSON.stringify(metadata, null, 2),
        `${remotePath}.meta.json`
      );

      // Post-upload verification (local storage only)
      if (dest.config.adapterId === "local-filesystem") {
        // Download and verify checksum...
      }

      dest.uploadResult = { success: true, remotePath };
      ctx.log(`[${dest.configName}] Upload successful`);
    } catch (error) {
      dest.uploadResult = { success: false, error: getErrorMessage(error) };
      ctx.log(`[${dest.configName}] Upload FAILED: ${getErrorMessage(error)}`, "error");
    }
  }

  // Evaluate mixed results → Partial status
  const succeeded = ctx.destinations.filter(d => d.uploadResult?.success).length;
  const total = ctx.destinations.length;

  if (succeeded === 0) {
    ctx.status = "Failed";
  } else if (succeeded < total) {
    ctx.status = "Partial"; // Some succeeded, some failed
  }
  // If all succeeded, status stays "Running" (set to "Success" in performExecution)
}
```

> **Key design:** The dump/compress/encrypt pipeline runs only once. The resulting temp file is uploaded to each destination in order. If at least one succeeds but not all, the execution is marked `"Partial"`.

#### Air-gapped destinations

A destination with `airGapped: true` in its metadata (`isAirGapped` in `src/lib/core/air-gap.ts`, read into `DestinationContext.airGapped` by step 1) is connected only now and then. Right before its upload the step asks it with `isConnected` from `steps/air-gap.ts`, the `ping()` the health check uses. One that does not answer gets `uploadResult = { success: false, skipped: true }` and is no failure:

| Outcome | Status |
|---------|--------|
| Every other destination stored the backup | `Success` |
| A destination that answered failed its upload | `Partial` |
| No destination took the backup, skipped ones included | the step throws, `Failed` |

`reportSkippedAirGaps` then sends the `AIRGAP_SKIPPED` system event, once per time away: it keeps the time of its last report per destination under `airgap.skipped.state` and stays quiet until a `HealthCheckLog` of `ONLINE` is newer than that. Step 4 records a skipped destination with `status: "skipped"` and `airGapped: true`, which every page that counts copies leaves out, and step 5 leaves its retention for a later run. The chain planner treats one that does not answer as `away`, which never forces a full.

### Step 4: Completion (`04-completion.ts`)

Cleans up, finalizes the execution, sends notifications, and logs notification delivery.

```typescript
export async function stepCompletion(ctx: RunnerContext): Promise<void> {
  // Clean up temp file
  if (ctx.tempFile) {
    await fs.unlink(ctx.tempFile).catch(() => {});
  }

  // Update execution record
  await prisma.execution.update({
    where: { id: ctx.execution.id },
    data: {
      status: ctx.status,
      completedAt: new Date(),
      size: ctx.metadata.size,
      logs: ctx.logs,
    },
  });

  // Send notifications and log delivery
  if (ctx.job.notificationId) {
    for (const channel of ctx.job.notifications) {
      const adapter = registry.get(channel.adapterId);
      const payload = renderTemplate(event);

      // Generate adapter-specific rendered payload for preview
      const renderedPayload = generateRenderedPayload(channel.adapterId, payload);

      try {
        await adapter.send(config, payload.message, { title, fields, color });
        await recordNotificationLog({ ...entry, status: "success" });
      } catch (error) {
        await recordNotificationLog({ ...entry, status: "error", error: message });
      }
    }
  }

  ctx.logs.push("Backup completed successfully");
}
```

**Notification Logging:** Each notification send attempt is logged to `NotificationLog` with the full rendered payload (Discord embed, Slack blocks, email HTML) for preview on the History page. Logging is fire-and-forget and never blocks execution.

### Step 5: Retention (`05-retention.ts`)

Applies retention policy **per destination**. Each destination has its own independent retention config (None, Simple, or Smart/GFS).

```typescript
export async function stepRetention(ctx: RunnerContext): Promise<void> {
  for (const dest of ctx.destinations) {
    // Skip destinations where upload failed
    if (!dest.uploadResult?.success) {
      ctx.log(`[${dest.configName}] Skipping retention (upload failed)`);
      continue;
    }

    // Skip if no retention configured for this destination
    if (!dest.retention || dest.retention.mode === "NONE") continue;

    ctx.log(`[${dest.configName}] Applying ${dest.retention.mode} retention...`);

    // List existing backups in this destination
    const files = await dest.adapter.list(dest.config, ctx.job.name);
    const backups = files.filter(f =>
      f.name.startsWith(ctx.job.name) && !f.name.endsWith(".meta.json")
    );

    // Apply retention algorithm
    const result = await RetentionService.applyRetention(backups, dest.retention);

    // Delete old backups
    for (const file of result.delete) {
      if (file.locked) continue;
      await dest.adapter.delete(dest.config, `${ctx.job.name}/${file.name}`);
      await dest.adapter.delete(dest.config, `${ctx.job.name}/${file.name}.meta.json`).catch(() => {});
    }

    ctx.log(`[${dest.configName}] Retention: Kept ${result.keep.length}, deleted ${result.delete.length}`);
  }
}
```

> Each destination can have a completely different retention strategy-e.g., keep 30 daily backups locally but only 12 monthly backups in cloud storage.

## Queue Manager

Controls concurrent backup execution:

```typescript
// src/lib/execution/queue-manager.ts
class QueueManager {
  private queue: string[] = [];
  private running = 0;

  async enqueue(executionId: string): Promise<void> {
    this.queue.push(executionId);
    await this.processQueue();
  }

  private async processQueue(): Promise<void> {
    const maxConcurrent = await this.getMaxConcurrent();

    while (this.queue.length > 0 && this.running < maxConcurrent) {
      const executionId = this.queue.shift()!;
      this.running++;

      // Run in background (don't await)
      this.executeBackup(executionId)
        .finally(() => {
          this.running--;
          this.processQueue();
        });
    }
  }

  private async getMaxConcurrent(): Promise<number> {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "maxConcurrentJobs" },
    });
    return setting?.value ? parseInt(setting.value) : 1;
  }
}
```

## Error Handling

The runner wraps all steps in error handling:

```typescript
// src/lib/runner.ts
export async function performExecution(executionId: string): Promise<void> {
  const ctx = await createContext(executionId);
  // ctx.destinations is initialized as []

  try {
    await stepInitialize(ctx);
    await stepDump(ctx);
    await stepUpload(ctx);

    // Preserve "Partial" if set by upload step (some destinations failed)
    if (ctx.status === "Running") {
      ctx.status = "Success";
    }
  } catch (error) {
    ctx.status = "Failed";
    ctx.log(`Error: ${getErrorMessage(error)}`, "error");
    throw error;
  } finally {
    await stepCompletion(ctx);
    await stepRetention(ctx).catch(e => {
      log.error("Retention failed", {}, wrapError(e));
    });
  }
}
```

> **Important:** The upload step may set `ctx.status = "Partial"` during its fan-out loop. The `performExecution` function only sets `"Success"` if the status is still `"Running"` (i.e., no partial failures occurred).

## Streaming Architecture

For large databases, the runner uses streams to avoid loading everything into memory:

```typescript
// Dump → Compress → Encrypt → Upload
const dumpStream = adapter.createDumpStream(config);
const gzipStream = zlib.createGzip();
const encryptStream = createEncryptionStream(key);
const uploadStream = storage.createUploadStream(path);

pipeline(
  dumpStream,
  gzipStream,
  encryptStream,
  uploadStream
);
```

## Checksum Verification

The runner pipeline includes SHA-256 checksum verification at multiple points to ensure data integrity:

### Backup Flow

1. **After pipeline**: SHA-256 checksum is calculated on the final backup file (after compression + encryption)
2. **Metadata storage**: Checksum is stored in the `.meta.json` sidecar file
3. **Post-upload verification (local storage only)**: For local filesystem destinations, the uploaded file is re-downloaded and its checksum verified. Remote storage (S3, SFTP) relies on transport-level integrity (e.g. S3 Content-MD5, SSH checksums) to avoid costly re-downloads of large files

### Restore Flow

The `RestoreService` verifies checksums before processing:

1. **After download**: The downloaded backup file's checksum is compared against the stored value in metadata
2. **Mismatch handling**: If the checksum doesn't match, the restore is immediately aborted with an error
3. **Missing checksum**: If no checksum exists in metadata (older backups), verification is skipped with a log message

### Utility Functions

```typescript
// src/lib/crypto/checksum.ts
import { calculateFileChecksum, verifyFileChecksum } from "@/lib/crypto/checksum";

// Calculate SHA-256 hash of a file (stream-based, memory-efficient)
const hash = await calculateFileChecksum("/path/to/backup.sql.gz.enc");
// Returns: "a1b2c3d4e5f6..."

// Verify a file against an expected checksum
const result = await verifyFileChecksum("/path/to/file", expectedHash);
// Returns: { valid: boolean, actual: string, expected: string }
```

### Periodic Integrity Checks

The `IntegrityService` provides a system task (`system.integrity_check`) that verifies all backups across all storage destinations. See [Service Layer](services.md) for details.

## Live Progress

The runner broadcasts progress via polling:

```typescript
// Update progress during dump
async function updateProgress(executionId: string, bytes: number) {
  await prisma.execution.update({
    where: { id: executionId },
    data: {
      progress: bytes,
      updatedAt: new Date()
    },
  });
}
```

The UI polls for updates:

```typescript
// Frontend polling
useEffect(() => {
  const interval = setInterval(async () => {
    const execution = await fetchExecution(id);
    setProgress(execution.progress);
  }, 1000);

  return () => clearInterval(interval);
}, [id]);
```

## Related Documentation

- [Service Layer](/developer-guide/core/services)
- [Retention System](/developer-guide/advanced/retention)
- [Encryption Pipeline](/developer-guide/advanced/encryption)
- Checksum Utility (`src/lib/crypto/checksum.ts`)
