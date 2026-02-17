# Microsoft SQL Server

Configure Microsoft SQL Server databases for backup.

## Supported Versions

| Version | Notes |
| :--- | :--- |
| SQL Server 2017 | v14.x |
| SQL Server 2019 | v15.x |
| SQL Server 2022 | v16.x |
| Azure SQL Edge | Container-based |

## Architecture

Unlike other database adapters that use CLI dump tools, SQL Server backup uses:

1. **T-SQL `BACKUP DATABASE`** command
2. Native `.bak` format (full database backup)
3. File transfer to access `.bak` files (shared volume or SSH)

This means the backup file is created **on the SQL Server** first, then transferred to DBackup.

## Configuration

### Connection Settings

| Field | Description | Default |
| :--- | :--- | :--- |
| **Host** | SQL Server hostname | `localhost` |
| **Port** | SQL Server port | `1433` |
| **User** | SQL Server login | Required |
| **Password** | Login password | Required |
| **Database** | Database name(s) to backup | Required |

### Configuration Settings

| Field | Description | Default |
| :--- | :--- | :--- |
| **Encrypt** | Use encrypted connection | `true` |
| **Trust Server Certificate** | Trust self-signed certs | `false` |
| **Request Timeout** | Query timeout in ms | `300000` (5 min) |
| **Additional Options** | Extra BACKUP options | - |

### File Transfer Settings

| Field | Description | Default |
| :--- | :--- | :--- |
| **Backup Path (Server)** | Server-side backup directory | `/var/opt/mssql/backup` |
| **File Transfer Mode** | How to access .bak files | `local` |
| **Local Backup Path** | Host-side mounted path (local mode) | `/tmp` |
| **SSH Host** | SSH host (SSH mode, defaults to DB host) | - |
| **SSH Port** | SSH port (SSH mode) | `22` |
| **SSH Username** | SSH username (SSH mode) | - |
| **SSH Auth Method** | password / privateKey / agent | `password` |
| **SSH Password** | SSH password | - |
| **SSH Private Key** | PEM private key | - |
| **SSH Passphrase** | Key passphrase | - |

## File Transfer Modes

DBackup supports two modes to access the `.bak` files that SQL Server creates on its filesystem.

### Local Mode (Shared Volume)

Use this when DBackup and SQL Server share a filesystem — typically via Docker volume mounts or NFS shares.

```yaml
services:
  dbackup:
    volumes:
      - ./mssql-backups:/mssql-backups
    # Configure in source:
    # - Backup Path (Server): /var/opt/mssql/backup
    # - File Transfer Mode: local
    # - Local Backup Path: /mssql-backups

  mssql:
    image: mcr.microsoft.com/mssql/server:2022-latest
    volumes:
      - ./mssql-backups:/var/opt/mssql/backup
```

#### How It Works

1. DBackup sends `BACKUP DATABASE` command to SQL Server
2. SQL Server writes `.bak` file to `/var/opt/mssql/backup`
3. DBackup reads the file from `/mssql-backups` (same volume)
4. DBackup processes (compress/encrypt) and uploads to destination
5. Cleanup: Original `.bak` file is deleted

### SSH Mode (Remote Server)

Use this when SQL Server runs on a remote host (bare-metal, VM, or remote Docker) and there is no shared filesystem. DBackup connects via SSH/SFTP to download/upload `.bak` files.

#### Setup

1. Set **File Transfer Mode** to `SSH`
2. Configure SSH credentials (host, username, password or key)
3. Set **Backup Path (Server)** to the directory on the SQL Server host (e.g., `/var/opt/mssql/backup`)
4. Ensure the SSH user has read/write access to the backup path

::: tip SSH Host Default
If **SSH Host** is left empty, DBackup uses the same hostname as the database connection. This is the most common setup since SSH and SQL Server usually run on the same machine.
:::

#### How It Works (Backup)

1. DBackup sends `BACKUP DATABASE` command to SQL Server
2. SQL Server writes `.bak` file to the backup path on its filesystem
3. DBackup connects via SSH/SFTP and downloads the `.bak` file
4. DBackup processes (compress/encrypt) and uploads to destination
5. Cleanup: Remote `.bak` file is deleted via SSH

#### How It Works (Restore)

1. DBackup downloads the backup from storage
2. DBackup connects via SSH/SFTP and uploads the `.bak` file to the backup path
3. DBackup sends `RESTORE DATABASE` command to SQL Server
4. SQL Server reads the `.bak` file from the backup path
5. Cleanup: Remote `.bak` file is deleted via SSH

#### SSH Authentication

| Method | Description |
| :--- | :--- |
| **Password** | Simple username/password authentication |
| **Private Key** | PEM-format private key (optionally with passphrase) |
| **Agent** | Uses the system SSH agent (`SSH_AUTH_SOCK`) |

## Setting Up a Backup User

Create a dedicated login with backup permissions:

