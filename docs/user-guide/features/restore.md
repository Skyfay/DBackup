# Restore

Restore databases from your backups.

## Overview

DBackup can restore backups directly to database servers. The restore process:

1. Reads the selected databases out of the backup
2. Decrypts (if encrypted)
3. Decompresses (if compressed)
4. Executes restore commands
5. Verifies completion

Backups are seekable archives that store every database as its own entry. On destinations that serve byte ranges, restoring one database out of a backup of a whole server transfers only that database. Backups written by earlier versions are downloaded in full first, as they always were.

## Starting a Restore

### From Storage Explorer

1. Go to **Storage Explorer** in the sidebar
2. Click the backup, then **Restore** in its panel, or pick **Restore** in the menu at the end of its row
3. Pick the server and the databases, then the folders, and check the bar at the foot of the page
4. Click **Restore** and confirm

The head of the page names the job, when the backup was made and the destination it reads from, with a dot for whether that destination answers right now. Beside it a small timeline shows every backup of the job over a month. A click on another one restores that one instead, without going back to the Storage Explorer.

### From History

1. Go to **History** in sidebar
2. Find successful backup execution
3. Click **Restore from this backup**
4. Configure options

## Restore Options

A backup with databases and folders is restored in two steps, the databases first and the files second. A backup with only one of them has a single step. The bar at the foot of the page says in one sentence what the restore does, like "shop is overwritten, billing comes back as billing_restored", and when **Restore** waits, it says why.

### Target Server

