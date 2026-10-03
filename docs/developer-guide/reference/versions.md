# Supported Database Versions

This document lists the database engines and versions supported by DBackup.

## Compatibility Matrix

| Database | Supported Versions | Client Tool | Notes |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | 12, 13, 14, 15, 16, 17, 18 | `pg_dump` | Backward compatible |
| **MySQL** | 5.7, 8.0, 9.1 | `mysqldump` | Via mariadb-client |
| **MariaDB** | 10.x, 11.x | `mysqldump` | Native support |
| **MongoDB** | 4.x, 5.x, 6.x, 7.x, 8.x | `mongodump` | Standard operations |
| **SQLite** | 3.x | `sqlite3` | File-based |
| **Microsoft SQL Server** | 2017, 2019, 2022 | `mssql` npm | T-SQL commands |
| **Azure SQL Database** | Single database, elastic pool | `sqlpackage` | Beta, BACPAC export |
| **Firebird** | 3.x, 4.x, 5.x | `gbak` | Beta, alias-based database list |

## Docker Container Tools

DBackup's Docker image (Alpine Linux) includes:

| Tool | Version | Supported Databases |
| :--- | :--- | :--- |
| `mysql-client` | MariaDB 11.4+ | MySQL 5.7+, MariaDB 10+ |
| `postgresql18-client` | 18.1+ | PostgreSQL 12-18 |
| `mongodb-tools` | 100.13+ | MongoDB 4-8 |
| `sqlite` | 3.x | SQLite 3.x |

## PostgreSQL

### Supported Versions

- PostgreSQL 12 (EOL: 2024-11)
- PostgreSQL 13 (EOL: 2025-11)
- PostgreSQL 14 (EOL: 2026-11)
- PostgreSQL 15 (EOL: 2027-11)
- PostgreSQL 16 (EOL: 2028-11)
- PostgreSQL 17 (Current)
- PostgreSQL 18 (Beta)

### Client Compatibility

`pg_dump` from PostgreSQL 18 is backward compatible with older servers. This allows backing up PostgreSQL 12 servers with the latest client tools.

### Dump Options

```bash
pg_dump \
  -h hostname \
  -p 5432 \
  -U username \
  -F c \           # Custom format (compressed)
  -f output.dump \
  database_name
```

## MySQL

### Supported Versions

- MySQL 5.7 (Legacy)
- MySQL 8.0 (LTS)
- MySQL 9.1 (Latest)

### MariaDB Compatibility

DBackup uses `mariadb-client` which is compatible with MySQL servers. This works because:

- MariaDB maintains wire protocol compatibility
- `mysqldump` commands are identical
- Authentication plugins are supported

### Dump Options

```bash
mariadb-dump \
  --defaults-file=/tmp/dbackup_<uuid>.cnf \
  -h hostname \
  -P 3306 \
  -u username \
  --protocol=tcp \
  --net-buffer-length=16384 \
  --single-transaction \
  --routines \
  --events \
  [extra options] \
  --databases database_name \
  --default-character-set=utf8mb4
```

The three content flags follow the switches of the source, and the tools include triggers on their own. `--default-character-set=utf8mb4` is added for MySQL 8 and later, and `--set-gtid-purged=OFF` when the tool is MySQL's own mysqldump, as over SSH on a MySQL host.

## MariaDB

### Supported Versions

- MariaDB 10.4 (Old LTS)
- MariaDB 10.5
- MariaDB 10.6 (LTS)
- MariaDB 10.11 (LTS)
- MariaDB 11.0+

### Native Support

MariaDB is natively supported through the same `mariadb-client` tools.

## MongoDB

### Supported Versions

- MongoDB 4.4 (EOL: 2024-02)
- MongoDB 5.0 (EOL: 2024-10)
- MongoDB 6.0 (EOL: 2025-07)
- MongoDB 7.0 (Current)
- MongoDB 8.0 (Latest)

### Tools

```bash
mongodump \
  --host hostname \
  --port 27017 \
  --username user \
  --password *** \
  --authenticationDatabase admin \
  --archive=backup.archive
```

### Features

- Supports replica sets
- Supports sharded clusters
- Archive format for single-file backups
- Compression support

## SQLite

### Supported Versions

- SQLite 3.x (All versions)

### Backup Methods

1. **SQL Dump** (portable):
   ```bash
   sqlite3 database.db .dump > backup.sql
   ```

2. **Binary Copy** (faster):
   ```bash
   cp database.db backup.db
   ```

### Remote Backups

For SSH-based remote SQLite backups:
- Target server must have `sqlite3` installed
- SSH key authentication recommended

## Microsoft SQL Server

### Supported Versions

- SQL Server 2017 (v14.x)
- SQL Server 2019 (v15.x)
- SQL Server 2022 (v16.x)
- Azure SQL Edge

### Implementation

Uses `mssql` npm package for T-SQL commands:

```sql
BACKUP DATABASE [dbname]
TO DISK = '/path/to/backup.bak'
WITH COMPRESSION, INIT;
```