```sql
-- Create login
CREATE LOGIN dbackup WITH PASSWORD = 'secure_password_here';

-- Create user in master
USE master;
CREATE USER dbackup FOR LOGIN dbackup;

-- Grant backup permissions
ALTER SERVER ROLE [db_backupoperator] ADD MEMBER dbackup;

-- Or grant on specific databases:
USE mydb;
CREATE USER dbackup FOR LOGIN dbackup;
ALTER ROLE [db_backupoperator] ADD MEMBER dbackup;
```

For restore operations:
```sql
ALTER SERVER ROLE [dbcreator] ADD MEMBER dbackup;
```

## Backup Process

DBackup executes:

```sql
BACKUP DATABASE [MyDatabase]
TO DISK = '/var/opt/mssql/backup/backup_20240115_120000.bak'
WITH FORMAT, INIT, COMPRESSION
```

### Backup Options

Add custom options in "Additional Options":

```sql
-- With checksum verification
CHECKSUM

-- With differential backup
DIFFERENTIAL

-- Copy-only (doesn't break log chain)
COPY_ONLY

-- Custom description
DESCRIPTION = 'Daily backup'
```

## Connection Security

### Encrypted Connection (Recommended)

Enable **Encrypt** option for production:
- Requires valid SSL certificate on SQL Server
- Or enable **Trust Server Certificate** for self-signed

### Azure SQL

For Azure SQL Database:
1. Enable **Encrypt**
2. Keep **Trust Server Certificate** disabled
3. Use Azure AD authentication if needed

## Troubleshooting

### Connection Timeout

```
Login failed. The login is from an untrusted domain
```

**Solutions**:
1. Increase **Request Timeout** for large databases
2. Check network latency
3. Verify SQL Server is accessible

### Backup Permission Denied

```
Cannot open backup device. Operating system error 5 (Access denied)
```

**Solutions**:
1. SQL Server service account needs write access to backup path
2. Check volume mount permissions (local mode) or SSH user file permissions (SSH mode)
3. Verify the backup directory exists on the SQL Server

### File Not Found After Backup (Local Mode)

```
Backup completed but file not found
```

**Solutions**:
1. Verify shared volume is mounted correctly
2. Check **Backup Path (Server)** matches SQL Server mount
3. Check **Local Backup Path** matches DBackup mount
4. Verify paths are absolute

### SSH Connection Failed (SSH Mode)

```
SSH connection failed: Authentication failed
```

**Solutions**:
1. Verify SSH credentials (username, password, or key)
2. Check that the SSH host and port are correct
3. Ensure the SSH service is running on the SQL Server host
4. For private key auth, verify the key is in PEM format
5. Check firewall rules allow SSH connections (port 22)

### SSH File Transfer Failed (SSH Mode)

```
SFTP download failed
```

**Solutions**:
1. Verify the SSH user has read/write access to the **Backup Path (Server)**
2. Check that the backup directory exists on the server
3. Ensure sufficient disk space on the server for `.bak` files

### SSL Certificate Error

```
The certificate chain was issued by an authority that is not trusted
```

**Solutions**:
1. Enable **Trust Server Certificate** (development only)
2. Install valid SSL certificate on SQL Server
3. Add CA certificate to DBackup container

## Azure SQL Edge (Docker)

For containerized development:

```yaml
services:
  mssql:
    image: mcr.microsoft.com/azure-sql-edge:latest
    environment:
      - ACCEPT_EULA=Y
      - SA_PASSWORD=YourStrong@Password123
    ports:
      - "1433:1433"
    volumes:
      - ./mssql-backups:/var/opt/mssql/backup
```

Configure source:
- **Host**: `mssql` (service name) or `host.docker.internal`
- **User**: `sa`
- **Encrypt**: `false`
- **Trust Server Certificate**: `true`

## Restore

To restore a SQL Server backup:

1. Go to **Storage Explorer**
2. Find your `.bak` backup file
3. Click **Restore**
4. Select target database configuration
5. Choose:
   - Restore to same database (overwrite)
   - Restore to new database name
6. Confirm and monitor progress

### Restore Process

The restore process depends on the configured **File Transfer Mode**:

**Local mode:**
1. Copy `.bak` file to shared volume (Local Backup Path)
2. Execute `RESTORE DATABASE` command
3. Verify restore integrity
4. Cleanup temporary files

**SSH mode:**
1. Upload `.bak` file to server via SFTP (Backup Path)
2. Execute `RESTORE DATABASE` command
3. Verify restore integrity
4. Cleanup: Delete remote `.bak` file via SSH

## Best Practices

1. **Use SSH mode** for remote SQL Servers without shared filesystem access
2. **Use shared volumes** with proper permissions for Docker setups
3. **Enable COMPRESSION** in backup options (reduces size 60-80%)
4. **Use CHECKSUM** for integrity verification
5. **Test restores** regularly
6. **Monitor backup duration** and adjust timeout
7. **Use encrypted connections** in production
8. **Separate backup user** from application user
9. **Enable Trust Server Certificate** only in development — use valid certs in production
