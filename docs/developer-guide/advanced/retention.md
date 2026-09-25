# Retention System

The Retention System automatically manages backup storage by implementing smart rotation policies based on the Grandfather-Father-Son (GFS) algorithm.

## Overview

DBackup supports three retention modes:

| Mode | Description |
| :--- | :--- |
| **None** | Keep all backups (no deletion) |
| **Simple** | Keep the last N backups |
| **Smart (GFS)** | Grandfather-Father-Son strategy |

## Grandfather-Father-Son (GFS)

The GFS algorithm keeps backups at decreasing frequencies as they age:

```
Now ←─ Hourly ─→ Daily ────→ Weekly ────→ Monthly ────→ Yearly
    ←─ 24 hours ─→ 7 days ─→ 4 weeks ───→ 12 months ──→ ∞
```

### Example Configuration

```json
{
  "mode": "SMART",
  "smart": {
    "hourly": 24,   // Keep last 24 hourly backups (optional)
    "daily": 7,     // Keep 7 further daily backups
    "weekly": 4,    // Keep 4 further weekly backups
    "monthly": 6,   // Keep 6 further monthly backups
    "yearly": 2     // Keep 2 further yearly backups
  }
}
```

### How Selection Works

Tiers run finest first over the file list sorted newest to oldest. Each tier keeps the first file it sees in a bucket it has not covered yet, which is the newest backup of that bucket.

1. **Hourly**: most recent backup from each of the last N hours
2. **Daily**: most recent backup from each of the next N days
3. **Weekly**: most recent backup from each of the next N weeks
4. **Monthly**: most recent backup from each of the next N months
5. **Yearly**: most recent backup from each of the next N years

**The tiers are additive, not overlapping.** `applyTier` seeds its bucket set from everything earlier tiers already kept and counts only its own additions against its limit. `daily: 7` therefore means seven days beyond what the hourly tier covers, and the total kept is the sum of the tiers. restic and borg evaluate the same numbers as a union, so an identical config keeps fewer backups there.

Bucket keys are built with `formatInTimeZone` against the `system.timezone` setting, so a day boundary is local midnight. The hourly key is `yyyy-MM-dd-HH`, which collapses the repeated hour of a daylight saving change into one bucket once a year.

### Which time a file is bucketed by

`effectiveBackupTime()` in `src/lib/core/backup-files.ts` is the single rule, used by both the sort and the bucket key:

```typescript
file.backupTimestamp ?? file.lastModified
```

`lastModified` is whatever the adapter's `list()` reports, so an S3 `LastModified`, an SFTP `modifyTime`, a local `stats.mtime`. It is not a reliable statement about when the backup was taken. Copying a destination without preserving timestamps, moving it between servers or restoring the backup directory itself resets every mtime to now, at which point the whole history lands in one bucket and a single representative survives the next pass.

`backupTimestamp` comes from `timestamp` in the backup's `.meta.json`, written at upload in `03-upload.ts`, and survives all of that. It is left unset when the sidecar is missing, unreadable or carries an unparsable date, so the mtime stays the fallback rather than the rule. The filename is never parsed, even though the naming template puts a date in it.

`05-retention.ts` reports how many backups supplied their own time and warns by name for each one whose two times differ by more than `TIMESTAMP_DRIFT_WARNING_MS`.

### Reading the sidecars

`loadBackupSidecars()` in `src/lib/runner/steps/retention-sidecars.ts` annotates the listed files with `locked`, `chainId`, `jobId` and `backupTimestamp`. It runs once per destination at the end of every successful job, over every backup present, so its round trip count is the dominant cost of the whole step.

Two things keep that bounded:

- **Sidecars absent from the listing are never requested.** `list()` returns sidecars, they are only filtered out afterwards, so their presence can be answered from the listing for free. The optimisation disables itself when a listing contains no sidecars at all, otherwise an adapter that filters them would silently lose lock and chain detection.
- **Reads run in batches of `adapter.readConcurrency`.** Unset means serial, which is what every adapter did before the field existed. Only adapters whose `read()` is a stateless HTTP request or a local file access declare `STATELESS_READ_CONCURRENCY`, currently S3, WebDAV, Dropbox, Google Drive, OneDrive and Local.

