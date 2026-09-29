# Configuration Export & Import (Meta-Backup)

The Meta-Backup system enables complete disaster recovery of the application without relying on filesystem snapshots of the SQLite database.

## Overview

The goal is to store the entire app configuration in a portable manner. If the server needs to be rebuilt or the cryptographic context (`ENCRYPTION_KEY`) changes, the configuration can be restored via a clean import interface.

### Core Concepts

1. **Portable Export**: Configuration is exported as JSON, then encrypted with a user-selected Encryption Profile
2. **Security**: Secrets are only exported when explicitly enabled, and must be encrypted
3. **Independence**: The backup file is independent of the server's System Key

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Database       │────▶│  JSON Export     │────▶│  Compression    │
│  (Prisma)       │     │  (Decrypted)     │     │  (Optional)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                 ┌─────────────────┐
                                                 │  Encryption     │
                                                 │  (AES-256-GCM)  │
                                                 └─────────────────┘
                                                         │
                                                         ▼
                                                 ┌─────────────────┐
                                                 │  Storage        │
                                                 │  (Upload)       │
                                                 └─────────────────┘
```

## Included Data

| Area | Description | Secrets Handling |
|------|-------------|------------------|
| **System Settings** | Global settings | Always included |
| **Credential Profiles** | Vault - reusable credentials for adapters | Data only with `includeSecrets` |
| **Adapter Configs** | Database & storage connections | Passwords only with `includeSecrets` |
| **Jobs** | Backup schedules, retention | Always included |
| **Users** | Local user accounts | Password hashes only with `includeSecrets` |
| **Groups** | RBAC configurations | Always included |
| **SSO Providers** | OIDC configurations | Client secrets only with `includeSecrets` |
| **Encryption Profiles** | Vault - backup encryption keys | Keys only with `includeSecrets` |

**Not included:**
- Actual backup files (SQL dumps)
- Execution history and logs
- Temporary files or caches

## Export Process

### Automatic Backup

Export runs automatically via the **System Task** scheduler (`config.backup`):

```typescript
// Configured in System Settings
{
  "config.backup.enabled": true,
  "config.backup.schedule": "0 3 * * *",  // Daily at 3 AM
  "config.backup.storageId": "clx123...", // Target storage
  "config.backup.encryptionProfileId": "clx456...",
  "config.backup.includeSecrets": true
}
```

### Manual Trigger

Via **Settings → System Tasks → Configuration Backup → Run Now**

### Pipeline Steps

1. **Data Fetching**: `ConfigService` loads all data from Prisma
2. **Decryption (Pre-Flight)**: System-encrypted fields are decrypted with current `ENCRYPTION_KEY`
3. **Secret Handling**: If `includeSecrets = false`, sensitive fields become empty strings
4. **Compression**: GZIP applied to JSON
5. **Encryption**: AES-256-GCM with selected Encryption Profile
6. **Upload**: Written to configured storage destination

```typescript
// File naming convention
const filename = `config_backup_${timestamp}.json.gz.enc`;
// Example: config_backup_2026-01-31T10-00-00-000Z.json.gz.enc
```

## Import Process

### Pre-Flight Checks

Before import, the system validates:
1. File can be decrypted (correct Encryption Profile)
2. Schema version is compatible
3. No critical conflicts (e.g., duplicate primary keys)

### Conflict Resolution

| Scenario | Resolution |
|----------|------------|
| Same ID exists | Update existing record |
| New ID | Create new record |
| Missing dependency | Skip with warning |
| Schema mismatch | Abort with error |

### Import Modes

```typescript
type ImportMode =
  | 'full'      // Replace everything
  | 'merge'     // Add missing, update existing
  | 'selective' // User chooses what to import
```

## Service Layer

**Location**: `src/services/config-service.ts`

### Key Methods

```typescript
class ConfigService {
  // Export configuration to JSON
  async exportConfig(options: ExportOptions): Promise<Buffer>;

  // Import configuration from JSON
  async importConfig(data: Buffer, options: ImportOptions): Promise<ImportResult>;

  // Validate import data without applying
  async validateImport(data: Buffer): Promise<ValidationResult>;

  // Get export preview (what will be included)
  async getExportPreview(includeSecrets: boolean): Promise<ExportPreview>;
}
```

### Export Options

```typescript
interface ExportOptions {
  includeSecrets: boolean;        // Include passwords, API keys
  encryptionProfileId?: string;   // Required if includeSecrets = true
  compression?: 'none' | 'gzip' | 'brotli';
}
```

## Security Considerations

### Who Restores

A restore writes users, groups, API keys and sign-in providers from the file, so it could make anyone a SuperAdmin. `uploadAndRestoreConfigAction` and `restoreFromStorageAction` in `src/app/actions/backup/config-management.ts` check `settings:write` first and then refuse anyone who is no SuperAdmin. Taking a config backup stays with `settings:write`.

### Secret Export Requirements

If `includeSecrets = true`:
- An Encryption Profile **must** be selected
- Exporting plaintext secrets is actively blocked
- The resulting file requires the Recovery Kit for decryption

### Recovery Without Secrets

If imported without secrets:
- Adapter connections will fail until passwords are re-entered
- SSO providers will need client secrets reconfigured
- Encryption profiles will need keys re-imported from Recovery Kits

### Best Practices

1. **Always use encryption** for config backups
2. **Store Recovery Kits separately** from config backups
3. **Test restore process** in a staging environment
4. **Document encryption profile** used for backups
