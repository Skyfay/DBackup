# MySQL / MariaDB

Configure MySQL or MariaDB databases for backup using `mysqldump` / `mariadb-dump`.

## Supported Versions

| Engine | Versions |
| :--- | :--- |
| **MySQL** | 5.7, 8.0, 8.4, 9.0 |
| **MariaDB** | 10.x, 11.x |

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup connects via TCP and runs `mysqldump` locally |
| **SSH** | DBackup connects via SSH and runs `mysqldump` on the remote host |

## Configuration

::: info Credential Profiles required
MySQL / MariaDB requires a [Credential Profile](/user-guide/security/credential-profiles). Create an `USERNAME_PASSWORD` profile in **Settings → Vault → Credentials** before saving the source. SSH mode additionally requires an `SSH_KEY` profile.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Connection Mode** | Direct (TCP) or SSH | `Direct` | ✅ |
| **Host** | Database server hostname | `localhost` | ✅ |
| **Port** | MySQL port | `3306` | ✅ |
| **Primary Credential** | `USERNAME_PASSWORD` credential profile (username + password) | - | ✅ |
| **Database** | Database name(s) to backup | All databases | ❌ |
| **Additional Options** | Extra `mysqldump` flags | - | ❌ |
| **Disable SSL** | Disable SSL for self-signed certificates | `false` | ❌ |

### SSH Mode Fields

These fields appear when **Connection Mode** is set to **SSH**:

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **SSH Host** | SSH server hostname or IP | - | ✅ |
| **SSH Port** | SSH server port | `22` | ❌ |
| **SSH Credential** | `SSH_KEY` credential profile (username + key or password) | - | ✅ |

## Prerequisites

### Direct Mode

The DBackup server (or Docker container) needs `mysql` and `mysqldump` CLI tools installed.

**Docker**: Already included in the DBackup image.

### SSH Mode

The **remote SSH server** must have the following tools installed:

```bash
# Required for backup
mysqldump    # or mariadb-dump (MariaDB)

# Required for restore
mysql        # or mariadb (MariaDB)
```

DBackup auto-detects which binary is available (`mysqldump` vs `mariadb-dump`, `mysql` vs `mariadb`).

::: info SFTP required
DBackup uses SFTP to securely transfer the database password to the remote server. SFTP is part of OpenSSH and is **enabled by default** on all standard Linux distributions. No extra configuration is needed unless SFTP was explicitly disabled in `/etc/ssh/sshd_config`.

To verify SFTP is available on the remote server:
```bash
grep -i sftp /etc/ssh/sshd_config
# Should show: Subsystem sftp /usr/lib/openssh/sftp-server
```
:::

**The SSH user needs:**
- Permission to write to `/tmp` on the remote server (standard on all Linux systems - `/tmp` is world-writable by default)
- Execute permission for `mysql`/`mariadb` and `mysqldump`/`mariadb-dump` (standard - binaries in `/usr/bin/` are world-executable)
- No elevated privileges or `sudo` required

**Install on the remote host:**
```bash
# Debian/Ubuntu (MySQL client)
apt-get install default-mysql-client

# Debian/Ubuntu (MariaDB client - also provides mysqldump)
apt-get install mariadb-client

# RHEL/CentOS/Fedora
dnf install mysql

# Alpine
apk add mysql-client

# macOS
brew install mysql-client
```

::: tip Debian ships MariaDB by default
On Debian, the `mysql-client` package no longer exists. Use `default-mysql-client` (which installs `mariadb-client-compat`) or install `mariadb-client` directly. Both provide `mysqldump` and `mysql` commands that work with MySQL and MariaDB servers.
:::

::: danger Important
In SSH mode, DBackup does **not** use local CLI tools. The database tools must be installed on the remote server where SSH connects to. DBackup executes them remotely and streams the output back.
:::

## Setup Guide

### 1. Create a Backup User

```sql
CREATE USER 'dbackup'@'%' IDENTIFIED BY 'secure_password_here';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT ON *.* TO 'dbackup'@'%';
FLUSH PRIVILEGES;

-- For restore operations (optional):
GRANT CREATE, DROP, ALTER, INSERT, DELETE, UPDATE ON *.* TO 'dbackup'@'%';
```

::: tip Minimal Permissions
For backup-only operations, `SELECT`, `SHOW VIEW`, `TRIGGER`, and `LOCK TABLES` are sufficient.
:::

### 2. Configure in DBackup

#### Direct Mode

1. Go to **Connections** → **Databases** → **Add New**
2. Select **MySQL** or **MariaDB**
3. Keep Connection Mode as **Direct**
4. Enter connection details
5. Click **Test Connection**
6. Click **Fetch Databases** and select databases
7. Save

#### SSH Mode

1. Go to **Connections** → **Databases** → **Add New**
2. Select **MySQL** or **MariaDB**
3. Set Connection Mode to **SSH**
4. In the **SSH Connection** tab: enter SSH host, username, and authentication details
5. Click **Test SSH** to verify SSH connectivity
6. In the **Database** tab: enter MySQL host (usually `127.0.0.1` or `localhost` - relative to the SSH server), port, user, and password
7. Click **Test Connection** to verify database connectivity via SSH
8. Click **Fetch Databases** and select databases
9. Save

::: tip Host in SSH Mode
The **Host** field in SSH mode refers to the database hostname **as seen from the SSH server**, not from DBackup. If MySQL runs on the same machine as the SSH server, use `127.0.0.1` or `localhost`.
:::