**Restore into** picks the server the databases go to. It offers only servers of the kind of the backup, and New in its list adds one. Once a server is picked, DBackup compares its version with the one the backup was made on. A backup of a newer version than the server is refused, see [Version Guard](#version-guard).

### Databases

Every database of the backup is a row beside what the server has:

| Column | Description |
| :--- | :--- |
| **In the backup** | The database and its size in the backup. The box decides whether it comes back |
| **On the server afterwards** | The name it gets there. A new name restores a copy beside the one there |
| **What happens** | **Overwrites** with the size of the database there now, or **New** |
| **There now** | The size of the database of that name on the server now |

The databases only the server has follow at the end and stay as they are. The filters above the rows show all of them, only the overwritten, the new ones, the ones that stay or the ones left out, and the search finds one among many. **Restore as a copy** gives the databases shown that would overwrite one a free name like `shop_restored`, and **Own names** takes them back. With the download permission, each row can download its database as a dump.

The switch at the right of the toolbar shows the same as **Lines**: what comes back on the left, where it goes on the right, and a line between them, amber when it overwrites and green when it is new. Databases that do the same under their own names share one thick line, so a backup of 50 databases reads as quickly as one of 3. A click on a bundle opens its rows.

An older backup of one dump without the names of its databases goes into its original database, or under a new name.

### Folders

Every folder source of the backup is a row with:

- **A directory source and a path** it goes to, with a folder browser that opens at the deepest folder of the path that exists. A Docker volume is picked whole. The path is filled with where the folder was collected while that source exists, and **Put back where it was** returns to it.
- **What lies there**: **Has files** when files of the same name are replaced, **Empty**, or **Not checked** when DBackup could not look. A Docker volume that exists is emptied before the backup goes in.
- **A file tree**, **All files** by default, to restore only some folders or files. It loads level by level from the index of the backup, so even huge backups open at once.

**Leave out** applies patterns to every folder, from the presets and typed by hand, with the presets starred as default picked. The foot counts the picked files and their size, warns when the destination cannot read parts of a file, and with the download permission offers **Download the picked files** as a `.tar.gz`.

A server is only needed when a database is picked, so restoring only the folders of a backup with both works without one.

::: info Incremental snapshots
Snapshots from an [incremental chain](/user-guide/features/backup-modes) restore transparently. The page shows where the snapshot sits in its chain and reads the other archives by itself. If an archive of the chain is missing, the restore is refused up front with the missing file named, rather than failing halfway.
:::

### Before and After the Start

**Restore** asks first, in amber, and lists each database with the name it gets and whether it overwrites one, and each folder with where it goes. The restore then runs in the background, and the page moves on to its run in History, or back to the Storage Explorer when **Auto-redirect on job start** is off in your preferences.

A start the server turns down keeps the page and says why, so the choices can be changed and started again. When the login of the server may not create databases, the page offers an admin login for this one run. It is used for `CREATE DATABASE` only and not saved.

## Restore Process

### Pipeline

```
1. Read
   └── Fetch the selected entries by byte range
   └── Older backups: download the whole file

2. Decrypt (if needed)
   └── Use encryption profile
   └── Smart key discovery

3. Decompress (if needed)
   └── Gzip or Brotli

4. Integrity Check
   └── Compare each dump with its recorded SHA-256

5. Pre-flight Checks
   └── Version compatibility
   └── Permission verification

6. Restore
   └── Execute database-specific restore

7. Verification
   └── Check for errors
   └── Validate completion

8. Cleanup
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

### Azure SQL Database

```bash
sqlpackage /Action:Import /SourceFile:backup.bacpac /TargetConnectionString:"..."
```

- A BACPAC import always creates the database, so restoring onto an existing name **drops it first**
- Azure keeps a dropped database recoverable through **Deleted databases** on the logical server
- Most of the runtime is Azure creating the database, not moving data, so a small database takes about as long as a large one
- See [Azure SQL Database source](/user-guide/sources/azure-sql) for the full caveats

### Firebird

```bash
gbak -rep -user sysdba -password *** backup.fbk database.fdb
```

- Restore target is limited to the source's pre-configured database aliases
- Always replaces the target file's contents (no separate create-only step)
- See [Firebird source](/user-guide/sources/firebird) for alias configuration

### Redis and Valkey

- Redis reads a dump only while it starts, so DBackup cannot restore it over the network
- **Restore** opens a guide instead, with one script for a Docker container, a Compose service, a Linux service or a Windows service, or the same commands step by step
- See [Restore in the Redis guide](/user-guide/sources/redis#restore) for the script and what to do about an append only file

## Safety Features

### Version Guard

Prevents restoring newer backups to older servers:

```
❌ MySQL 8.0 backup → MySQL 5.7 server
✅ MySQL 5.7 backup → MySQL 8.0 server
```

### Overwrite Protection

Before anything is overwritten:
1. Each row says **Overwrites** with the size of the database there now
2. The confirmation lists what is overwritten and asks in amber
3. Consider a backup of the target first

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

1. **Automatic Detection**: DBackup lists the databases from the backup's index, or from the TAR manifest of an older backup
2. **Database Selection**: Choose which databases to restore
3. **Rename Support**: Map databases to different names
4. **Progress Tracking**: Per-database progress indication
5. **Download**: With the download permission, each row also offers the database as a plain dump

```
Multi-DB Backup Contents:
┌─────────────────────────────────────────┐
│ ☑ production    →  staging_copy         │
│ ☑ users         →  users_test           │
│ ☐ logs          →  (skip)               │
│ ☑ config        →  config               │
└─────────────────────────────────────────┘
```

Each selected database is restored individually, allowing granular control over what gets restored and where. Only the selected databases are read from the destination, so restoring one customer's database out of a shared server's backup does not wait for all the others to download.

Through the API, a restore of exactly one database can still name its target with `targetDatabaseName` alone. With several databases selected that field is ignored, and `databaseMapping` renames them instead.

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

If Smart Recovery cannot automatically identify a matching key (e.g. after a key delete and reimport), a **"Encryption Key Required"** dialog appears. You can:
1. Select a vault profile from the dropdown to try
2. Paste the raw hex key directly

If you no longer have the key, use the [Recovery Kit](/user-guide/security/recovery-kit) for offline decryption.

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
