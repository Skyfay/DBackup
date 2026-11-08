# Local Storage

Store backups on the local filesystem of the server running DBackup. Simplest option - no external service required.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **Folder** | Absolute directory path for backups. The folder button beside the field browses for it, the folder you stand in is the one you pick | `/backups` | ❌ |

::: info Platform admins only
Local Storage reaches the files of the server DBackup runs on, so only a platform admin, signed in with a session in the home tenant, adds, changes, copies, tests or browses one, and restores one from Recently deleted. Anyone else opens it read-only, and the members of the home tenant still pick it in their jobs. See [Connections to the Server DBackup Runs On](/user-guide/admin/tenants#connections-to-the-server-dbackup-runs-on).
:::

## Setup Guide

1. Go to **Connections** → **Destinations** → **New destination** → **Local Storage**
2. Enter a name and (optionally) change the **Folder**
3. Click **Test connection** to verify write access

::: warning Docker Users
The folder must be a path **inside the container**. Map it to your host via a Docker volume:

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
- No run reads or writes DBackup's own data, whoever saved the connection, a platform admin too: the folder of its database, the folder of its TLS certificate, its temporary folder (`TMPDIR`, `/tmp` by default) or the `config-backups` folder of the configuration backup, or a folder that holds one of them, also through a symbolic link. The folder of a job below the destination counts as well. A platform admin may still save such a folder, for example as the destination of the configuration backup itself
- A path below the folder never leads out of it through a symbolic link. DBackup follows every link of a path it writes, reads, lists or deletes and refuses one that ends outside the folder, so a folder of a job that is a link to another place on the server fails instead of writing there. A restore lays a symbolic link only when its target stays inside the folder too, read from the folder the link lies in, and lists any other as failed
- The storage statistics, the cache of the backup lists and the integrity check leave out a destination whose folder reaches DBackup's own data, unless it is the destination of the configuration backup

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
- [Backups](/user-guide/features/backups)
