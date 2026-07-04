# Database Sources

DBackup supports a wide variety of database engines.

## Supported Databases

| Database | Supported Versions | Backup Method | Restore |
| :--- | :--- | :--- | :--- |
| [MySQL](/user-guide/sources/mysql) | 5.7, 8.x, 9.x | `mysqldump` | ✅ |
| [MariaDB](/user-guide/sources/mysql) | 10.x, 11.x | `mariadb-dump` | ✅ |
| [PostgreSQL](/user-guide/sources/postgresql) | 12 – 18 | `pg_dump` | ✅ |
| [MongoDB](/user-guide/sources/mongodb) | 4.x – 8.x | `mongodump` | ✅ |
| [Redis](/user-guide/sources/redis) | 2.8+ | `redis-cli --rdb` | Manual |
| [Valkey](/user-guide/sources/valkey) | 7.2+ | `redis-cli --rdb` | Manual |
| [SQLite](/user-guide/sources/sqlite) | 3.x | `.dump` command | ✅ |
| [MSSQL](/user-guide/sources/mssql) | 2017, 2019, 2022 | `BACKUP DATABASE` | ✅ |
| [Firebird](/user-guide/sources/firebird) | 3.x, 4.x, 5.x | `gbak` | ✅ (pre-configured aliases) |

## Database Explorer

Beyond configuring sources for backups, DBackup includes a **Database Explorer** that lets you browse live databases, tables, and data directly from the UI — no separate database client needed. See [Database Explorer](/user-guide/features/database-explorer).

## Adding a Source

1. Navigate to **Sources** → **Add Source**
2. Select the database type
3. Choose **Connection Mode**: Direct or SSH (see below)
4. Fill in connection details (host, port, credentials)
5. Click **Test Connection** to verify
6. Click **Fetch Databases** to list available databases
7. Select which databases to backup → **Save**

## Connection Modes

DBackup supports two connection modes for most database types:

| Mode | Description | Use Case |
| :--- | :--- | :--- |
| **Direct** | DBackup connects directly to the database via TCP | Database is on the same network / Docker network or connected via VPN (recommended) |
| **SSH** | DBackup connects via SSH and runs database tools on the remote host | Database is on a remote server, not directly reachable, or no local CLI tools installed |

### SSH Mode

In SSH mode, DBackup connects to the remote server via SSH and executes database CLI tools (e.g., `mysqldump`, `pg_dump`) **directly on that server**. The backup output is streamed back to DBackup over the SSH connection. This is **not** an SSH tunnel - the database tools run remotely.

**Supported adapters:** MySQL, MariaDB, PostgreSQL, MongoDB, Redis, Valkey, SQLite

::: warning Required: Database CLI Tools on Remote Host
When using SSH mode, the required database client tools **must be installed on the remote SSH server**. DBackup does not transfer or install any tools - it only executes them. See the individual adapter pages for the specific tools required.
:::

### SSH Configuration Fields

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **SSH Host** | SSH server hostname or IP | - | ✅ |
| **SSH Port** | SSH server port | `22` | ❌ |
| **SSH Username** | SSH login username | - | ✅ |
| **SSH Auth Type** | Authentication method: Password, Private Key, or Agent | `Password` | ✅ |
| **SSH Password** | SSH password (for password auth) | - | ❌ |
| **SSH Private Key** | PEM-formatted private key (for key auth) | - | ❌ |
| **SSH Passphrase** | Passphrase for encrypted private key | - | ❌ |

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
| Linux / macOS / Windows | `host.docker.internal` |

For Docker Compose networks, use the service name as hostname.
