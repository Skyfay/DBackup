# SQLite

Configure SQLite databases for backup, both local files and remote via SSH.

## Overview

SQLite is a file-based database. DBackup supports two modes:

| Mode | Description |
| :--- | :--- |
| **Local** | SQLite file on the same machine as DBackup |
| **SSH** | SQLite file on a remote server via SSH |

## Configuration

::: info SSH Credential Profile (SSH mode only)
SQLite in SSH mode requires an `SSH_KEY` [Credential Profile](/user-guide/security/credential-profiles). Create one in **Settings → Vault → Credentials** before saving the source. Local mode does not require a credential profile.
:::

### Local Mode

| Field | Description |
| :--- | :--- |
| **Where the file is** | Pick **This machine** |
| **Database file** | Absolute path to the `.sqlite` or `.db` file |

### SSH Mode

| Field | Description |
| :--- | :--- |
| **Where the file is** | Pick **Over SSH** |
| **SSH host** | SSH server hostname, in the **SSH server** part |
| **Port** | SSH port (default: `22`) |
| **SSH login** | `SSH_KEY` credential profile (username + key or password) |
| **Database file** | Remote path to the SQLite file, in the **Database file** part |
| **sqlite3 binary** | Remote path to the `sqlite3` binary (default: `sqlite3`) |

## Local Mode Setup

### Docker Configuration

When running DBackup in Docker, mount the **directory** containing the SQLite database - not the file itself:

```yaml
services:
  dbackup:
    volumes:
      - /path/to/app/data:/data/app
```

Then configure the source with path `/data/app/data.db` (or whatever the filename is inside that directory).

::: warning Mount the directory, not the file
DBackup uses the SQLite Online Backup API (`.backup`), which requires access to the WAL (`-wal`) and SHM (`-shm`) companion files that live alongside the database file. A file-level bind mount (`/host/data.db:/container/data.db`) only exposes the single `.db` file and causes **"attempt to write a readonly database"** errors when WAL/SHM files are needed.

Always mount the parent directory so all companion files are accessible.
:::

### File Permissions

Ensure DBackup can read the file:
```bash
chmod 644 /path/to/database.db
```

## SSH Mode Setup

1. Create an `SSH_KEY` credential profile in **Settings → Vault → Credentials** ([guide](/user-guide/security/credential-profiles))
2. Pick **Over SSH** under **Where the file is**
3. In the **SSH server** part, enter host and port
4. Pick the credential profile under **SSH login**
5. In the **Database file** part, enter the remote path to the SQLite file

::: tip Auth types in the credential profile
The `SSH_KEY` profile supports Password, Private Key (PEM), and SSH Agent. Configure the auth type when creating the profile.
:::

## Backup Process

DBackup uses the SQLite Online Backup API (`.backup` command):

```bash
sqlite3 /path/to/database.db ".backup /tmp/backup.db"
```

This produces a proper binary `.db` file and is the correct way to back up SQLite databases, especially those using WAL mode. The old `.dump` approach (SQL text export) produced near-empty output for WAL-mode databases.

### Backup Safety

The Online Backup API is safe to run on a live database:
- Uses SQLite's built-in transaction handling
- Produces a consistent binary snapshot
- Works correctly with WAL mode databases
- No locking issues - reads are non-blocking

## SSH Remote Backup Flow

For SSH mode, the process is:

1. Connect to remote server via SSH
2. Execute `.dump` command remotely
3. Stream output back to DBackup
4. Apply compression/encryption locally
5. Upload to storage destination

This means:
- No large file transfers (streaming)
- Remote server needs `sqlite3` installed
- Bandwidth efficient

## Remote File Browser

When configuring SSH mode, you can:

1. Click "Browse" to open remote file browser
2. Navigate the remote filesystem
3. Select the SQLite database file

This helps find the correct path without manual entry.

## Troubleshooting

### File Not Found

```
Error: unable to open database file
```

**Solutions**:
1. Verify the path is correct
2. Check file permissions
3. For Docker, ensure volume is mounted

### SSH Connection Failed

```
Error: Connection refused
```

**Solutions**:
1. Check SSH server is running
2. Verify port number
3. Check firewall rules
4. Test with `ssh user@host` manually

### Permission Denied (SSH)

```
Error: Permission denied (publickey,password)
```

**Solutions**:
1. Verify credentials
2. Check SSH key format (must be PEM/OpenSSH)
3. Ensure user has shell access

### sqlite3 Not Found

```
Error: sqlite3: command not found
```

**Solutions**:
1. Install SQLite on the remote server
2. Or specify full path in "SQLite Binary" field:
   ```
   /usr/bin/sqlite3
   ```

## Restore

### Local Restore

1. Go to **Storage Explorer**
2. Find your backup file
3. Click **Restore**
4. Select target SQLite source
5. Choose restore mode:
   - **Overwrite**: Replace entire database
   - **Clean Slate**: Delete file first, then restore

### Path Remapping

You can restore to a different path:
1. Enable "Remap Path" option
2. Enter new destination path
3. The backup will be restored to the new location

## Best Practices

1. **Use WAL mode** for better concurrent access:
   ```sql
   PRAGMA journal_mode=WAL;
   ```

2. **Regular VACUUM** before backup for smaller files:
   ```sql
   VACUUM;
   ```

3. **Mount read-only** in Docker when possible

4. **SSH key authentication** is more secure than passwords

5. **Test restore** to verify backup integrity

6. **Enable compression** - SQLite dumps compress very well

7. **Consider encryption** for sensitive data
