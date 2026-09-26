# Redis

Redis is an in-memory data structure store used as a database, cache, message broker, and streaming engine. DBackup supports Redis backups using the native RDB snapshot format.

## Supported Versions

| Versions |
| :--- |
| 2.8+ |

::: info Valkey
[Valkey](https://valkey.io) is a Redis-compatible fork supported from version 7.2+. Use the dedicated **Valkey** source type for correct version display in DBackup. Existing Redis sources also connect to Valkey servers without changes.
:::

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup connects via TCP and runs `redis-cli` locally |
| **Over SSH** | DBackup connects via SSH and runs `redis-cli` on the remote host |

## Architecture

DBackup uses `redis-cli --rdb` to download RDB snapshots.

- Creates a consistent snapshot of all data
- Works with any Redis deployment (standalone, Sentinel)
- Doesn't require filesystem access to the Redis server
- Includes all 16 databases (0-15) in a single backup

## Configuration

::: info Credential Profiles
A [Credential Profile](/user-guide/security/credential-profiles) is **optional** for Redis — password-free instances can connect without one. If your Redis requires a password or ACL authentication, create a `USERNAME_PASSWORD` profile in **Settings → Vault → Credentials** first (username is optional for `requirepass`-only setups). SSH mode requires an `SSH_KEY` profile.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **How DBackup connects** | **Direct** or **Over SSH** | - | ✅ |
| **Host** | Redis server hostname or IP | `localhost` | ✅ |
| **Port** | Redis server port | `6379` | ✅ |
| **Login** | `USERNAME_PASSWORD` credential profile (username optional, used for ACL auth; password for `requirepass`) | - | ❌ |
| **Database** | Database index (0-15) for display purposes | `0` | ❌ |
| **TLS** | Enable TLS/SSL connection | `false` | ❌ |
| **Redis setup** | `standalone` or `sentinel`. The two Sentinel fields below appear for `sentinel` only. | `standalone` | ❌ |
| **Sentinel Master Name** | Master name for Sentinel mode | - | ❌ |
| **Sentinel Nodes** | Comma-separated Sentinel node addresses | - | ❌ |
| **Extra options** | Extra `redis-cli` flags | - | ❌ |

### SSH Mode Fields

These fields appear in the **SSH server** part when **How DBackup connects** is set to **Over SSH**:

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **SSH host** | SSH server hostname or IP | - | ✅ |
| **Port** | SSH server port | `22` | ❌ |
| **SSH login** | `SSH_KEY` credential profile (username + key or password) | - | ✅ |

## Example Configuration

### Standalone Redis

```
Host: redis.example.com
Port: 6379
Login: my-redis-password  (USERNAME_PASSWORD profile, password field)
```

### Redis with ACL (6.0+)

```
Host: redis.example.com
Port: 6379
Login: my-redis-user  (USERNAME_PASSWORD profile, username + password)
```

### Redis with TLS

```
Host: redis.example.com
Port: 6379
Login: my-redis-password  (USERNAME_PASSWORD profile)
TLS: Enabled
```

### Redis Sentinel

```
Mode: sentinel
Sentinel Master Name: mymaster
Sentinel Nodes: sentinel1:26379,sentinel2:26379,sentinel3:26379
Login: my-redis-password  (USERNAME_PASSWORD profile)
```

## Backup File Format

A Redis backup is one RDB snapshot, the native Redis format, and it always contains every logical database of the server whichever ones the job selected. It is stored inside a seekable archive as a single entry named `dump`:

- **Archive**: `backup_2026-02-02.tar`, compressed and encrypted per entry as the job configures
- **Downloaded dump**: `backup_2026-02-02_dump.rdb`, from **Download Dump** in the Storage Explorer

Backups written by earlier versions are plain files (`backup_2026-02-02.rdb`, `.rdb.gz` or `.rdb.gz.enc`) and restore through the same guide.

## Restore

::: warning Redis reads a dump only while it starts
Redis cannot load an RDB snapshot over the network. A restore stops Redis on its host, puts the dump into its data folder and starts it again, which replaces everything Redis holds.
:::

**Restore** on a Redis backup in the Storage Explorer opens a guide instead of the database step:

1. **Where does Redis run?** Pick **Docker**, **Docker Compose**, **Linux service** or **Windows service**, then name the container, the compose service or the service and the data folder. Turn off **Redis asks for a password** for an instance without one.
2. **Make the link.** The commands download the dump with a link that works once and for five minutes. Making it needs the Download permission, and it hands out the plain `dump.rdb`, decrypted and unpacked.
3. **Run the restore.** **Script** shows one script for the whole restore, **Manual** the same commands one step at a time with the link and every value filled in.

The script runs on the Redis host, on the Docker host or in the folder of the compose file, pasted into a shell or saved with **Download the script**. It does this, in this order:

- Asks for the password and passes it to `redis-cli` as `REDISCLI_AUTH`, so it lands in no command and no history.
- Checks that Redis answers, writes no append only file, keeps its data in the folder you named and reads `dump.rdb`. Otherwise it stops before it downloads or changes anything.
- Downloads the dump, stops Redis, keeps the old dump as `dump.rdb.before-restore`, puts the new one in place and starts Redis again.
- Waits up to two minutes for Redis to answer and lists the keys of every database with `INFO keyspace`.

A container is stopped with `docker stop -t 60` or `docker compose stop -t 60`, which keeps it off even with a restart policy and gives Redis time to save once more. A Linux service is stopped with `systemctl`, and `install` hands the new dump to the `redis` user. A pasted script is read in full before it asks for the password, and a failed check leaves the shell open.

On Windows the commands are PowerShell for Windows PowerShell 5.1 and PowerShell 7, run as an administrator. They stop and start the service with `Stop-Service` and `Start-Service` and expect `redis-cli` 5 or newer on the PATH, which reads the password from `REDISCLI_AUTH`, like the one of Redis for Windows. For another path or CLI, change `$Cli` at the top of the script. A saved script runs with `powershell -ExecutionPolicy Bypass -File restore-<job>.ps1`.

**Manual** pastes one block at a time, and the password gets a block of its own so its prompt never reads the next line. **Download here** in its first step takes the dump on this computer with a link of its own, for a Redis host that cannot reach DBackup. Copy it to the Redis host as `dump.rdb`.

### If Redis writes an append only file

With `appendonly yes` Redis loads its AOF when it starts and never reads `dump.rdb`, so the script stops before it changes anything. The guide lists what to do instead:

1. Keep a copy of the AOF, the folder `appendonlydir` or `appendonly.aof` before Redis 7. It is the only full copy of what Redis holds now.
2. Set `appendonly no` where Redis gets its settings, like `redis.conf`, the command of the container or the compose file, and restart Redis.
3. Run the script or the manual steps.
4. Run `redis-cli CONFIG SET appendonly yes`. Redis writes a new AOF from the restored data.
5. Set `appendonly yes` again where you changed it, so the AOF stays on after the next restart.

## Database Selection

Unlike relational databases, Redis uses numbered databases (0-15). When configuring a Redis source:

- **All databases** are always backed up together in the RDB snapshot
- The "Database" field is for display and connection testing only
- You cannot selectively backup individual Redis databases

## Required CLI Tools

The Redis adapter requires `redis-cli` to be installed.

### Direct Mode

`redis-cli` must be available on the DBackup server.

**Docker**: Already included in the DBackup image.

**Manual Installation**:
```bash
# Ubuntu/Debian
apt-get install redis-tools

# macOS
brew install redis

# Alpine
apk add redis
```

### SSH Mode

`redis-cli` must be installed on the **remote SSH server**:

```bash
# Ubuntu/Debian
apt-get install redis-tools

# RHEL/CentOS/Fedora
dnf install redis

# Alpine
apk add redis

# macOS
brew install redis
```

::: danger Important
In SSH mode, the `redis-cli` tool must be installed on the remote server. DBackup executes it remotely via SSH and streams the RDB output back.
:::

::: tip Host in SSH Mode
The **Host** field refers to the Redis hostname **as seen from the SSH server**. If Redis runs on the same machine as the SSH server, use `127.0.0.1` or `localhost`.
:::

## Troubleshooting

### Connection Refused

Ensure Redis is configured to accept remote connections:

```ini
# redis.conf
bind 0.0.0.0
protected-mode no  # Or use password authentication
```

### Authentication Failed

For Redis 6+ with ACL:
- Ensure the user has the `+sync` and `+psync` permissions for RDB downloads
- Or use the default user with the `requirepass` password

### TLS Certificate Errors

If using self-signed certificates, you may need to add `--insecure` to the **Extra options** field.

### SSH: Binary Not Found

```
Required binary not found on remote server. Tried: redis-cli
```

**Solution:** Install Redis tools on the remote server:
```bash
# Ubuntu/Debian
apt-get install redis-tools
```

### SSH: Connection Refused

**Solution:**
1. Verify SSH is running: `systemctl status sshd`
2. Check SSH port and firewall rules
3. Test manually: `ssh user@host`

## See Also

- [Storage Explorer](/user-guide/features/storage-explorer) - Browse and download backups
- [Restore Guide](/user-guide/features/restore) - General restore documentation
- [Encryption](/user-guide/security/encryption) - Encrypting your backups
