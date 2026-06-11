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

`StorageService.listFilesWithMetadata(adapterConfigId, typeFilter?, bypassCache?)`:

1. If `bypassCache = false` (default): query `StorageListCache` by `adapterConfigId`.
2. **Cache hit**: check age. If `cachedAt` is older than `CACHE_STALENESS_HOURS` (2 h), fire-and-forget `reconcileStorageListCache()` in the background, then return cached data immediately (stale-while-revalidate).
3. **Cache miss**: run full fetch — `adapter.list("")` + parallel `.meta.json` reads + DB fallbacks — write result to `StorageListCache`, then return.

TypeFilter (`BACKUP` / `SYSTEM`) is applied **after** cache retrieval, so the cache always stores the full unfiltered list.

## Write Path

After a full fetch (cache miss), the result is persisted with a non-blocking `upsert`:

```typescript
prisma.storageListCache.upsert({
    where:  { adapterConfigId },
    create: { adapterConfigId, filesJson },
    update: { filesJson, cachedAt: new Date() },
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

## Pre-warm System Task

The `system.warmup_storage_cache` task populates the cache for all storage adapters shortly after server startup so the first visit to Storage Explorer is fast even after a restart.

- **Startup delay**: 10 seconds (standard for all startup tasks, controlled by the scheduler).
- **Recurring schedule**: Daily at 3 AM (keeps the cache warm if it goes cold overnight).
- **Enabled by default**: yes.
- **Concurrency**: adapters are warmed sequentially to avoid simultaneous rate-limit hits on remote APIs.

The task calls `listFilesWithMetadata()` for each adapter. If the cache is already warm and fresh, the call returns immediately from cache — no redundant remote fetch.

## Force Refresh

Pass `?refresh=true` on the files API route to bypass the cache and force a full re-fetch:

```
GET /api/storage/:id/files?refresh=true
```

This is wired to the Refresh button in the Storage Explorer UI. After the live fetch completes, the new result is written back to the cache.

## Cache Invalidation Summary

| Trigger | Method | Location |
|---------|--------|----------|
| Backup uploaded | `appendStorageListCacheEntry` | `src/lib/runner/steps/03-upload.ts` |
| Retention deleted a file | `removeStorageListCacheEntry` | `src/lib/runner/steps/05-retention.ts` |
| Manual file delete | `removeStorageListCacheEntry` | `StorageService.deleteFile()` |
| File lock toggled | `updateStorageListCacheEntry` | `StorageService.toggleLock()` |
| Verification result written | `updateStorageListCacheEntry` | `VerificationService.writeVerificationResult()` |
| Cache older than 2 h | `reconcileStorageListCache()` background | `StorageService.listFilesWithMetadata()` |
| User clicks Refresh | `invalidateStorageListCache()` + full fetch | `GET /api/storage/:id/files?refresh=true` |

## Key Files

| File | Role |
|------|------|
| `src/services/storage/storage-service.ts` | All cache methods, reconciliation, enrichment |
| `src/services/storage/verification-service.ts` | Surgical update after verification |
| `src/lib/runner/steps/03-upload.ts` | Append on upload |
| `src/lib/runner/steps/05-retention.ts` | Remove per deleted file |
| `src/services/system/system-task-service.ts` | Pre-warm task definition and runner |
| `prisma/schema.prisma` | `StorageListCache` model |
