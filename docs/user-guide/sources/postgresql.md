# PostgreSQL

Back up PostgreSQL databases with `pg_dump`, one database at a time.

## Supported Versions

| Versions |
| :--- |
| 12, 13, 14, 15, 16, 17, 18 |

The DBackup image ships `pg_dump` 18, which can dump older servers. Over SSH the `pg_dump` installed on the SSH server is used instead.

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup connects to the database port and runs `pg_dump` itself |
| **Over SSH** (beta) | DBackup logs into a server over SSH and runs `pg_dump` there |

## Prerequisites

### Direct Mode

The DBackup server needs `pg_dump`, `pg_restore` and `psql`. The Docker image includes them.

### SSH Mode

DBackup runs the client tools on the SSH server, so they have to be installed there:

| Tool | Used for |
| :--- | :--- |
| `pg_dump` | Backups |
| `psql` | Test connection, health checks, listing the databases (also for **All databases** in a job) and creating a missing database on restore |
| `pg_restore` | Restores |

```bash
apt-get install postgresql-client   # Ubuntu/Debian
dnf install postgresql              # RHEL/CentOS/Fedora
apk add postgresql-client           # Alpine
```

::: warning Client version over SSH
`pg_dump` refuses a server newer than itself. The client on the SSH server has to be at least the version of the PostgreSQL server it backs up.
:::

## Configuration

::: info Credential Profiles required
PostgreSQL requires a [Credential Profile](/user-guide/security/credential-profiles). Create a `USERNAME_PASSWORD` profile in **Vault → Credentials** before saving the source. SSH mode additionally requires an `SSH_KEY` profile.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **How DBackup connects** | **Direct** or **Over SSH** | - | ✅ |
| **Host** | Database server hostname, over SSH as seen from the SSH server | `localhost` | ✅ |
| **Port** | PostgreSQL port | `5432` | ✅ |
| **Login** | `USERNAME_PASSWORD` credential profile | - | ✅ |
| **SSH host** | SSH server hostname or IP, over SSH only | - | ✅ |
| **Port** | SSH server port, over SSH only | `22` | ❌ |
| **SSH login** | `SSH_KEY` credential profile, over SSH only | - | ✅ |
| **Extra options** | Extra `pg_dump` flags, added after the ones DBackup sets | - | ❌ |

The source has no database field. Which databases to back up is picked in the **Source** part of the job. **All databases** lists them again on every run with `SELECT datname FROM pg_database WHERE datistemplate = false`, so a database added later is backed up too, the `postgres` database included.

```bash
# Extra options examples
--exclude-table=logs --exclude-table=sessions   # leave out tables
--exclude-table-data=audit_log                  # keep the table, leave out its rows
--schema=public --schema=app                    # only some schemas
```

## Setup Guide

### 1. Create a Backup User

```sql
CREATE USER dbackup WITH PASSWORD 'secure_password_here';
GRANT CONNECT ON DATABASE mydb TO dbackup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbackup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO dbackup;

-- Tables created later
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dbackup;
```

To back up every database, grant `pg_read_all_data` (PostgreSQL 14 and later) or make the user a superuser:

```sql
GRANT pg_read_all_data TO dbackup;
```

### 2. Configure in DBackup

1. Go to **Connections** → **Databases** → **New database** and select **PostgreSQL**
2. Under **How DBackup connects**, pick **Direct** or **Over SSH**
3. Direct: enter **Host** and **Port** and pick or create the **Login**
4. Over SSH: fill in the **SSH server** part and click **Test SSH**, then enter host, port and **Login** in the **Database** part
5. Click **Test connection**, then **Create database**, and pick the databases in the job that uses the source

::: tip Host in SSH Mode
The **Host** is the database as seen from the SSH server. If PostgreSQL runs on that machine, use `127.0.0.1`. `pg_dump` connects over TCP, so `pg_hba.conf` needs a `host` line for that address.
:::

### 3. Docker Network

A database container in the same Docker network as DBackup is reached by its service name, like `postgres`. For a database on the host machine, enter `host.docker.internal` as **Host**. Docker Desktop knows that name. Docker Engine on Linux needs it added to the DBackup service:

