# Configuration Export & Import (Meta-Backup)

This document describes the architecture and functionality of the "Meta-Backup" system (Configuration Backup), enabling a complete disaster recovery of the application without relying on filesystem snapshots of the SQLite database.

## 1. Overview & Objective

The goal is to store the entire app configuration in a portable manner. If the server needs to be rebuilt or the cryptographic system context (`ENCRYPTION_KEY` in `.env`) changes, the configuration can be restored via a clean import interface.

### Core Concepts

1.  **Portable Export**:
    *   The configuration is exported as JSON.
    *   Internal database secrets (encrypted with the *System Key*) are decrypted during the export.
    *   Subsequently, the data (now in plaintext in memory) immediately passes through the **Backup Encryption** pipeline (AES-256-GCM) using a user-selected **Encryption Profile**.
    *   The result is a backup file that is **independent** of the server's System Key and only requires the Recovery Kit of the Encryption Profile for decryption.

2.  **Security**:
    *   Exporting secrets (passwords, API keys) is optional (`includeSecrets`).
    *   If secrets are included, an Encryption Profile **must** be used for the backup. Exporting plaintext secrets without transport encryption is actively blocked.

## 2. Included Data

The export (`AppConfigurationBackup`) covers the following areas:

| Area | Description | Specifics |
| :--- | :--- | :--- |
| **System Settings** | Global settings (`settings`) | e.g. Concurrency limits, UI settings. |
| **Adapter Configs** | Connection data for databases & storage (`adapters`) | Passwords are only exported if `includeSecrets` is active. |
| **Jobs** | Backup jobs (`jobs`) | All schedules, retention policies, and associations. |
| **Users** | Local user accounts (`users`) | Includes password hashes if `includeSecrets` is active. |
| **Groups & Permissions** | Access control (`groups`) | RBAC configurations and group assignments. |
| **SSO Providers** | OIDC configurations (`ssoProviders`) | Client secrets are handled safely. |
| **Encryption Profiles** | Encryption profiles (`encryptionProfiles`) | If `includeSecrets` is active, the profile keys are exported (encrypted by the backup key). Otherwise, only metadata is exported. |

**Not included are:**
*   The actual backup files (SQL Dumps).
*   Logs and Execution History (past runs).
*   Temporary files or caches.

## 3. Processes

### 3.1 Export Process (Pipeline)

Export is performed **automatically by schedule** or manually triggered via **System Tasks** (`config.backup`).

1.  **Data Fetching**: `ConfigService` loads all data from the Prisma database.
2.  **Decryption (Pre-Flight)**:
    *   System-encrypted fields (e.g., DB passwords) are decrypted with the current `ENCRYPTION_KEY`.
    *   If `includeSecrets = false`, these fields are replaced with empty strings.
3.  **Pipeline (Runner)**:
    *   **JSON Serialization**: Data is converted to JSON.
    *   **Compression**: Gzip Stream (always active).
    *   **Encryption**: If `includeSecrets = true` (or profile selected), the stream is encrypted with the selected Encryption Profile.
    *   **Upload**: Upload to target storage (filename pattern `config_backup_{TIMESTAMP}.json[.gz][.enc]`).

### 3.2 Import Process (Offline Restore)

For simple file-based restoration (Disaster Recovery) where no storage connection is yet available.

1.  **Upload**: User uploads the backup file (JSON, GZ, or ENC). If encrypted, the `.meta.json` sidecar file must also be uploaded.
2.  **Parsing & Decryption**:
    *   The system parses the metadata to find the Encryption Profile ID, IV, and AuthTag.
    *   It uses the local Encryption Profiles (which must be restored or created first) to unlock the file.
3.  **Deserialization**: JSON is parsed.
4.  **Data Adoption (`OVERWRITE` Strategy)**:
    *   Existing entries with same IDs are updated.
    *   New entries are created.
    *   **Re-Encryption**: Secrets that were plaintext in the backup are immediately encrypted with the **new/current** local `ENCRYPTION_KEY` upon import and stored securely in the SQLite DB.

## 4. Configuration & UI

Controls are located under `Settings` -> `System Config`.

### Settings
*   **Automated Backup**: Enable/Disable.
*   **Destination Storage**: Select Storage Adapter.
*   **Encryption**: Encryption Profile (Mandatory for "Include Secrets").
*   **Schedule**: Managed in System Tasks (`system.config_backup`).
*   **Retention**: Number of config backups to keep.

### Manual Actions
*   **Offline Restore**: Start the disaster recovery dialog to upload and restore a backup file manually.
*   **Trigger Backup**: To run a backup immediately, use the "Run Now" button in the **System Tasks** view.

## 5. Implementation Details

*   **Service**: `src/services/config-service.ts` (Validation, mapping logic, streaming parser)
*   **Runner**: `src/lib/runner/config-runner.ts` (Pipeline orchestration)
*   **Types**: `src/lib/types/config-backup.ts` (TypeScript Interfaces)
*   **Actions**: `src/app/actions/config-management.ts` (Server Actions for UI)


