# MySQL / MariaDB

Back up MySQL or MariaDB databases with `mariadb-dump` or `mysqldump`, one database at a time.

## Supported Versions

| Engine | Versions |
| :--- | :--- |
| **MySQL** | 5.7, 8.0, 8.4, 9.0 |
| **MariaDB** | 10.x, 11.x |

::: tip Older MySQL servers
MySQL below 5.7 is not supported, but dumps are not blocked either. When the detected server version is below 5.5.3, DBackup leaves out the `utf8mb4` character set flag that those servers do not know. If the dump still fails on the character set, for example because the version could not be detected or the client in the DBackup image defaults to `utf8mb4`, add `--default-character-set=utf8` to **Extra options** to override it yourself.
:::

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup connects to the database port and runs the dump tool of its image |
| **Over SSH** (beta) | DBackup logs into a server over SSH and runs the dump tool installed there |

## Prerequisites

DBackup needs three client tools, on its own server in direct mode and on the SSH server over SSH. For each it takes the MariaDB name and falls back to the MySQL one:

| Tool | Used for |
| :--- | :--- |
| `mariadb-dump` or `mysqldump` | Backups |
| `mariadb` or `mysql` | Restores, listing the databases (also for **All databases** in a job) and the check of events and routines before each dump |
| `mariadb-admin` or `mysqladmin` | Test connection, health checks and detecting the server version |

**Docker**: The image ships Debian's `mariadb-client`, so it runs the MariaDB tools against MySQL servers as well.

### SSH Mode

Install a client package on the SSH server:

```bash
apt-get install mariadb-client         # Debian/Ubuntu
apt-get install default-mysql-client   # Debian/Ubuntu, the MariaDB client on Debian
dnf install mysql                      # RHEL/CentOS/Fedora
apk add mysql-client                   # Alpine
```

On Debian, the `mysql-client` package no longer exists. The MariaDB tools work with MySQL servers as well. The SSH user needs no `sudo`, only the right to run the tools and to write to `/tmp`.

::: info SFTP required
DBackup writes the password file, and on a restore the dump, to the SSH server over SFTP. SFTP is on by default in OpenSSH. If it was turned off, add `Subsystem sftp /usr/lib/openssh/sftp-server` back to `/etc/ssh/sshd_config` and restart SSH.
:::

## Configuration

::: info Credential Profiles required
MySQL / MariaDB requires a [Credential Profile](/user-guide/security/credential-profiles). Create a `USERNAME_PASSWORD` profile in **Vault → Credentials** before saving the source. SSH mode additionally requires an `SSH_KEY` profile.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **How DBackup connects** | **Direct** or **Over SSH** | - | ✅ |
| **Host** | Database server hostname, over SSH as seen from the SSH server | `localhost` | ✅ |
| **Port** | MySQL port | `3306` | ✅ |
| **Login** | `USERNAME_PASSWORD` credential profile | - | ✅ |
| **SSH host** | SSH server hostname or IP, over SSH only | - | ✅ |
| **Port** | SSH server port, over SSH only | `22` | ❌ |
| **SSH login** | `SSH_KEY` credential profile, over SSH only | - | ✅ |
| **Extra options** | Extra flags for the dump tool only. They come after the three switches below and win over them | - | ❌ |
| **Consistent snapshot** | Reads each database at one point in time (`--single-transaction`) instead of locking its tables while it is dumped | On | ❌ |
| **Stored procedures and functions** | Backs up the routines of each database (`--routines`) | On | ❌ |
| **Events** | Backs up the scheduled events of each database (`--events`) | On | ❌ |
| **Disable SSL** | Connects without SSL, for a server with a self-signed certificate. Applies to every connection, restores included | Off | ❌ |

The source has no database field. Which databases to back up is picked in the **Source** part of the job. **All databases** runs `SHOW DATABASES` on every run and leaves out `information_schema`, `mysql`, `performance_schema` and `sys`, so a database added later is backed up too.

```bash
# Extra options examples
--ignore-table=mydb.logs --ignore-table=mydb.sessions   # leave out tables
--max-allowed-packet=1G                                 # bigger maximum packet size
```

## Setup Guide

### 1. Create a Backup User

```sql
CREATE USER 'dbackup'@'%' IDENTIFIED BY 'secure_password_here';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT ON *.* TO 'dbackup'@'%';
FLUSH PRIVILEGES;

-- For restore operations (optional):
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES, INSERT, LOCK TABLES, CREATE VIEW, CREATE ROUTINE, ALTER ROUTINE ON *.* TO 'dbackup'@'%';
```

::: tip Minimal Permissions
For backups, `SELECT`, `SHOW VIEW`, `TRIGGER` and `EVENT` are enough. `LOCK TABLES` is only needed with **Consistent snapshot** turned off.

`SELECT` on `*.*` also lets the login read the stored procedures and functions of other users. A login with `SELECT` on single databases needs `SHOW_ROUTINE` on MySQL 8.0.20 and later, or `SELECT` on `mysql.proc` on older MySQL and on MariaDB, otherwise their routines are missing from the backup without an error.
:::

#### What a restore needs

A restore runs as the login of the source and creates tables, views, triggers, routines and events. The grants above cover that together with the ones for backups. Two cases need more:

- **Objects of another user**: a trigger, view, routine or event that names another user as its definer needs `SUPER`, `SET_ANY_DEFINER` (MySQL 8.2 and later), `SET_USER_ID` (MySQL 8.0) or `SET USER` (MariaDB).
- **Binary logging**: with it on, the default on MySQL 8.0 and later, MySQL lets only a login with `SUPER` create triggers and stored functions. Restore with such a login, or set `log_bin_trust_function_creators = 1` on the server.