```yaml
services:
  dbackup:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

PostgreSQL then has to listen on an address the container reaches, see [Connection Refused](#connection-refused).

## How It Works

### Backup

For each database of the job, DBackup runs:

```bash
pg_dump -h <host> -p <port> -U <user> -F c -Z <compression> -d <database> [extra options]
```

The password is passed in `PGPASSWORD`, never on the command line. Over SSH the same command runs on the SSH server and its output streams back over the connection. DBackup checks first that `pg_dump` exists on the machine that runs it.

`pg_dumpall` is never used, so roles, tablespaces and other objects of the whole server are not part of the backup.

### PostgreSQL Compression

PostgreSQL's own dump compression is set in the **Compression** part of the job and controls the `-Z` flag. Each option is a card, and the level is a slider between faster and smaller with the default marked.

| Option | Description | Levels |
| :--- | :--- | :--- |
| **Gzip** | The usual pick, works everywhere | 0 to 9, default 6 |
| **LZ4** | Fastest, a little larger | 0 to 9, default 1 |
| **Zstd** | Small and fast. Levels above 19 need a lot of memory | 1 to 22, default 3 |
| **None** | Runs `pg_dump -Z 0`, so the dump is uncompressed | |

With **Gzip**, **LZ4** or **Zstd**, DBackup stores the dump as it is and does not compress it a second time. With **None**, the part offers DBackup's own [compression](/user-guide/security/compression) instead, which compresses each dump as an entry of its own. Jobs from before this setting use Gzip at level 6 and show as that.

The job form offers **LZ4** for PostgreSQL 14 and later and **Zstd** for 16 and later, going by the version DBackup last detected for the source. For an older version the card is disabled and names the version it needs, and a job set to it falls back to Gzip at level 6. While no version is known, every option is offered. Over SSH, the `pg_dump` on the SSH server has to support the method as well.

### Output

Every run writes one `.tar` archive, with a `.tar.index` and a `.tar.meta.json` file next to it on each destination. Each database is its own entry, `databases/<name>.dump` in PostgreSQL custom format. It ends in `.gz` or `.br` only when the dump compression is **None** and DBackup compresses the backup. In an encrypted backup the entries are named `d/000001` and onward instead. A single database can be restored or renamed without the others. The layout is described in [Archive Format](/developer-guide/reference/archive-format).

Multi-database backups from before v0.9.1 were made with `pg_dumpall` and cannot be restored.

## Restore

A restore is started from **Backups**, see [Restore](/user-guide/features/restore). For PostgreSQL:

- A target database that does not exist yet is created with `CREATE DATABASE` first, and a database can be restored under another name.
- Each database is restored with `pg_restore --clean --if-exists --no-owner --no-acl`, plus `--no-comments --no-tablespaces --no-security-labels`. Objects in the dump are dropped and created again, objects that exist only in the target stay.
- Owners and grants are not restored. Restored objects belong to the login that ran the restore, and roles and their grants have to be set up on a new server by hand.
- When a start fails with access or permission denied, the page offers an admin login for that one run. For PostgreSQL it creates the databases and runs `pg_restore` as well.
- A backup of a newer PostgreSQL version than the target server is refused, see [Version Guard](/user-guide/features/restore#version-guard).

## Troubleshooting

### Connection Refused

```
connection to server at "db" (172.18.0.2), port 5432 failed: Connection refused
```

**Solution:**
1. Let PostgreSQL listen on an address DBackup reaches, `listen_addresses = '*'` in `postgresql.conf`
2. Check the firewall between DBackup and the server
3. When the error says `no pg_hba.conf entry` instead, allow the DBackup host in `pg_hba.conf`, for example `host all dbackup 172.17.0.0/16 scram-sha-256`

### Permission Denied

```
permission denied for table users
```

**Solution:** Grant read access to the schema's tables:
```sql
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbackup;
```

### Large Object Permission

```
permission denied for large object 16409
```

**Solution:** Large objects are readable by their owner and superusers. Back up as one of them, or grant each object with `GRANT SELECT ON LARGE OBJECT 16409 TO dbackup`.

### SSH: Binary Not Found

```
None of the following binaries were found on ssh://user@host:22: pg_dump
```

**Solution:** Install the PostgreSQL client package on the SSH server, see [SSH Mode](#ssh-mode).

### SSH: Connection Refused

**Solution:**
1. Verify SSH is running: `systemctl status sshd`
2. Check the SSH port and firewall rules
3. Test manually: `ssh user@host`

## Next Steps

- [Create a Backup Job](/user-guide/jobs/)
- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
