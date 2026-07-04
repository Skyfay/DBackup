# Firebird

Firebird is an open-source relational database. DBackup supports Firebird backups using the native `gbak` backup/restore utility.

## Supported Versions

| Versions |
| :--- |
| 3.x, 4.x, 5.x |

::: info Legacy versions
Firebird 2.5 and the legacy `.gdb` file format are not supported.
:::

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup runs `gbak`/`isql` locally and connects to the remote Firebird server over its wire protocol (port 3050) |
| **SSH** | DBackup connects via SSH and runs `gbak`/`isql` on the remote host, reading the local `.fdb` path directly |

## Architecture

Firebird has no server-side "list all databases" command - every `.fdb` file is a standalone database with no central registry to query. Because of this, a Firebird source works differently from other adapters in one respect:

- **You enter a list of database aliases once**, when creating the source: an alias name (shown everywhere else in DBackup) mapped to the actual file path on the Firebird server.
- **Everywhere else is unchanged** - the job form's database picker, the backup pipeline, and the restore UI all work with these alias names exactly like they would with any other adapter's database list.
- If a new database is added to the Firebird server later, it won't appear automatically - add its alias and path to the source configuration.

## Configuration

::: info Credential Profiles
A `USERNAME_PASSWORD` credential profile is required for the SYSDBA (or equivalent) user. SSH mode additionally requires an `SSH_KEY` profile.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Connection Mode** | Direct (TCP) or SSH | `Direct` | ✅ |
| **Host** | Firebird server hostname or IP | `localhost` | ✅ |
| **Port** | Firebird server port | `3050` | ✅ |
| **Primary Credential** | `USERNAME_PASSWORD` credential profile | - | ✅ |
| **Database Aliases** | List of `{ name, path }` entries - the alias shown in DBackup and the `.fdb` path on the Firebird server | - | ✅ (at least one) |
| **Additional Options** | Extra `gbak` flags | - | ❌ |

### SSH Mode Fields

These fields appear when **Connection Mode** is set to **SSH**:

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **SSH Host** | SSH server hostname or IP | - | ✅ |
| **SSH Port** | SSH server port | `22` | ❌ |
| **SSH Credential** | `SSH_KEY` credential profile (username + key or password) | - | ✅ |

::: tip Paths in SSH Mode
In SSH mode, database paths are local paths **on the SSH target**, since `gbak` runs there directly - not paths as seen from the Firebird server's own network. In Direct mode, paths are as seen from the Firebird server (aliases the server itself resolves).
:::

## Example Configuration

### Direct Mode

```
Host: firebird.example.com
Port: 3050
Primary Credential: my-firebird-sysdba  (USERNAME_PASSWORD profile)
Database Aliases:
  erp  -> /data/erp.fdb
  crm  -> /data/crm.fdb
```

### SSH Mode

```
SSH Host: firebird.example.com
SSH Credential: my-firebird-ssh-key  (SSH_KEY profile)
Database Aliases:
  erp  -> /var/lib/firebird/data/erp.fdb
```

## Backup File Format

- **Single alias selected**: stored directly as a `.fbk` file (gbak's native backup format) - no archive wrapper
- **Multiple aliases selected**: packed into a TAR archive containing one `.fbk` file per database plus a manifest

With compression and encryption enabled:
- Single database: `backup_2026-02-02.fbk.gz.enc`
- Multiple databases: `backup_2026-02-02.tar.gz.enc`

## Restore Limitations

::: warning Restore is scoped to pre-configured aliases
Because a Firebird alias has no meaning without a matching file path, restore only lets you pick among the **aliases already configured** on the target source (shown as a dropdown) - you cannot restore into an arbitrary new database name. To restore into a new location, add its alias and path to the target source first, then restore into it.
:::

Restoring always replaces the target file's contents (`gbak -rep`) - there's no separate "create only" step, so make sure you're restoring into the intended alias.

DBackup also blocks restoring a backup taken on a newer Firebird version onto an older target server, consistent with the version guard used by other adapters.

## Required CLI Tools

The Firebird adapter requires `gbak` (backup/restore) and `isql` (connection test/version check).

### Direct Mode

Already included in the DBackup Docker image.

**Manual Installation**: install the Firebird client tools matching your distribution, or download the official release from the [Firebird project](https://github.com/FirebirdSQL/firebird/releases).

### SSH Mode

`gbak` and `isql` must be installed on the **remote SSH server**:

```bash
# Debian/Ubuntu (client package version may lag behind the latest server release)
apt-get install firebird3.0-utils
```

::: danger Important
In SSH mode, `gbak`/`isql` must be installed on the remote server. DBackup executes them remotely via SSH and streams the backup output back.
:::

## Troubleshooting

### Unknown Database Alias

```
Unknown Firebird database alias "accounting". Configured aliases: erp, crm.
```

**Solution:** Add the missing alias and its `.fdb` path to the source configuration, or pick one of the listed aliases.

### Connection Refused

Ensure the Firebird server is listening on the configured port and accepts remote connections (check `firebird.conf` / `RemoteBindAddress`).

### SSH: Binary Not Found

```
Required binary not found on remote server. Tried: gbak
```

**Solution:** Install the Firebird client tools on the remote server (see above).

### Restore Blocked by Version Guard

```
Running restore of a newer database version on an older server is not recommended...
```

**Solution:** Restore onto a Firebird server running the same or a newer version than the one the backup was taken on.

## See Also

- [Storage Explorer](/user-guide/features/storage-explorer) - Browse and download backups
- [Restore Guide](/user-guide/features/restore) - General restore documentation
- [Encryption](/user-guide/security/encryption) - Encrypting your backups
