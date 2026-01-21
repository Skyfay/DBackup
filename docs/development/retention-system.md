# Retention & Locking System

This document outlines the architecture and implementation of the Retention Policies (Grandfather-Father-Son) and the Backup Locking mechanism in the Database Backup Manager.

## 1. Overview

The Retention System ensures that storage usage is optimized by automatically rotating old backups while preserving significant snapshots based on a defined policy.

Supported Modes:
- **None**: Keep all backups (Default).
- **Simple**: Keep the last `N` backups.
- **Smart (GVS)**: Grandfather-Father-Son strategy (Daily, Weekly, Monthly, Yearly).

The **Locking System** allows users to manually exempt specific backups from these policies, ensuring they are never deleted automatically.

---

## 2. Data Model

### Job Configuration
Retention settings are stored in the `Job` model as a JSON field.

```prisma
model Job {
  // ...
  retention    Json      @default("{}") // Stores RetentionConfiguration
}
```

### TypeScript Interfaces
Located in `src/lib/core/retention.ts`:

```typescript
export type RetentionMode = 'NONE' | 'SIMPLE' | 'SMART';

export interface RetentionConfiguration {
    mode: RetentionMode;
    simple?: {
        keepCount: number;
    };
    smart?: {
        daily: number;   // Keep last X days
        weekly: number;  // Keep last X weeks
        monthly: number; // Keep last X months
        yearly: number;  // Keep last X years
    };
}
```

---

## 3. Core Logic (`RetentionService`)

The core algorithm is isolated in `src/services/retention-service.ts`. It is pure logic and decoupled from storage adapters.

### Separation of Concerns
1.  **Input**: List of `FileInfo` objects (metadata including date, name, locked status).
2.  **Process**:
    *   **Filter Locked**: Files with `locked: true` are immediately moved to the "Keep" list and **removed** from the processing pool. They do **not** count towards retention limits (e.g., if "Keep 5" is set and you have 2 locked files, you will end up with 7 files total).
    *   **Sort**: Remaining files are sorted by `lastModified` (descending).
    *   **Apply Policy**:
        *   *Simple*: Slice the array to `keepCount`.
        *   *Smart*: Iterate through files and assign them to time buckets (Daily, Weekly, etc.). A single file can satisfy multiple buckets (e.g., a backup from today is both the daily backup and potentially the weekly backup).
3.  **Output**: Two arrays: `keep` and `delete`.

---

## 4. Locking Mechanism

To prevent accidental deletion of important backups (e.g., a pre-migration snapshot), users can "Lock" a backup.

### Technical Implementation

We do **not** use a database for tracking individual backup files to avoid synchronization drift. Instead, we use **Metadata Sidecars**.

1.  **Storage**: For every backup file (e.g., `backup.sql.gz`), there is a corresponding sidecar `backup.sql.gz.meta.json`.
2.  **Flag**: The sidecar contains a `locked: boolean` property.
3.  **Toggle Flow**:
    *   User clicks "Lock" in UI (`StorageClient`).
    *   Server Action `lockBackup` calls `StorageService.toggleLock`.
    *   Service reads the `.meta.json` from the storage adapter.
    *   Service toggles the boolean and overwrites the `.meta.json`.

### Runner Integration
During the retention step (`05-retention.ts`), the runner:
1. Lists all files in the backup directory.
2. **Reads metadata** for every file to check the `locked` status.
3. Passes the enriched file list (with `locked` property) to `RetentionService`.

---

## 5. Execution Pipeline (`05-retention.ts`)

Retention is executed as the final step of a backup runner job.

### Flow
1.  **Check Configuration**: If policy is `NONE`, skip.
2.  **Discover Files**: Use `destAdapter.list()` to get all backups in the job's folder.
3.  **Enrich Metadata**:
    *   Iterate over files.
    *   Fetch `.meta.json` content via `destAdapter.read()`.
    *   If `locked: true` is found, mark file object.
4.  **Calculate**: Call `RetentionService.calculateRetention(files, policy)`.
5.  **Execute Deletion**:
    *   Iterate over the `delete` list returned by the service.
    *   **Delete Artifact**: `destAdapter.delete(file.path)`.
    *   **Delete Sidecar**: `destAdapter.delete(file.path + ".meta.json")`.

### Failure Handling
*   If metadata reading fails, the file is treated as **unlocked** (default unsafe) to ensure the system doesn't accumulate garbage indefinitely, OR generic error handling applies. Currently, we try-catch read errors to prevent the entire job from failing.
*   Retention errors (e.g., deletion fails) are logged but do **not** mark the overall backup job as failed.

---

## 6. Adapter Requirements

For Retention and Locking to work, a Storage Adapter must implement:

*   `list(path)`: To discover old backups.
*   `read(path)`: To check `locked` status in sidecars.
*   `delete(path)`: To remove old artifacts and sidecars.
*   `upload(path)`: (Used to overwrite sidecar during locking).

Currently fully implemented in:
- `LocalFileSystemAdapter`
