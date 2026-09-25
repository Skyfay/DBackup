# Storage List Cache

The Storage Explorer calls `adapter.list("")` (recursive folder traversal) plus one `adapter.read()` per `.meta.json` sidecar on every load. For remote adapters like Google Drive this means dozens of API calls per page view. The storage list cache stores the full enriched listing in SQLite so repeat visits are instant.

## Database Model

```prisma
model StorageListCache {
  adapterConfigId String        @id
  filesJson       String        // JSON array of RichFileInfo — full list, no typeFilter
  cachedAt        DateTime      @default(now())
  adapterConfig   AdapterConfig @relation(..., onDelete: Cascade)
}
```

One row per storage adapter. `cachedAt` drives the staleness check.

## Read Path

`StorageService.listDestinationFiles(adapterConfigId, bypassCache?)`, which `listFilesWithMetadata(adapterConfigId, typeFilter?, bypassCache?)` filters by type:

1. If `bypassCache = false` (default): read the cached payload with `readCachedListing()`.
2. **Current payload**: return it. If `cachedAt` is older than `CACHE_STALENESS_HOURS` (2 h), start `reconcileStorageListCache()` in the background first (stale-while-revalidate).
3. **Readable payload of an older version**: return it and start a full listing in the background, which replaces it once the destination answers.
4. **No payload, or one too old to read**: run a full fetch (`adapter.list("")`, parallel `.meta.json` reads, DB fallbacks), write it to `StorageListCache`, then return it.

TypeFilter (`BACKUP` / `SYSTEM`) is applied **after** cache retrieval, so the cache always stores the full unfiltered list.

The Storage Explorer never takes step 4 in a request. Its service reads with `readCachedListing()` only and calls `refreshInBackground()` for a destination without a current or fresh list, unless the health check calls it offline. The index reports such a destination as `listing` and the page asks again every few seconds until the listing is done.

## Versions

The payload is `{ v, files }`. `CACHE_SCHEMA_VERSION` rises when `enrichSingleFile` starts writing a field the UI depends on, since reconciliation only enriches files it has not seen before.

| Payload version | Read |
|--------|-------------|
| Current | Served |
| From `CACHE_MIN_READABLE_VERSION` up | Served, and rebuilt in the background. A surgical update keeps its version, so the rebuild still happens |
| Older, or a bare array | Dropped and listed again, since its paths or fields cannot be used |

A destination that does not answer keeps an older readable payload instead of losing its list.

## Listings in the Background

Live listings and reconciliations are deduplicated per destination: a second caller joins the running one, so a page, Check now and the warmup task never list the same destination at once. Background refreshes run at most four at a time, the rest wait in a queue, which matters right after an upgrade when every destination needs one. The state lives on `globalThis`, because in development every route loads its own copy of the module.

A failed listing or reconciliation is remembered with its error. `listingFailure()` reports it until a later one succeeds, and `refreshInBackground()` leaves the destination alone for five minutes after a failure, unless called with `force`, as Check now does. Tests reset this state with `clearListingState()`.

## Write Path

A full fetch persists its result with an awaited `upsert` whose failure is ignored, so a page that asks again once the listing is done reads the new list:

```typescript
await prisma.storageListCache.upsert({
    where:  { adapterConfigId },
    create: { adapterConfigId, filesJson, cachedAt: listedAt },
    update: { filesJson, cachedAt: listedAt },
}).catch(() => {});
```

## Surgical Update Methods

Instead of dropping the entire cache row on every change, these methods patch only the affected entry:

| Method | When to use |
|--------|-------------|
| `appendStorageListCacheEntry(id, entry)` | After a successful backup upload |
| `removeStorageListCacheEntry(id, filePath)` | After a file is deleted (manual or retention) |
| `updateStorageListCacheEntry(id, filePath, updates)` | After lock toggle or verification result written |

All three follow the same read-modify-write pattern against the JSON array. If no cache row exists they no-op — the next `listFilesWithMetadata` call does a fresh fetch and populates the cache.

**Adding a new surgical update point:**

