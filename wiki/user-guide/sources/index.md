# Database Sources

DBackup supports a wide variety of database engines. This section provides an overview of all supported databases and their specific configuration requirements.

## Supported Databases

| Database | Supported Versions | Backup Method |
| :--- | :--- | :--- |
| [MySQL](/user-guide/sources/mysql) | 5.7, 8.x, 9.x | `mysqldump` |
| [MariaDB](/user-guide/sources/mysql) | 10.x, 11.x | `mariadb-dump` |
| [PostgreSQL](/user-guide/sources/postgresql) | 12 - 18 | `pg_dump` |
| [MongoDB](/user-guide/sources/mongodb) | 4.x - 8.x | `mongodump` |
| [SQLite](/user-guide/sources/sqlite) | 3.x | `.dump` command |
| [MSSQL](/user-guide/sources/mssql) | 2017, 2019, 2022 | `BACKUP DATABASE` |

## Adding a Source

1. Navigate to **Sources** in the sidebar
2. Click **Add Source**
3. Select the database type
4. Fill in the connection details
5. Click **Test Connection** to verify
6. Click **Fetch Databases** to list available databases
7. Select which databases to backup
8. Save the configuration

## Common Configuration Options

All database sources share these common settings:

### Connection Details

- **Name**: A friendly name for this source (e.g., "Production MySQL")
- **Host**: Database server hostname or IP address
- **Port**: Database server port
- **User**: Username for authentication
- **Password**: Password for authentication

### Database Selection

You can backup:
- **All databases**: Leave database field empty or select all
- **Specific databases**: Select individual databases from the list
- **Multiple databases**: Select multiple databases for a single backup file

### Additional Options

Most adapters support an "Additional Options" field where you can pass extra flags to the underlying backup tool (e.g., `--single-transaction` for MySQL).

## Security Best Practices

### Dedicated Backup User

Create a dedicated user for backups with minimal required permissions:

::: code-group
```sql [MySQL/MariaDB]
CREATE USER 'backup_user'@'%' IDENTIFIED BY 'strong_password';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON *.* TO 'backup_user'@'%';
FLUSH PRIVILEGES;
```

```sql [PostgreSQL]
CREATE USER backup_user WITH PASSWORD 'strong_password';
GRANT CONNECT ON DATABASE mydb TO backup_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_user;
```

```javascript [MongoDB]
db.createUser({
  user: "backup_user",
  pwd: "strong_password",
  roles: [{ role: "backup", db: "admin" }]
})
```
:::

### Network Security

- Use private networks when possible
- Enable SSL/TLS for database connections
- Use firewall rules to restrict access

### Credential Encryption

DBackup automatically encrypts all stored credentials using your `ENCRYPTION_KEY`. The passwords are never stored in plaintext.

## Test Connection

Always test your connection before saving:

1. Click **Test Connection**
2. The system verifies:
   - Network connectivity
   - Authentication credentials
   - Required permissions

::: warning Test Failures
If the test fails, check:
- Firewall rules
- Database user permissions
- Network connectivity from Docker container
:::

## Connection from Docker

When DBackup runs in Docker and your database is on the host machine:

| Platform | Host Address |
| :--- | :--- |
| Linux | `host.docker.internal` or host IP |
| macOS | `host.docker.internal` |
| Windows | `host.docker.internal` |

For Docker Compose networks, use the service name as hostname.

## Next Steps

Choose your database type for detailed configuration:

- [MySQL / MariaDB](/user-guide/sources/mysql)
- [PostgreSQL](/user-guide/sources/postgresql)
- [MongoDB](/user-guide/sources/mongodb)
- [SQLite](/user-guide/sources/sqlite)
- [Microsoft SQL Server](/user-guide/sources/mssql)
