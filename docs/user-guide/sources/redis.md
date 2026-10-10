# Redis

Redis is an in-memory data store used as a database, cache, message broker, and streaming engine. DBackup backs it up as an RDB snapshot, the native Redis format.

## Supported Versions

| Versions |
| :--- |
| 2.8+ |

::: info Valkey
[Valkey](https://valkey.io) is a Redis-compatible fork supported from version 7.2+. Use the dedicated **Valkey** source type so the source is labelled Valkey and its restore guide uses `valkey-cli`. A Redis source connects to a Valkey server as well.
:::

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup connects to the Redis port and runs `redis-cli` itself |
| **Over SSH** | DBackup logs into a server over SSH and runs `redis-cli` there. Marked **Beta** in the form |

## Architecture

DBackup runs `redis-cli --rdb`, which asks the server for a snapshot the way a replica does.

- The snapshot is consistent and holds every logical database the server has, whichever ones the job selected
- No filesystem access to the Redis server is needed
- DBackup connects to the one server in **Host** and **Port**. Sentinel and Cluster are not supported yet
- Over SSH, `redis-cli` writes the snapshot to a temporary file on the SSH server. DBackup fetches it over SFTP, or with `cat` where SFTP is not available, and deletes it afterwards

## Configuration

::: info Credential Profiles
A [Credential Profile](/user-guide/security/credential-profiles) is **optional** for Redis, so a password-free instance connects without one. If your Redis requires a password or an ACL user, create a `USERNAME_PASSWORD` profile in **Vault → Credentials** first. The profile needs a username, so use `default` for a server that only sets `requirepass` (Redis 6 and later). SSH mode requires an `SSH_KEY` profile.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **How DBackup connects** | **Direct** or **Over SSH** | - | ✅ |
| **Host** | Redis server hostname or IP | `localhost` | ✅ |
| **Port** | Redis server port | `6379` | ✅ |
| **Login** | `USERNAME_PASSWORD` credential profile, the username for ACL auth and the password | - | ❌ |
| **Redis setup** | Leave it at **Standalone**. **Sentinel** is offered in the form but not supported yet, and DBackup always connects to **Host** and **Port** | Standalone | ❌ |
| **Database** | Database index `redis-cli` selects with `-n` when it is not 0. The backup holds every database either way | `0` | ❌ |
| **Extra options** | Shown in the form but ignored. Nothing typed here reaches `redis-cli` | - | ❌ |
| **TLS** | Connect with `redis-cli --tls` | Off | ❌ |

### SSH Mode Fields

These fields appear in the **SSH server** part when **How DBackup connects** is set to **Over SSH**:

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **SSH host** | SSH server hostname or IP | - | ✅ |
| **Port** | SSH server port | `22` | ❌ |
| **SSH login** | `SSH_KEY` credential profile (username + key or password) | - | ✅ |

## Backup File Format

A Redis backup is one RDB snapshot, the native Redis format, and it always contains every logical database of the server whichever ones the job selected. It is stored inside a seekable archive as a single entry named `dump`:

- **Archive**: `backup_2026-02-02.tar`, compressed and encrypted per entry as the job configures
- **Downloaded dump**: `backup_2026-02-02_dump.rdb`, from **Download...** on the Backups page

Backups written by earlier versions are plain files (`backup_2026-02-02.rdb`, `.rdb.gz` or `.rdb.gz.enc`) and restore through the same guide.

## Restore

::: warning Redis reads a dump only while it starts
Redis cannot load an RDB snapshot over the network. A restore stops Redis on its host, puts the dump into its data folder and starts it again, which replaces everything Redis holds.
:::

**Restore** on a Redis backup on the Backups page opens a guide instead of the database step:

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

Redis numbers its databases instead of naming them, 16 unless the server's `databases` setting says otherwise. A job may pick some of them, but the RDB snapshot always holds all of them, so a single Redis database cannot be backed up on its own.

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

For an ACL user (Redis 6+), the health check that runs every minute sends `PING` and `INFO server`, and the backup sends `SYNC`. A user with these rights covers both:

```
ACL SETUSER dbackup on >secure_password_here +ping +info +sync +psync
```

Add `+select` when **Database** is not 0. Alternatively, use the `default` user with the `requirepass` password.

### TLS Connection Fails

**Solution:** With **TLS** on, `redis-cli` checks the server certificate against the CA certificates trusted on the machine it runs on, and presents no client certificate. **Extra options** are ignored, so `--cacert`, `--insecure` or `--cert` cannot be added. Use a certificate from a CA that machine trusts, and set `tls-auth-clients` to `optional` or `no` on the server.

### SSH: Binary Not Found

```
None of the following binaries were found on ssh://user@host:22: redis-cli
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

- [Backups](/user-guide/features/backups) - Browse and download backups
- [Restore Guide](/user-guide/features/restore) - General restore documentation
- [Encryption](/user-guide/security/encryption) - Encrypting your backups
