# Database Sources

DBackup supports a wide variety of database engines.

## Supported Databases

| Database | Supported Versions | Backup Method | Restore |
| :--- | :--- | :--- | :--- |
| [MySQL](/user-guide/sources/mysql) | 5.7, 8.0, 8.4, 9.0 | `mariadb-dump` or `mysqldump` | ✅ |
| [MariaDB](/user-guide/sources/mysql) | 10.x, 11.x | `mariadb-dump` or `mysqldump` | ✅ |
| [PostgreSQL](/user-guide/sources/postgresql) | 12 to 18 | `pg_dump` | ✅ |
| [MongoDB](/user-guide/sources/mongodb) | 4.x to 8.x | `mongodump` | ✅ |
| [Redis](/user-guide/sources/redis) | 2.8+ | `redis-cli --rdb` | Manual |
| [Valkey](/user-guide/sources/valkey) | 7.2+ | `redis-cli --rdb` | Manual |
| [SQLite](/user-guide/sources/sqlite) | 3.x | `sqlite3 .backup`, stores the database file | ✅ |
| [MSSQL](/user-guide/sources/mssql) | 2017, 2019, 2022, Azure SQL Edge | `BACKUP DATABASE` | ✅ |
| [Azure SQL Database](/user-guide/sources/azure-sql) (beta) | Single database, elastic pool | `SqlPackage` BACPAC export | ✅ (drops the target first) |
| [Firebird](/user-guide/sources/firebird) (beta) | 3.x, 4.x, 5.x | `gbak` | ✅ (pre-configured aliases) |

## Directory Sources

The Connections page has a **Directory sources** tab: storage adapters whose
folders can be backed up as files rather than as a database dump. They use the same
backends as [Storage Destinations](/user-guide/destinations/) but are configured as their
own adapters, because the two roles use the configured path differently - a destination
writes backup and chain folders into it, a source only reads folders out of it. An adapter
is one or the other, never both.

To use the same server for both, pick **Create as directory source** in the menu of the destination, or **Create as backup destination** here, and adjust the path on the copy.

One backend exists only on this side: [Docker Volumes](/user-guide/sources/docker-volumes)
reads the contents of Docker volumes, which is data a container holds and nothing else can
reach. It cannot be a destination, so it is offered as a directory source only.

## Database Explorer

Beyond configuring sources for backups, DBackup includes a **Database Explorer** that lets you browse live databases, tables, and data directly from the UI — no separate database client needed. See [Database Explorer](/user-guide/features/database-explorer).

## Adding a Source

1. Navigate to **Connections** → **Databases** → **New database**
2. Select the database type
3. Under **How DBackup connects**, pick **Direct** or **Over SSH** (see below). The parts that depend on it appear once you have.
4. Fill in the parts listed on the left: host, port and **Login**, and over SSH the **SSH server** as well. A check marks each part that has everything it needs.
5. Click **Test connection** to verify, then **Create database**. A database is tested once more before it is created, and you are asked before saving one that cannot connect.

Which databases to back up is picked in the job that uses the source.

DBackup checks every connection against the fields of its type before it saves it, also one sent through the API, and names each field that does not fit without repeating its value. Every port is a whole number from 1 to 65535, and no host or user holds a line break or another control character. A copy or a connection restored from Recently deleted is checked for these two as well.

## Editing a Connection

The password, key or token of a connection usually sits in a [credential profile](/user-guide/security/credential-profiles), its saved login, which is picked in the form and signs in wherever the connection points. A few secrets live in the connection itself, like the connection string of MongoDB, or a password sent through the API or kept from an older version. DBackup never shows them again. Their field reads **saved, leave blank to keep**, and left blank they are kept for **Test connection**, the list of databases and saving.

That holds only while the connection still reaches the same place. Once the host, the port, the SSH server or its port changes, or a URL the connection sends to points at another server, such a secret is not sent there:

- A secret the form shows, like the MongoDB connection string, has to be typed again. The form says **Enter it again for the new address**.
- A password or key the form does not show is dropped once a saved login signs in to the new address. Without one the form asks you to **Pick a saved login for the new address**.

Changing the name, the user, the databases or the options keeps every secret. Cloud drives like Google Drive, OneDrive and Dropbox, Amazon S3, Telegram and Twilio always talk to their provider, so their tokens are kept whatever else changes, and S3 storage keeps its keys when only the bucket changes.

## Connection Modes

DBackup supports two connection modes for most database types:

| Mode | Description | Use Case |
| :--- | :--- | :--- |
| **Direct** | DBackup connects directly to the database via TCP | Database is on the same network / Docker network or connected via VPN (recommended) |
| **Over SSH** | DBackup connects via SSH and runs database tools on the remote host | Database is on a remote server, not directly reachable, or no local CLI tools installed |

### SSH Mode

In SSH mode, DBackup connects to the remote server via SSH and executes database CLI tools (e.g., `mariadb-dump`, `pg_dump`) **directly on that server**. The output comes back over the same connection, streamed or as a temporary file DBackup fetches and deletes, depending on the tool. This is **not** an SSH tunnel - the database tools run remotely. The form marks **Over SSH** as beta.

**Supported adapters:** MySQL, MariaDB, PostgreSQL, MongoDB, Redis, Valkey, SQLite, Firebird, MSSQL

::: warning Required: Database CLI Tools on Remote Host
When using SSH mode, the required database client tools **must be installed on the remote SSH server**. DBackup does not transfer or install any tools - it only executes them. See the individual adapter pages for the specific tools required.

[MSSQL](/user-guide/sources/mssql) is the exception and needs no tools installed: SQL Server writes the backup itself through a T-SQL command, so SSH mode tunnels that connection instead of running anything remotely. It is the only adapter that works this way.
:::

### SSH Configuration Fields

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **SSH host** | SSH server hostname or IP | - | ✅ |
| **Port** | SSH server port | `22` | ❌ |
| **SSH login** | An `SSH_KEY` [credential profile](/user-guide/security/credential-profiles) with the username and a password, a private key or the SSH agent | - | ✅ |

::: tip SSH Agent
To use SSH agent forwarding in Docker, mount the agent socket:
```yaml
services:
  dbackup:
    volumes:
      - ${SSH_AUTH_SOCK}:/ssh-agent
    environment:
      - SSH_AUTH_SOCK=/ssh-agent
```
:::

## Connection from Docker

When DBackup runs in Docker and your database is on the host:

| Platform | Host Address |
| :--- | :--- |
| macOS / Windows (Docker Desktop) | `host.docker.internal` |
| Linux (Docker Engine) | `host.docker.internal` with `extra_hosts: ["host.docker.internal:host-gateway"]` on the DBackup service |

For Docker Compose networks, use the service name as hostname.
