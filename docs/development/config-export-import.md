# Configuration Export & Import (Meta-Backup)

This document outlines the architecture for the "Meta-Backup" feature, allowing the Database Backup Manager to backup its own configuration to a defined destination.

## 1. Concept & Philosophy

The goal is to allow a complete disaster recovery of the application state without relying on a filesystem snapshot of the SQLite database. This ensures that if the `.env` encryption key changes or the server is migrated, the configuration can still be restored portably.

### Key Decisions

1.  **Secrets Handling**:
    *   Secrets in the database are encrypted with the system `ENCRYPTION_KEY` (AES-256-GCM).
    *   **Export**: We must **decrypt** these secrets using the system key during the export process.
    *   **Transport**: The raw JSON data (containing now-plaintext secrets) is then immediately streamed through the **Backup Encryption** pipeline (using a user-selected Encryption Profile).
    *   **Result**: The resulting file on storage is independent of the server's `ENCRYPTION_KEY`. It relies solely on the Encryption Profile (which the user should have the Recovery Kit for).

2.  **Storage Isolation**:
    *   Config backups are stored in the same adapters as regular backups.
    *   **Differentiation**: We use a strict naming convention or metadata flag to distinguish config backups from database dumps in the Storage Explorer.

## 2. Data Structure

The export format is a JSON structure.

```typescript
interface AppConfigurationBackup {
  metadata: {
    version: string;      // App Version
    exportedAt: string;   // ISO Date
    includeSecrets: boolean;
  };
  settings: SystemSetting[];
  // Adapters (Sources, Destinations, Notifications)
  adapters: AdapterConfig[]; // Secrets are either included (plaintext) or stripped based on options
  // Jobs
  jobs: Job[];
  // Security
  users: User[];         // Optional: Users might handle authentication externally
  groups: Group[];
  permissions: Permission[];
  // Provide specific logic for Encryption Profiles (Exporting keys requires care)
  encryptionProfiles: {
    id: string;
    name: string;
    // We DO NOT export the masterKey encrypted with the OLD system key.
    // We export public metadata. The MasterKey itself needs special handling purely for migration.
    // For MVP: We might skip exporting Profiles to avoid security loops, or export them re-encrypted if possible.
  }[];
}
```

## 3. Implementation Plan

### Phase 1: Service Layer (`src/services/config-service.ts`)

We need a dedicated service to marshal/unmarshal the data.

```typescript
export class ConfigService {
  /**
   * Generates the configuration object.
   * @param includeSecrets If true, decrypts DB passwords and includes them.
   */
  async export(includeSecrets: boolean): Promise<AppConfigurationBackup> {
     // 1. Fetch all data from Prisma
     // 2. Iterate adapters, decrypt 'config' field using system crypto
     // 3. Return object
  }

  /**
   * Restores configuration.
   * @param data The backup object
   * @param strategy 'MERGE' | 'OVERWRITE'
   */
  async import(data: AppConfigurationBackup, strategy: 'OVERWRITE'): Promise<void> {
     // 1. Validate version
     // 2. Upsert adapters (Re-encrypting secrets with CURRENT system crypto)
     // 3. Upsert jobs, etc.
  }
}
```

### Phase 2: System Task (`Settings` Integration)

Instead of a standard "Job", this is a System Task configured in the `Settings` -> `Config` tab.

**New System Settings Keys:**
*   `config_backup_schedule`: Cron string (e.g. "0 3 * * *")
*   `config_backup_storage_id`: UUID of Storage Adapter
*   `config_backup_encryption_profile_id`: UUID of Vault Profile
*   `config_backup_include_secrets`: Boolean
*   `config_backup_retention_count`: Number (Keep last X)

### Phase 3: The Pipeline (Lightweight Runner)

Since this doesn't require "Dumping" a database binary, we don't need the full logic of `src/lib/runner`. However, we should reuse the **Streams**.

**Flow:**
1.  `ConfigService.export()` creates a huge JSON object.
2.  Convert JSON to Readable Stream.
3.  **Pipeline:** `JSON Stream` -> `Gzip (Optional)` -> `Encryption Stream` -> `StorageAdapter.upload`.
4.  Write `.meta.json` sidecar (Type: `system-config`).

### Phase 4: Storage Explorer Updates

**Filtering:**
*   Modify `StorageService.listFilesWithMetadata`:
    *   Add a filter param `type?: 'backup' | 'config' | 'all'`.
    *   Config files follow pattern: `config_backup_{TIMESTAMP}.json` (or `.json.enc`).
    *   Metadata `sourceType` for these files should be `SYSTEM`.
*   **UI**: Add a Toggle Button in Storage Explorer: "Show System Configs". Default: Off.

## 4. Security Considerations (User Questions)

> *Can the user decide if secrets are exported?*

Yes. The UI will have a checkbox "Include Credentials".
*   If **Unchecked**: `password`, `apiKey`, `secret` fields in adapters are set to `""`. The user must re-enter them after restore.
*   If **Checked**: Values are exported. **Warning**: This mode SHOULD require an Encryption Profile to be selected. We should prevent "Plaintext export with Secrets" in the UI unless strictly ignored by the user.

> *Hash vs Plain?*

We cannot use Hashes for credentials (like DB passwords) because we need to use them to connect. They must be reversible.
Therefore, in the export file, they are **Plaintext JSON**, but the **File itself is Encrypted** via AES-GCM (Encryption Profile).

## 5. UI Mockup (Settings -> Config Tab)

**Panel: Automated Configuration Backup**

*   [Switch] Enable Automated Backups
*   [Select] Destination (Storage Adapter)
*   [Select] Encryption Profile (Vault) `(Recommended)`
*   [Cron Input] Schedule
*   [Checkbox] Include Database Credentials / Secrets `(Requires Encryption)`
*   [Number] Retention (Keep last X backups)

**Panel: Manual Action**
*   [Button] Export Now (Download to PC)
*   [Button] Import Config...

## 6. Implementation Tasks

- [x] **Phase 1: Service Layer (`src/services/config-service.ts`)**
    - [x] Define `AppConfigurationBackup` types/interfaces
    - [x] Implement `export(includeSecrets)`: Fetch all data, handle secret decryption
    - [x] Implement `import(data)`: Validate, upsert data, handle secret re-encryption
    - [x] Unit Tests for Export/Import logic

- [x] **Phase 2: System Settings Updates**
    - [x] Update `SystemSetting` keys in `src/lib/core/settings.ts` (or equivalent)
    - [x] Create Zod schema for Config Backup Settings
    - [x] Update Settings UI (`src/app/dashboard/settings/page.tsx`) to include "Config" tab

- [ ] **Phase 3: Pipeline & Scheduler**
    - [ ] Create `ConfigBackupRunner` (Simplified runner for JSON -> Gzip -> Encrypt -> Storage)
    - [ ] Register new Cron Task for `config_backup_schedule`

- [ ] **Phase 4: Storage Explorer Integration**
    - [ ] Update `StorageService` to filter/identify config backups
    - [ ] Update UI to toggle "Show System Configs"

- [ ] **Phase 5: Manual Export/Import UI**
    - [ ] Create Server Actions for manual export (download)
    - [ ] Create Server Actions/Upload for manual import

