# MySQL / MariaDB

Configure MySQL or MariaDB databases for backup.

## Supported Versions

| Engine | Versions |
| :--- | :--- |
| **MySQL** | 5.7, 8.0, 8.4, 9.0 |
| **MariaDB** | 10.x, 11.x |

## Configuration

### Basic Settings

| Field | Description | Default |
| :--- | :--- | :--- |
| **Host** | Database server hostname | `localhost` |
| **Port** | MySQL port | `3306` |
| **User** | Database username | Required |
| **Password** | Database password | Optional |
| **Database** | Database name(s) to backup | All databases |

### Advanced Options

| Field | Description |
| :--- | :--- |
| **Additional Options** | Extra `mysqldump` flags |
| **Disable SSL** | Disable SSL for self-signed certificates |

## Setting Up a Backup User

Create a dedicated user with minimal permissions:

```sql
-- Create backup user
CREATE USER 'dbackup'@'%' IDENTIFIED BY 'secure_password_here';

-- Grant required permissions
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT ON *.* TO 'dbackup'@'%';

-- For restore operations (optional)
GRANT CREATE, DROP, ALTER, INSERT, DELETE, UPDATE ON *.* TO 'dbackup'@'%';

-- Apply changes
FLUSH PRIVILEGES;
```

::: tip Minimal Permissions
For backup-only operations, `SELECT`, `SHOW VIEW`, `TRIGGER`, and `LOCK TABLES` are sufficient.
:::

## Backup Process

DBackup uses `mysqldump` (or `mariadb-dump` for MariaDB) with these default options:

- `--single-transaction`: Consistent backup without locking (InnoDB)
- `--routines`: Include stored procedures and functions
- `--triggers`: Include triggers
- `--events`: Include scheduled events

### Output Format

The backup creates a `.sql` file containing:
- `CREATE DATABASE` statements
- `CREATE TABLE` statements
- `INSERT` statements with data
- Stored procedures, functions, triggers, events

## Additional Options Examples

Pass extra flags via the "Additional Options" field:

```bash
# Skip specific tables
--ignore-table=mydb.logs --ignore-table=mydb.sessions

# Add extended insert for faster restore
--extended-insert

# Compress tables during dump (MySQL 8.0+)
--compress

# Set maximum packet size
--max-allowed-packet=1G
```

## SSL/TLS Connection

By default, DBackup attempts SSL connections. If your server uses self-signed certificates:

1. Enable **Disable SSL** option, or
2. Add SSL options to "Additional Options":
   ```bash
   --ssl-mode=REQUIRED --ssl-ca=/path/to/ca.pem
   ```

## Docker Network Configuration

### Database on Host Machine

```yaml
environment:
  - DB_HOST=host.docker.internal
```

### Database in Same Docker Network

```yaml
services:
  dbackup:
    # ...
    networks:
      - backend

  mysql:
    image: mysql:8
    networks:
      - backend

networks:
  backend:
```

Use `mysql` as the hostname in DBackup.

## Troubleshooting

### Access Denied

```
ERROR 1045 (28000): Access denied for user 'backup'@'172.17.0.1'
```

**Solution**: Grant access from Docker network IP range:
```sql
CREATE USER 'dbackup'@'172.17.%' IDENTIFIED BY 'password';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON *.* TO 'dbackup'@'172.17.%';
```

### Connection Timeout

**Solution**: Check firewall rules and ensure MySQL is listening on the correct interface:
```ini
# my.cnf
[mysqld]
bind-address = 0.0.0.0
```

### Large Database Timeout

For databases over 10GB, increase timeout:
```bash
# Additional Options
--net-buffer-length=32768
```

## Restore

To restore a MySQL backup:

1. Go to **Storage Explorer**
2. Find your backup file
3. Click **Restore**
4. Select target database (can be different from source)
5. Confirm and monitor progress

The restore uses `mysql` client with the SQL dump file.

## Multi-Database Backups

When backing up multiple databases, DBackup creates a **TAR archive** containing:

```
backup.tar
├── manifest.json    # Metadata about contained databases
├── database1.sql    # Individual dump per database
├── database2.sql
└── ...
```

### Selective Restore

From a multi-DB backup, you can:
- **Select specific databases** to restore
- **Rename databases** during restore (e.g., `production` → `staging`)
- **Skip databases** you don't need

::: warning Breaking Change (v0.9.1)
Multi-DB backups created before v0.9.1 use a different format and cannot be restored with newer versions.
:::

## Best Practices

1. **Test backups regularly** by performing test restores
2. **Use `--single-transaction`** for InnoDB tables (enabled by default)
3. **Schedule during low-traffic periods** to minimize impact
4. **Enable compression** to reduce storage and transfer time
5. **Use encryption** for sensitive data