FTP, SMB, SFTP and rsync deliberately declare nothing. FTP dials a control connection per `read()` and its own upload path runs at `limit: concurrency ?? 1` for exactly that reason, SMB spawns an `smbclient` process per call, and the two SSH-based adapters already gate themselves at four channels. On those the server's connection count is what breaks first, not the bandwidth.

### Backups of another job

`05-retention.ts` hands the policy only the backups whose `jobId` is the running job's or unknown. The folder is named after the job, so a job named like a deleted one lists the backups the deleted job left there, and without the check its policy would count them and delete them. A backup without a sidecar, with an unreadable one or without a `jobId` keeps counting as the job's own, so the check only ever keeps more than before. The Storage Explorer and the retention preview of its timeline group backups by the same `jobId`.

### Tier limits and backwards compatibility

`hourly` is optional on `SmartRetentionPolicy` because every policy written before the tier existed has no value for it. Two places turn that into a disabled tier:

- `applySmartPolicy` destructures with `const { hourly = 0, ... }`
- `applyTier` guards with `if (!limit || limit <= 0) return;`

The guard cannot be written as `limit <= 0` alone. `undefined <= 0` evaluates to `false` in JavaScript, so the tier would run with `keptInTier >= undefined` never true, keep one backup per bucket for the whole history, and silently stop deleting anything.

`calculateRetention` also returns the full keep list when a mode carries no usable settings. Without that branch nothing marks a file as kept and every unlocked backup on the destination ends up in the delete list.

## Data Model

### Job Configuration

```prisma
model Job {
  // ...
  retention Json @default("{}")
}
```

### TypeScript Interface

```typescript
// src/lib/core/retention.ts
export type RetentionMode = "NONE" | "SIMPLE" | "SMART";

export interface RetentionConfiguration {
  mode: RetentionMode;
  simple?: {
    keepCount: number;
  };
  smart?: {
    hourly?: number;   // optional, absent counts as 0
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  };
}
```

`RetentionConfigurationSchema` in the same file validates a config before `retention-policy-service.ts` stores it. Tier limits are coerced to non negative integers, so a value written through the API cannot reach the bucketing logic malformed.

## RetentionService Implementation

The core logic lives in `src/services/retention-service.ts`:

```typescript
export const RetentionService = {
  calculateRetention(
    files: FileInfo[],
    config: RetentionConfiguration
  ): RetentionResult {
    // 1. Separate locked files (always kept)
    const { locked, unlocked } = this.separateLocked(files);

    // 2. Sort by date (newest first)
    const sorted = unlocked.sort(
      (a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()
    );

    // 3. Apply policy
    let keep: FileInfo[];

    switch (config.mode) {
      case "NONE":
        keep = sorted;
        break;
      case "SIMPLE":
        keep = sorted.slice(0, config.simple!.keepCount);
        break;
      case "SMART":
        keep = this.applyGFS(sorted, config.smart!);
        break;
    }

    // 4. Calculate deletions
    const keepSet = new Set(keep.map(f => f.name));
    const toDelete = sorted.filter(f => !keepSet.has(f.name));

    return {
      keep: [...locked, ...keep],
      delete: toDelete,
    };
  },

  applyGFS(files: FileInfo[], config: SmartConfig): FileInfo[] {
    const keep = new Set<string>();

    // Daily buckets
    this.selectForPeriod(files, config.daily, "day", keep);

    // Weekly buckets
    this.selectForPeriod(files, config.weekly, "week", keep);

    // Monthly buckets
    this.selectForPeriod(files, config.monthly, "month", keep);

    // Yearly buckets
    this.selectForPeriod(files, config.yearly, "year", keep);

    return files.filter(f => keep.has(f.name));
  },

  selectForPeriod(
    files: FileInfo[],
    count: number,
    period: "day" | "week" | "month" | "year",
    keep: Set<string>
  ): void {
    const buckets = new Map<string, FileInfo>();

    for (const file of files) {
      const key = this.getBucketKey(file.modifiedAt, period);

      // Keep newest file per bucket
      if (!buckets.has(key)) {
        buckets.set(key, file);
      }
    }

    // Select most recent N buckets
    const sorted = [...buckets.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, count);

    for (const [, file] of sorted) {
      keep.add(file.name);
    }
  },

  getBucketKey(date: Date, period: string): string {
    const year = date.getFullYear();
    const month = date.getMonth();
    const week = getWeekNumber(date);
    const day = date.getDate();

    switch (period) {
      case "day":
        return `${year}-${month}-${day}`;
      case "week":
        return `${year}-W${week}`;
      case "month":
        return `${year}-${month}`;
      case "year":
        return `${year}`;
    }
  },
};
```