```typescript
import("@/services/storage/storage-service").then(({ storageService }) => {
    storageService.removeStorageListCacheEntry(configId, filePath).catch(() => {});
});
```

Use a dynamic import with fire-and-forget to avoid circular dependencies and to keep the calling code non-blocking.

## Reconciliation (Stale-While-Revalidate)

Files deleted directly on the remote storage (outside DBackup) are invisible to the surgical update methods. The reconciliation job detects these:

1. Call `adapter.list("")` — returns only file names and paths, no `.meta.json` reads.
2. Diff remote paths against cached paths.
3. **Removed files**: filter them out of the cache.
4. **New files** (added outside DBackup or missed during a previous run): fetch their `.meta.json` sidecars and enrich only those files using `enrichSingleFile()`.
5. Write the updated array back and reset `cachedAt`.

Reconciliation runs in the background (non-blocking) whenever a cached listing is served and its `cachedAt` is older than `CACHE_STALENESS_HOURS`. The threshold is defined at the top of `storage-service.ts`:

```typescript
const CACHE_STALENESS_HOURS = 2;
```

## Pre-warm / Reconcile System Task

The `system.warmup_storage_cache` task keeps the cache consistent for all storage adapters.

- **Startup delay**: 10 seconds (standard for all startup tasks, controlled by the scheduler).
- **Recurring schedule**: Every hour.
- **Enabled by default**: yes.
- **Concurrency**: adapters are processed sequentially to avoid simultaneous rate-limit hits.

**Per-adapter logic:**
- **Cache exists**: calls `reconcileStorageListCache()`, which runs `adapter.list()`, diffs against the cached list, removes entries for files deleted externally, enriches and appends new files. A payload of an older version gets a full listing instead. Detects changes made outside DBackup within the hour.
- **No cache row**: calls `listFilesWithMetadata()` — full fetch to populate the cache from scratch.

## Force Refresh

Check now in the Storage Explorer calls `POST /api/storage/explorer/refresh` with the destinations of the page. It starts a reconciliation, or a full listing when there is no current payload, in the background even for a destination that failed a moment ago, and answers at once.

`GET /api/storage/:id/files?refresh=true` still lists a destination live and waits for it.

## Cache Invalidation Summary

| Trigger | Method | Location |
|---------|--------|----------|
| Backup uploaded | `appendStorageListCacheEntry` | `src/lib/runner/steps/03-upload.ts` |
| Retention deleted a file | `removeStorageListCacheEntry` | `src/lib/runner/steps/05-retention.ts` |
| Manual file delete | `removeStorageListCacheEntry` | `StorageService.deleteFile()` |
| File lock toggled | `updateStorageListCacheEntry` | `StorageService.toggleLock()` |
| Verification result written | `updateStorageListCacheEntry` | `VerificationService.writeVerificationResult()` |
| Cache older than 2 h | `reconcileStorageListCache()` background | `StorageService.listDestinationFiles()`, the Storage Explorer |
| Payload of an older version | Full listing in the background | `StorageService.listDestinationFiles()`, the Storage Explorer |
| User clicks Check now | `checkNow()` in the background | `POST /api/storage/explorer/refresh` |
| API caller asks for a live list | Full fetch | `GET /api/storage/:id/files?refresh=true` |

## Key Files

| File | Role |
|------|------|
| `src/services/storage/storage-service.ts` | All cache methods, reconciliation, enrichment, the listings in the background |
| `src/services/storage/explorer-service.ts` | The Storage Explorer's reads, which never wait for a storage |
| `src/services/storage/explorer-plan-service.ts` | What the schedules plan for the timeline of the Backups tab, with the retention of the runner applied to the cached backups |
| `src/services/storage/verification-service.ts` | Surgical update after verification |
| `src/lib/runner/steps/03-upload.ts` | Append on upload |
| `src/lib/runner/steps/05-retention.ts` | Remove per deleted file |
| `src/services/system/system-task-service.ts` | Pre-warm task definition and runner |
| `prisma/schema.prisma` | `StorageListCache` model |