The restore stops at the first statement that fails, and what ran before it stays in the target. Restored events start running on the target if the event scheduler is on there, so restoring production into a staging server runs its events there too.

A backup only restores into a source of the same type, MySQL into MySQL and MariaDB into MariaDB. A backup of a newer server version than the target is refused, see [Version Guard](/user-guide/features/restore#version-guard).

### 2. Configure in DBackup

1. Go to **Connections** → **Databases** → **New database** and select **MySQL** or **MariaDB**
2. Under **How DBackup connects**, pick **Direct** or **Over SSH**
3. Direct: enter **Host** and **Port** and pick or create the **Login**
4. Over SSH: fill in the **SSH server** part and click **Test SSH**, then enter host, port and **Login** in the **Database** part
5. Click **Test connection**, then **Create database**, and pick the databases in the job that uses the source

::: tip Host in SSH Mode
The **Host** is the database as seen from the SSH server. If MySQL runs on that machine, use `localhost` or `127.0.0.1`. Over SSH the client is not forced onto TCP, so `localhost` uses the server's socket and matches a `'dbackup'@'localhost'` account.
:::

### 3. Docker Network

A database container in the same Docker network as DBackup is reached by its service name, like `mysql`. For a database on the host machine, enter `host.docker.internal` as **Host**. Docker Desktop knows that name. Docker Engine on Linux needs it added to the DBackup service:

```yaml
services:
  dbackup:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

## How It Works

### Backup

DBackup dumps each database of the job on its own, with these flags for the switches under **Options**:

- `--single-transaction` for **Consistent snapshot**, reads InnoDB tables at one point in time without blocking writes
- `--routines` for **Stored procedures and functions**
- `--events` for **Events**

Triggers and views are always included, the dump tools add them on their own. **Extra options** come after these flags, so `--skip-routines` there turns the routines off as well. DBackup adds no flag the extra options already set, and leaves out the snapshot when they contain `--lock-tables` or `--lock-all-tables`, which cannot be combined with it. When the tool is MySQL's own `mysqldump` 5.6.9 or later, DBackup also adds `--set-gtid-purged=OFF`, so a server with GTIDs needs no `RELOAD` and the dump carries no GTID set that a restore onto another server refuses.

::: warning MyISAM and Aria tables
The snapshot only covers transactional tables. MyISAM and Aria tables are read without a lock, so writes to them during the dump can leave them inconsistent. Turn off **Consistent snapshot** for a source whose MyISAM tables change while it is backed up, which locks the tables of each database during its dump instead.
:::

Before it dumps a database, DBackup checks whether the login may read its events and the code of its routines. The dump tools give up on either instead of skipping it, even for a database without any events. So DBackup leaves the part out for that database and writes a warning to the run with the right to grant, and the backup of everything else goes ahead.

Over SSH, DBackup first checks that `mariadb-dump` or `mysqldump` exists on the SSH server, runs it there with the same flags and streams the output back over the connection.

### Password Handling

The password never appears on a command line. DBackup writes it to a `[client]` file with mode `0600` and passes it to each tool with `--defaults-file`. In direct mode the file is a local temp file. Over SSH it is written straight to `/tmp/dbackup_<uuid>.cnf` on the SSH server over SFTP, with no copy on the DBackup server. The file is deleted right after use, also when the command fails.

### Output

Every run writes one `.tar` archive, with a `.tar.index` and a `.tar.meta.json` file next to it on each destination. Each database is its own entry, `databases/<name>.sql`, ending in `.gz` or `.br` when the job compresses the backup. In an encrypted backup the entries are named `d/000001` and onward instead. A single database can be restored or renamed without the others. The layout is described in [Archive Format](/developer-guide/reference/archive-format).

## Troubleshooting

### Access Denied

```
ERROR 1045 (28000): Access denied for user 'backup'@'172.17.0.1'
```

**Solution:** Grant access from the Docker network:
```sql
CREATE USER 'dbackup'@'172.17.%' IDENTIFIED BY 'password';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT ON *.* TO 'dbackup'@'172.17.%';
```

### Connection Timeout

**Solution:** Ensure MySQL listens on an address DBackup reaches:
```ini
# my.cnf
[mysqld]
bind-address = 0.0.0.0
```

### SSL Certificate Error

**Solution:** Turn on **Disable SSL** under **Options**. It applies to the connection test, the database list, the dump and the restore. SSL flags in **Extra options** reach only the dump tool, so they do not help here.

### SSH: HestiaCP / unix_socket Authentication

```
ERROR 1698 (28000): Access denied for user 'dbackup'@'localhost'
```

HestiaCP installs MariaDB with the `unix_socket` auth plugin. Create the database user with a password explicitly:

```sql
CREATE USER 'dbackup'@'localhost' IDENTIFIED BY 'your_password';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT ON *.* TO 'dbackup'@'localhost';
FLUSH PRIVILEGES;
```

Use `'dbackup'@'localhost'` rather than `'dbackup'@'%'`, since the tools run on the server itself.

### SSH: Binary Not Found

```
None of the following binaries were found on ssh://user@host:22: mariadb-dump, mysqldump
```

**Solution:** Install a client package on the SSH server, see [SSH Mode](#ssh-mode).

## Next Steps

- [Create a Backup Job](/user-guide/jobs/)
- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