### Requirements

- Shared volume between SQL Server and DBackup
- `sa` credentials or appropriate backup permissions
- Network access to SQL Server port (1433)

## Azure SQL Database

### Supported Versions

Azure SQL Database is versionless. It reports `12.0.2000` regardless of the engine actually running, so the adapter ignores the version entirely rather than deriving behaviour from it.

Identified by `SERVERPROPERTY('EngineEdition')`, which is the only reliable signal:

| EngineEdition | Product | Handled by |
| :--- | :--- | :--- |
| 5 | Azure SQL Database | This adapter |
| 8 | Azure SQL Managed Instance | Unsupported, rejected with a message |
| 6, 11 | Azure Synapse Analytics | Unsupported, rejected with a message |
| 9 | Azure SQL Edge | The MSSQL adapter |
| 1-4 | SQL Server | The MSSQL adapter |

::: info Beta
The Azure SQL Database adapter is marked as Beta in the source type picker.
:::

### Implementation

Uses `sqlpackage` for a BACPAC export and import. Azure SQL Database has no `BACKUP DATABASE` statement, no server-scoped catalog views such as `sys.master_files`, and rejects three-part names, so every per-database catalog read opens its own connection.

The export mechanism sits behind a `BacpacExporter` interface in `exporter/types.ts`. The Azure Import/Export REST API would fit the same seam and needs no binary, which mattered while it was unclear whether SqlPackage runs on arm64. It does, so only the SqlPackage implementation exists.

```bash
sqlpackage /Action:Export /TargetFile:db.bacpac /SourceConnectionString:"..."
sqlpackage /Action:Import /SourceFile:db.bacpac /TargetConnectionString:"..."
```

There is no SSH mode. The service is a public endpoint, and SqlPackage runs in the DBackup container rather than on any host in between, so a tunnel would solve nothing.

## Firebird

### Supported Versions

- Firebird 3.x
- Firebird 4.x
- Firebird 5.x

::: info Beta
The Firebird adapter is marked as Beta in the source type picker.
:::

### Implementation

Uses `gbak`/`isql` for backup, restore, and version detection. Unlike other adapters, Firebird has no server-side database registry - each source is configured with a fixed list of `{ name, path }` aliases instead of a discoverable database list.

```bash
gbak -b -user sysdba -password *** database.fdb backup.fbk
```

## Dialect System

DBackup uses a "Dialect" pattern to handle version-specific behavior.

### MySQL Dialects

| Dialect | Target | Notes |
| :--- | :--- | :--- |
| `mysql:5.7` | MySQL 5.7 | Legacy password handling |
| `mysql:8` | MySQL 8.0+ | Modern authentication |
| `mariadb:10` | MariaDB 10.x | MariaDB specifics |

### PostgreSQL Dialects

| Dialect | Target | Notes |
| :--- | :--- | :--- |
| `postgres:default` | All versions | Standard `pg_dump` |

### MSSQL Dialects

| Dialect | Target | Notes |
| :--- | :--- | :--- |
| `mssql:base` | 2019+ | Native compression |
| `mssql:2017` | 2017 | Compatibility mode |

## Version Detection

The system can detect database versions:

```typescript
// PostgreSQL
const { stdout } = await exec("psql -V");
// Output: psql (PostgreSQL) 16.1

// MySQL
const { stdout } = await exec("mysql --version");
// Output: mysql Ver 8.0.35 for Linux on x86_64

// MongoDB
const { stdout } = await exec("mongod --version");
// Output: db version v7.0.2
```

## Restore Compatibility

### Version Mismatch Protection

DBackup prevents restoring backups to incompatible database versions:

```typescript
if (backupVersion > targetVersion) {
  throw new Error(
    `Cannot restore MySQL ${backupVersion} backup to MySQL ${targetVersion} server`
  );
}
```

### Tested Restore Paths

| From | To | Status |
| :--- | :--- | :--- |
| MySQL 8.0 | MySQL 8.0 | ✅ Works |
| MySQL 8.0 | MySQL 5.7 | ⚠️ May fail |
| PostgreSQL 15 | PostgreSQL 16 | ✅ Works |
| PostgreSQL 16 | PostgreSQL 14 | ⚠️ May fail |

## Adding Support for New Versions

When a new database version is released:

1. **Test client compatibility**:
   ```bash
   mysqldump --version
   pg_dump --version
   ```

2. **Update Docker image** (if needed):
   ```dockerfile
   RUN apk add --no-cache postgresql18-client
   ```

3. **Add integration tests**:
   ```yaml
   # docker-compose.test.yml
   mysql-9:
     image: mysql:9.0
     ports:
       - "3307:3306"
   ```

4. **Update documentation**

## Related Documentation

- [Database Adapters](/developer-guide/adapters/database)
- [MySQL Configuration](/user-guide/sources/mysql)
- [PostgreSQL Configuration](/user-guide/sources/postgresql)
