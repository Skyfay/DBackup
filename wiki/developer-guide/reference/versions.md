# Supported Database Versions

This document lists the database engines and versions supported by DBackup.

## Compatibility Matrix

| Database | Supported Versions | Client Tool | Notes |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | 12, 13, 14, 15, 16, 17, 18 | `pg_dump` | Backward compatible |
| **MySQL** | 5.7, 8.0, 8.4, 9.0 | `mysqldump` | Via mariadb-client |
| **MariaDB** | 10.x, 11.x | `mysqldump` | Native support |
| **MongoDB** | 4.x, 5.x, 6.x, 7.x, 8.x | `mongodump` | Standard operations |
| **SQLite** | 3.x | `sqlite3` | File-based |
| **Microsoft SQL Server** | 2017, 2019, 2022 | `mssql` npm | T-SQL commands |

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
- MySQL 8.4 (Innovation)
- MySQL 9.0 (Latest)

### MariaDB Compatibility

DBackup uses `mariadb-client` which is compatible with MySQL servers. This works because:

- MariaDB maintains wire protocol compatibility
- `mysqldump` commands are identical
- Authentication plugins are supported

### Dump Options

```bash
mysqldump \
  -h hostname \
  -P 3306 \
  -u username \
  --password=*** \
  --single-transaction \
  --routines \
  --triggers \
  database_name
```

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
