# System Backup (Meta-Backup)

Backup your DBackup configuration for disaster recovery.

## Overview

System Backup (also called Meta-Backup) exports your entire DBackup configuration:

- Database sources
- Storage destinations
- Backup jobs
- Users and groups
- Encryption profiles
- Notifications
- System settings

This enables complete disaster recovery without losing your setup.

## What's Included

| Data | Included | Notes |
| :--- | :--- | :--- |
| Adapter Configs | ✅ | Sources, destinations, notifications |
| Jobs | ✅ | All schedules and settings |
| Users | ✅ | Accounts and group assignments |
| Groups | ✅ | RBAC permissions |
| Encryption Profiles | ✅ | Keys (encrypted) |
| SSO Providers | ✅ | OIDC configurations |
| System Settings | ✅ | Concurrency, UI preferences |

### Not Included

| Data | Reason |
| :--- | :--- |
| Actual backups | Too large, stored separately |
| Execution history | Transient data |
| Temp files | Not needed |

## Configuration

### Automated System Backup

1. Go to **Settings** → **System Config**
2. Enable **Automated Backup**
3. Configure:
   - **Destination**: Storage adapter to use
   - **Encryption Profile**: Required for secrets
   - **Retention**: Number of backups to keep

### Manual Export

1. Go to **Settings** → **System Config**
2. Click **Export Configuration**
3. Choose options:
   - Include secrets (requires encryption)
4. Download file

## Security

### Encryption Required

When exporting secrets (passwords, API keys), encryption is **mandatory**:

1. Create/select an Encryption Profile
2. System encrypts export with profile key
3. Store the key separately!

### Without Secrets

Export without secrets includes:
- All structure and settings
- Placeholder for credentials
- Useful for sharing configs

## Backup Process

### Automated Flow

```
1. Scheduled trigger (System Task)

2. Data Collection
   └── Fetch all configs from DB
   └── Decrypt system-encrypted fields

3. Security Check
   └── If secrets included: require encryption
   └── If no encryption: exclude secrets

4. Processing Pipeline
   └── JSON serialization
   └── Gzip compression
   └── Encryption (if profile selected)

5. Upload
   └── Send to destination
   └── Create metadata file

6. Retention
   └── Delete old config backups
```

### File Format

```
config_backup_2024-01-15T12-00-00.json.gz.enc
config_backup_2024-01-15T12-00-00.json.gz.enc.meta.json
```

## Restore Process

### From UI (Online Restore)

When you have working DBackup instance:

1. Go to **Settings** → **System Config**
2. Click **Restore from Storage**
3. Select backup file
4. Configure options:
   - Overwrite vs Merge
   - What to restore
5. Execute restore

### Offline Restore (Disaster Recovery)

When starting fresh:

1. Install new DBackup instance
2. Go to **Settings** → **System Config**
3. Click **Offline Restore**
4. Upload backup file (+ meta.json if encrypted)
5. If encrypted:
   - Import encryption key first, OR
   - Provide key during restore
6. Execute restore
7. All configs restored

## Restore Strategy

### Overwrite Mode

- Replaces existing entries
- Updates if ID matches
- Creates if new
- Best for: disaster recovery

### Merge Mode (if available)

- Keeps existing entries
- Adds only new items
- Best for: importing partial configs

## Disaster Recovery Procedure

### Preparation (Before Disaster)

1. ✅ Enable automated config backup
2. ✅ Use encrypted backup (with secrets)
3. ✅ Store encryption key separately:
   - Password manager
   - Recovery Kit
   - Secure offline storage
4. ✅ Store `ENCRYPTION_KEY` env var:
   - Password manager
   - Infrastructure secrets

### Recovery Steps

1. Deploy fresh DBackup:
   ```bash
   docker-compose up -d
   ```

2. Set same `ENCRYPTION_KEY` (or new one)

3. First admin account: Sign up

4. Import encryption profile key:
   - Vault → Encryption → Import key

5. Offline restore:
   - Settings → System Config → Offline Restore
   - Upload backup file
   - System decrypts with imported key

6. Re-encrypt secrets:
   - If ENCRYPTION_KEY changed
   - System re-encrypts with new key

7. Verify:
   - Check all sources connect
   - Test backup jobs
   - Verify notifications

## Best Practices

### Regular Backups

1. Enable automated backup
2. Set reasonable retention (7-30)
3. Monitor for failures

### Key Management

Store separately from config backup:
1. `ENCRYPTION_KEY` → Password manager
2. Encryption Profile Key → Recovery Kit
3. Don't store both together!

### Testing Recovery

Periodically test:
1. Export config
2. Deploy test instance
3. Restore config
4. Verify functionality

### Documentation

Document your setup:
- `ENCRYPTION_KEY` location
- Profile key locations
- Recovery procedure

## Troubleshooting

### Cannot Decrypt Config

**Causes**:
- Wrong encryption key
- Profile deleted
- Metadata missing

**Solutions**:
1. Import original profile key
2. Check meta.json exists
3. Use Recovery Kit

### Secrets Not Restored

**Cause**: Exported without secrets

**Solutions**:
1. Re-export with "Include Secrets"
2. Or manually re-enter credentials

### ID Conflicts

**Cause**: Same IDs in backup and existing

**Solution**: Choose "Overwrite" mode

## File Format Reference

### JSON Structure

```json
{
  "version": "1.0",
  "timestamp": "2024-01-15T12:00:00Z",
  "data": {
    "adapters": [...],
    "jobs": [...],
    "users": [...],
    "groups": [...],
    "encryptionProfiles": [...],
    "ssoProviders": [...],
    "settings": {...}
  }
}
```

### Metadata

```json
{
  "encryption": {
    "enabled": true,
    "profileId": "uuid",
    "iv": "hex",
    "authTag": "hex"
  },
  "compression": "GZIP",
  "includesSecrets": true,
  "exportedAt": "2024-01-15T12:00:00Z"
}
```

## Next Steps

- [Encryption Vault](/user-guide/security/encryption) - Manage encryption keys
- [Recovery Kit](/user-guide/security/recovery-kit) - Emergency decryption
- [Installation](/user-guide/installation) - Fresh deployment