### 3. Docker Network

<details>
<summary>Database on host machine</summary>

```yaml
environment:
  - DB_HOST=host.docker.internal
```

</details>

<details>
<summary>Database in same Docker network</summary>

```yaml
services:
  dbackup:
    networks: [backend]
  mysql:
    image: mysql:8
    networks: [backend]
networks:
  backend:
```

Use `mysql` as the hostname in DBackup.

</details>

## How It Works

### Direct Mode

DBackup uses `mysqldump` (or `mariadb-dump` for MariaDB) with these default flags:

- `--single-transaction` - Consistent backup without locking (InnoDB)
- `--routines` - Includes stored procedures and functions
- `--triggers` - Includes triggers
- `--events` - Includes scheduled events

Output: `.sql` file with `CREATE` and `INSERT` statements.

### SSH Mode

In SSH mode, DBackup:

1. Connects to the remote server via SSH
2. Checks that `mysqldump` (or `mariadb-dump`) is available on the remote host
3. Executes the dump command remotely with the same flags as direct mode
4. Streams the SQL output back over the SSH connection
5. Applies compression and encryption locally on the DBackup server
6. Uploads the processed backup to the configured storage destination

The database password is delivered securely via a temporary `.my.cnf` file:

1. DBackup writes the password to a temp file (`/tmp/dbackup_<uuid>.cnf`) on the **local** DBackup server (mode `0600`)
2. The file is uploaded to `/tmp/dbackup_<uuid>.cnf` on the **remote** SSH server via SFTP binary transfer - it never appears in process arguments or shell history
3. MySQL/MariaDB is invoked with `--defaults-file=<path>` pointing to that file
4. Both files are deleted in a `finally` block regardless of success or failure

This approach is compatible with all MariaDB versions including 11.4+, which removed `MYSQL_PWD` support.

### Multi-Database Backups

When backing up multiple databases, DBackup creates a **TAR archive**:

```
backup.tar
├── manifest.json
├── database1.sql
├── database2.sql
└── ...
```

From a multi-DB backup you can restore individual databases and rename them during restore.

::: warning Breaking Change (v0.9.1)
Multi-DB backups before v0.9.1 use a different format and cannot be restored with newer versions.
:::

### Additional Options Examples

<details>
<summary>Common mysqldump flags</summary>

```bash
# Skip specific tables
--ignore-table=mydb.logs --ignore-table=mydb.sessions

# Extended insert for faster restore
--extended-insert

# Set maximum packet size
--max-allowed-packet=1G
```

</details>

## Troubleshooting

### Access Denied

```
ERROR 1045 (28000): Access denied for user 'backup'@'172.17.0.1'
```

**Solution:** Grant access from Docker network:
```sql
CREATE USER 'dbackup'@'172.17.%' IDENTIFIED BY 'password';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON *.* TO 'dbackup'@'172.17.%';
```

### Connection Timeout

**Solution:** Ensure MySQL listens on all interfaces:
```ini
# my.cnf
[mysqld]
bind-address = 0.0.0.0
```

### SSL Certificate Error

**Solution:** Enable **Disable SSL** in the source config, or pass custom SSL flags:
```bash
--ssl-mode=REQUIRED --ssl-ca=/path/to/ca.pem
```

### SSH: HestiaCP / unix_socket Authentication

```
ERROR 1698 (28000): Access denied for user 'dbackup'@'localhost'
```

HestiaCP installs MariaDB with the `unix_socket` auth plugin. The database user must be created with `IDENTIFIED BY` explicitly:

```sql
CREATE USER 'dbackup'@'localhost' IDENTIFIED BY 'your_password';
GRANT SELECT, LOCK TABLES, SHOW VIEW, TRIGGER, EVENT, RELOAD, PROCESS ON *.* TO 'dbackup'@'localhost';
FLUSH PRIVILEGES;
```

Note: Use `'dbackup'@'localhost'` (not `'dbackup'@'%'`) since DBackup connects via the local SSH session.

### SSH: SFTP Subsystem Disabled

```
SFTP session failed: ...
```

If SFTP was explicitly disabled on the remote server, re-enable it in `/etc/ssh/sshd_config`:

```ini
Subsystem sftp /usr/lib/openssh/sftp-server
```

Then restart SSH: `systemctl restart sshd`

### SSH: Binary Not Found

```
Required binary not found on remote server. Tried: mysqldump, mariadb-dump
```

**Solution:** Install the MySQL/MariaDB client package on the remote server:
```bash
# Ubuntu/Debian
apt-get install mysql-client
# or
apt-get install mariadb-client
```

### SSH: Connection Refused

```
SSH connection failed: connect ECONNREFUSED
```

**Solution:**
1. Verify SSH is running on the remote server: `systemctl status sshd`
2. Check the SSH port (default: 22)
3. Check firewall rules allow SSH from the DBackup server
4. Test manually: `ssh user@host`

### SSH: Permission Denied

```
SSH connection failed: All configured authentication methods failed
```

**Solution:**
1. Verify SSH credentials (username, password, or key)
2. For private key auth, ensure the key is in PEM or OpenSSH format
3. Check the remote server allows the chosen auth method in `sshd_config`

## Next Steps

- [Create a Backup Job](/user-guide/jobs/)
- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
