# Local Storage

Store backups on the local filesystem of the server running DBackup. Simplest option - no external service required.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **Base Path** | Absolute directory path for backups | `/backups` | ❌ |

## Setup Guide

1. Go to **Connections** → **Backup Destinations** → **Add New** → **Local Storage**
2. Enter a name and (optionally) customize the **Base Path**
3. Click **Test** to verify write access

::: warning Docker Users
The Base Path must be a path **inside the container**. Map it to your host via a Docker volume:

```yaml
volumes:
  - /host/path/to/backups:/backups
```

The default `/backups` path works with the default `docker-compose.yml` configuration.
:::

## How It Works

- Backups are written directly to the specified directory
- DBackup creates subfolders per job automatically (e.g. `/backups/my-job/`)
- No network transfer - fastest destination option
- File permissions inherit from the DBackup process user

## Troubleshooting

### Permission Denied

```
EACCES: permission denied
```

**Solution:** Ensure the DBackup process (or container user) has read/write access to the target directory. In Docker, verify the volume mount and run `chmod -R 777 /host/path` or use matching UIDs.

### Disk Full

```
ENOSPC: no space left on device
```

**Solution:** Free disk space or mount a larger volume. Use [Retention Policies](/user-guide/jobs/retention) to auto-delete old backups.

### Path Does Not Exist

```
ENOENT: no such file or directory
```

**Solution:** DBackup creates subdirectories automatically, but the **base directory itself** must exist. Create it manually or update your Docker volume mount.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