## Backup Locking

Users can lock important backups to prevent automatic deletion.

### How It Works

1. Lock status is stored in the `.meta.json` sidecar file:
   ```json
   {
     "jobName": "daily-backup",
     "locked": true
   }
   ```

2. Locked files are excluded from retention calculation

3. They don't count against retention limits (e.g., if you keep 5 and have 2 locked, you end up with 7)

### Toggle Lock Flow

```typescript
async function toggleLock(storagePath: string, fileName: string) {
  // 1. Read current metadata
  const metaPath = `${storagePath}/${fileName}.meta.json`;
  const meta = JSON.parse(await adapter.read(config, metaPath));

  // 2. Toggle lock status
  meta.locked = !meta.locked;

  // 3. Write back
  await adapter.upload(config, JSON.stringify(meta), metaPath);
}
```

## Pipeline Integration

Retention runs as the final step of the backup pipeline:

```typescript
// src/lib/runner/steps/05-retention.ts
export async function stepRetention(ctx: RunnerContext): Promise<void> {
  const config = ctx.job.retention as RetentionConfiguration;

  // Skip if no retention configured
  if (!config || config.mode === "NONE") {
    ctx.logs.push("Retention: Skipped (no policy)");
    return;
  }

  // 1. List existing backups
  const files = await ctx.destinationAdapter.list(
    ctx.job.destination.config,
    ctx.job.name
  );

  // 2. Filter to backup files only (exclude metadata)
  const backups = files.filter(f => !f.name.endsWith(".meta.json"));

  // 3. Enrich with lock status
  const enriched = await Promise.all(
    backups.map(async (file) => {
      try {
        const meta = await ctx.destinationAdapter.read(
          ctx.job.destination.config,
          `${ctx.job.name}/${file.name}.meta.json`
        );
        const parsed = JSON.parse(meta);
        return { ...file, locked: parsed.locked || false };
      } catch {
        return { ...file, locked: false };
      }
    })
  );

  // 4. Calculate retention
  const result = RetentionService.calculateRetention(enriched, config);

  // 5. Delete old backups
  for (const file of result.delete) {
    await ctx.destinationAdapter.delete(
      ctx.job.destination.config,
      `${ctx.job.name}/${file.name}`
    );

    // Also delete metadata
    await ctx.destinationAdapter.delete(
      ctx.job.destination.config,
      `${ctx.job.name}/${file.name}.meta.json`
    ).catch(() => {}); // Ignore if not exists
  }

  ctx.logs.push(
    `Retention: Kept ${result.keep.length}, deleted ${result.delete.length}`
  );
}
```

## Error Handling

- **Metadata read failures**: File treated as unlocked
- **Delete failures**: Logged but don't fail the backup job
- **Lock toggle failures**: Surfaced to user immediately

## Testing

```typescript
// tests/unit/retention-service.test.ts
describe("RetentionService", () => {
  it("keeps correct number of daily backups", () => {
    const files = generateDailyBackups(30); // 30 days of backups
    const config = { mode: "SMART", smart: { daily: 7 } };

    const result = RetentionService.calculateRetention(files, config);

    expect(result.keep).toHaveLength(7);
    expect(result.delete).toHaveLength(23);
  });

  it("never deletes locked files", () => {
    const files = [
      { name: "backup-1", locked: true },
      { name: "backup-2", locked: false },
    ];
    const config = { mode: "SIMPLE", simple: { keepCount: 1 } };

    const result = RetentionService.calculateRetention(files, config);

    expect(result.keep).toContainEqual(
      expect.objectContaining({ name: "backup-1" })
    );
  });
});
```

## Adapter Requirements

For retention to work, storage adapters must implement:

| Method | Required For |
| :--- | :--- |
| `list()` | Discover existing backups |
| `read()` | Check lock status in metadata |
| `delete()` | Remove old backups |
| `upload()` | Toggle lock in metadata |

## Related Documentation

- [Runner Pipeline](/developer-guide/core/runner)
- [Storage Adapters](/developer-guide/adapters/storage)
- [Job Configuration](/user-guide/jobs/)
