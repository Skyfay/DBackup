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

| Column | Description |
| :--- | :--- |
| **Name** | Backup filename with extension |
| **Source** | Database adapter icon (MySQL, PostgreSQL, etc.) |
| **Size** | Compressed file size on storage |
| **Date** | Last modified timestamp |
| **Triggered by** | Who or what initiated the backup: **Manual** (username), **Scheduler**, or **API** (API key name). Populated from `.meta.json` - only available for backups created after v2.3.2. |
| **Verification** | Result of the last integrity check: passed, failed, or not yet verified. |
| **Status** | Lock icon if the backup is protected from retention |

The file list defaults to sorting by **Last Modified** descending, so the most recent backups appear first.

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

### Browse Files

Backups that include directory sources carry a file index, and show a **Browse files**
action. It opens a folder tree of everything inside the backup.

Listing folders reads only a small index file stored next to the backup, so browsing a
100 GB backup transfers a few megabytes rather than the whole thing.

Select any mix of files and folders (selecting a folder takes everything inside it), then
choose where they go:

| Target | What happens |
| :--- | :--- |
| **Download** | The selection is streamed to your browser as a single `.tar.gz` |
| **Original location** | Files are written back to the path they were collected from, overwriting what is there |
| **Other destination** | Files are written into any configured storage destination, under a path you choose |

Only the selected files are read out of the backup. Destinations that support ranged reads
answer with a handful of small requests instead of transferring the archive:

| Ranged reads | Full download per restore |
| :--- | :--- |
| Local Filesystem, S3 (and compatible), SFTP, WebDAV, Google Drive, OneDrive, FTP, Dropbox | SMB, Rsync |

On SMB and Rsync the archive is fetched once per restore, not once per file.

::: tip Extract locally instead
`.tar.gz` opens natively on macOS, Linux and Windows 11. On older Windows use 7-Zip, or
run `tar -xzf selection.tar.gz` from a terminal.
:::

### Download

1. Click **Download** button
2. File downloads to your browser
3. Decryption happens automatically (if encrypted)
4. Decompression is **not** automatic

For encrypted files, you'll see a dropdown with options:
- **Download Encrypted (.enc)**: Downloads the raw encrypted file
- **Download Decrypted**: Decrypts before download
- **wget / curl Link**: Opens the Download Link modal

To decompress locally:
```bash
# Gzip
gunzip backup.sql.gz

# Brotli
brotli -d backup.sql.br
```

### wget / curl Download Links

::: tip Server-Side Downloads
For downloading backups directly to a remote server (e.g., during Redis restore), you can generate temporary download URLs that work with wget or curl.
:::

1. Click **Download** button on any backup
2. Select **wget / curl Link** from the dropdown
3. Choose download format:
   - **Decrypted**: File will be decrypted server-side (recommended)
   - **Encrypted (.enc)**: Downloads raw encrypted file
4. Click **Generate Download Link**
5. Copy the provided wget or curl command

**Generated Commands:**
```bash
# wget
wget -O "backup.sql.gz" "https://your-server/api/storage/public-download?token=..."

# curl
curl -o "backup.sql.gz" "https://your-server/api/storage/public-download?token=..."
```

**Important:**
- Links expire after **5 minutes**
- Links are **single-use** (token consumed on first download)
- The modal shows a live countdown timer
- You can generate a new link anytime

### Verify Integrity

Check that a stored backup file matches its recorded checksums:

1. Click **Verify** on a file row (or open the detail dialog)
2. A tracked execution starts - progress is visible in History
3. The result (passed / failed) is written back to the file row and `.meta.json`

For S3, Cloudflare R2, Hetzner, Google Drive, and OneDrive, verification uses the native checksum API - no re-download required. For other destinations the file is downloaded and checksums are computed locally.

::: tip
Enable post-upload verification for all new backups in **Settings → System → Post-Upload Verification**.
:::

### Restore

1. Click **Restore** button
2. Select target database source
3. Configure options (see [Restore](/user-guide/features/restore))
4. Confirm and monitor progress

::: warning Glacier / Deep Archive
Backups stored in S3 `GLACIER` or `DEEP_ARCHIVE` show an orange badge and have **Restore** and **Download** disabled. Restore the object via the AWS Console first, then retry from here.
:::

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

## File Listing Cache

File listings are cached in SQLite for instant repeat visits. You will never see a loading spinner for a destination you have opened before.

The cache is automatically updated when:
- A new backup is created or uploaded
- A backup is deleted or locked/unlocked
- A verification result is written

The **Pre-warm Storage Cache** system task (hourly, enabled by default) reconciles caches against remote storage and pre-populates the cache for destinations not yet visited. If a backup file is deleted directly on the storage backend (outside DBackup), the next cache reconciliation will detect and remove the stale entry.

## Execution Log Export

From any execution detail dialog (History or live progress), you can:
- **Copy to clipboard** - copies the full log text
- **Download as `.log`** - saves the log as a file

Sensitive data (IP addresses, credentials, connection strings) is automatically redacted before export.

## Performance

### Large File Lists

For destinations with many files:
- The file listing cache provides instant repeat loads
- Filters help narrow results
- Consider cleaning up old backups with retention policies

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
