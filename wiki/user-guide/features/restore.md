# Restore

Restore databases from your backups.

## Overview

DBackup can restore backups directly to database servers. The restore process:

1. Downloads backup from storage
2. Decrypts (if encrypted)
3. Decompresses (if compressed)
4. Executes restore commands
5. Verifies completion

## Starting a Restore

### From Storage Explorer

1. Go to **Storage Explorer** in sidebar
2. Find the backup to restore
3. Click **Restore** button
4. Configure restore options
5. Confirm and start

### From History

1. Go to **History** in sidebar
2. Find successful backup execution
3. Click **Restore from this backup**
4. Configure options

## Restore Options

### Target Selection

| Option | Description |
| :--- | :--- |
| **Target Source** | Database connection to restore to |
| **Target Database** | Specific database name (optional) |

### Database Mapping

Restore to different database names:

```
Source Database → Target Database
─────────────────────────────────
production      → staging_copy
users_prod      → users_test
```

Configure in the mapping section of restore dialog.

### Privileged Credentials

For creating new databases:
1. Enable **Use Privileged Auth**
2. Enter elevated credentials
3. These are used for `CREATE DATABASE` only

Regular restore uses the source configuration credentials.

## Restore Process

### Pipeline

```
1. Download
   └── Fetch from storage destination

2. Decrypt (if needed)
   └── Use encryption profile
   └── Smart key discovery

3. Decompress (if needed)
   └── Gzip or Brotli

4. Pre-flight Checks
   └── Version compatibility
   └── Permission verification

5. Restore
   └── Execute database-specific restore

6. Verification
   └── Check for errors
   └── Validate completion

7. Cleanup
   └── Remove temp files
```

### Progress Tracking

During restore, view:
- Current step
- File download progress
- Restore status
- Live log output

## Database-Specific Restore

### MySQL/MariaDB

```bash
mysql -h host -u user -p database < backup.sql
```

- Drops and recreates tables
- Imports all data
- Restores triggers, procedures

### PostgreSQL

```bash
psql -h host -U user -d database -f backup.sql
```

- Can create database if privileged
- Restores schema and data
- Handles sequences, indexes

### MongoDB

```bash
mongorestore --uri "mongodb://..." --archive=backup.archive
```

- Restores all collections
- Can restore to different database
- Preserves indexes

### SQLite

- Replaces entire database file
- Or restores via `.read` command
- Path remapping supported

### Microsoft SQL Server

```sql
RESTORE DATABASE [dbname] FROM DISK = '/path/backup.bak'
```

- Full database restore
- Requires shared volume
- Uses T-SQL commands

## Safety Features

### Version Guard

Prevents restoring newer backups to older servers:

```
❌ MySQL 8.0 backup → MySQL 5.7 server
✅ MySQL 5.7 backup → MySQL 8.0 server
```

### Overwrite Protection

Before overwriting existing database:
1. Warning displayed
2. Confirmation required
3. Consider backup first

### Rollback Considerations

Restore is **not automatically reversible**:
- Backup target before restore
- Test on staging first
- Keep source backup

## Smart Key Recovery

If encryption profile ID doesn't match:

1. System scans all available profiles
2. Attempts decryption with each
3. Validates by checking content
4. Uses matching key automatically

This helps when:
- Key was imported with new ID
- Profile was recreated
- After disaster recovery

## Common Scenarios

### Restore to Same Database

Original state restoration:
1. Select same source as backup
2. Leave database mapping empty
3. Existing data is replaced

### Clone to New Database

Create copy of database:
1. Select same source
2. Map original → new name
3. Enable privileged auth
4. New database created

### Migrate to Different Server

Move database between servers:
1. Select different source
2. Configure connection
3. Restore creates database

### Multi-Database Restore

When restoring a backup containing multiple databases:

1. **Automatic Detection**: DBackup detects Multi-DB TAR archives
2. **Database Selection**: Choose which databases to restore
3. **Rename Support**: Map databases to different names
4. **Progress Tracking**: Per-database progress indication

```
Multi-DB Backup Contents:
┌─────────────────────────────────────────┐
│ ☑ production    →  staging_copy         │
│ ☑ users         →  users_test           │
│ ☐ logs          →  (skip)               │
│ ☑ config        →  config               │
└─────────────────────────────────────────┘
```

Each selected database is restored individually, allowing granular control over what gets restored and where.

## Troubleshooting

### Permission Denied

```
ERROR: permission denied to create database
```

**Solutions**:
1. Enable privileged auth
2. Provide admin credentials
3. Pre-create empty database

### Version Mismatch

```
ERROR: backup version (8.0) newer than server (5.7)
```

**Solutions**:
1. Upgrade target server
2. Use older backup
3. Manual dump conversion (complex)

### Timeout During Restore

**Causes**:
- Large database
- Slow network
- Resource constraints

**Solutions**:
1. Increase request timeout
2. Restore during low-usage
3. Check server resources

### Encryption Key Not Found

```
ERROR: encryption profile not found
```

**Solutions**:
1. Import key to Vault
2. Smart recovery should find it
3. Use Recovery Kit manually

### Character Set Issues

```
ERROR: invalid character in identifier
```

**Solutions**:
1. Check source/target charset match
2. Set connection charset
3. Convert dump if needed

## Best Practices

### Before Restore

1. **Verify backup** - Download and inspect
2. **Backup target** - In case of issues
3. **Test on staging** - Before production
4. **Schedule downtime** - For production restores

### During Restore

1. **Monitor progress** - Watch for errors
2. **Don't interrupt** - Let it complete
3. **Check logs** - Review output

### After Restore

1. **Verify data** - Check key tables
2. **Test application** - Functionality check
3. **Update connections** - If database renamed
4. **Document** - Record what was restored

## Restore History

All restores are logged in History:
- Timestamp
- Source backup
- Target database
- Status (Success/Failed)
- Duration
- Detailed logs

## Next Steps

- [Storage Explorer](/user-guide/features/storage-explorer) - Browse backups
- [Encryption](/user-guide/security/encryption) - Understanding encryption
- [Recovery Kit](/user-guide/security/recovery-kit) - Manual decryption
