# Storage Explorer

Browse, download, and manage your backup files.

## Overview

The Storage Explorer provides a file browser interface for all your backup destinations. From here you can:

- Browse backup files
- View backup metadata
- Download backups
- Restore databases
- Lock/unlock backups
- Delete files

## Accessing Storage Explorer

1. Navigate to **Storage Explorer** in the sidebar
2. Select a destination from the dropdown
3. Browse folders and files

## Interface

### File List

Each file shows:
- **Name**: File name with extension
- **Size**: File size (compressed if applicable)
- **Date**: Last modified timestamp
- **Status**: Lock icon if protected

### Filters

Filter backups by:
- **Job**: Show only backups from specific job
- **Date range**: Filter by backup date
- **Size**: Filter by file size

## File Types

### Backup Files

Main backup data:
```
backup_2024-01-15T12-00-00.sql       # Plain SQL
backup_2024-01-15T12-00-00.sql.gz    # Compressed
backup_2024-01-15T12-00-00.sql.gz.enc # Encrypted
```

### Metadata Files

Sidecar files with backup info:
```
backup_2024-01-15T12-00-00.sql.meta.json
```

Contains:
```json
{
  "jobName": "Daily MySQL",
  "sourceName": "Production DB",
  "databases": ["myapp", "users"],
  "compression": "GZIP",
  "encryption": {
    "enabled": true,
    "profileId": "uuid"
  },
  "size": 1048576,
  "duration": 45000,
  "timestamp": "2024-01-15T12:00:00Z"
}
```

## Actions

### View Details

Click on a file to see:
- Full metadata
- Backup source info
- Compression/encryption status
- File checksums

### Download

1. Click **Download** button
2. File downloads to your browser
3. Decryption happens automatically (if encrypted)
4. Decompression is **not** automatic

To decompress locally:
```bash
# Gzip
gunzip backup.sql.gz

# Brotli
brotli -d backup.sql.br
```

### Restore

1. Click **Restore** button
2. Select target database source
3. Configure options (see [Restore](/user-guide/features/restore))
4. Confirm and monitor progress

### Lock/Unlock

Protect important backups from retention:

1. Click **Lock** icon
2. Backup is now protected

Locked backups:
- ✅ Cannot be deleted by retention policies
- ✅ Don't count against retention limits
- ⚠️ Can still be manually deleted

### Delete

1. Click **Delete** button
2. Confirm deletion
3. Both `.enc` and `.meta.json` are removed

::: warning Permanent Action
Deleted files cannot be recovered from DBackup. Ensure you have another copy before deleting.
:::

## Organization

### Folder Structure

Backups are organized by job:
```
/storage-root/
├── mysql-daily/
│   ├── backup_2024-01-15.sql.gz
│   └── backup_2024-01-16.sql.gz
├── postgres-weekly/
│   └── backup_2024-01-14.sql.gz
└── mongodb-hourly/
    ├── backup_2024-01-15T00.archive.gz
    └── backup_2024-01-15T01.archive.gz
```

### Naming Convention

Backup names include timestamp:
```
{job-prefix}_{ISO-timestamp}.{extension}

Example:
backup_2024-01-15T12-00-00-123Z.sql.gz.enc
```

## Search and Filter

### Quick Search

Type in search box to filter by:
- File name
- Job name
- Date

### Advanced Filters

Click **Filters** to set:
- Date range
- Minimum/maximum size
- Specific job
- Locked status

## Bulk Actions

Select multiple files for:
- Bulk download
- Bulk delete
- Bulk lock/unlock

::: tip Shift+Click
Hold Shift to select a range of files.
:::

## Storage Statistics

View at top of explorer:
- **Total size**: All backups combined
- **File count**: Number of backup files
- **Latest backup**: Most recent timestamp
- **Oldest backup**: Earliest timestamp

## Performance

### Large File Lists

For destinations with many files:
- Pagination loads files in batches
- Filters help narrow results
- Consider cleaning up old backups

### Download Speed

Downloads are limited by:
- Storage provider bandwidth
- Your internet connection
- Decryption processing (if encrypted)

## Troubleshooting

### Files Not Showing

**Causes**:
- Empty destination
- Wrong path prefix
- Permission issues

**Solutions**:
1. Verify destination configuration
2. Check backup job ran successfully
3. Test connection on destination

### Download Fails

**Causes**:
- Network timeout
- File too large
- Browser restrictions

**Solutions**:
1. Try again
2. Check browser download settings
3. Use smaller backup chunks

### Metadata Missing

**Causes**:
- Old backup format
- File manually copied
- Incomplete upload

**Solutions**:
1. Backup still works, just no metadata
2. Can restore by selecting manually
3. Future backups will have metadata

## Best Practices

1. **Regular cleanup**: Use retention policies
2. **Lock important backups**: Before migrations, updates
3. **Verify backups**: Download and test periodically
4. **Monitor size**: Watch storage growth
5. **Organize by job**: Clear naming conventions

## Next Steps

- [Restore](/user-guide/features/restore) - Restore from backup
- [Retention Policies](/user-guide/jobs/retention) - Automatic cleanup
- [Download and decrypt](/user-guide/security/recovery-kit) - Manual decryption
