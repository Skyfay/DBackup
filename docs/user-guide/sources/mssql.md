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

## Connection Modes

| Mode | SQL Server connection | `.bak` transfer |
| :--- | :--- | :--- |
| **Direct** | Straight to the SQL Server port | Shared volume or SSH, chosen under [File Transfer Modes](#file-transfer-modes) |
| **SSH** | Tunnelled through the SSH connection | The same SSH connection, nothing to configure |

**SSH mode** is the simpler setup and the better choice when the SQL Server port is not reachable from DBackup. DBackup opens one SSH connection to the server and sends the SQL Server protocol through it, so **port 1433 does not have to be exposed at all**. The `.bak` file travels back over that same connection, which is why SSH mode has no File Transfer settings.

Certificate validation still applies through the tunnel: DBackup validates against the hostname in the **Host** field, not against the tunnel endpoint. Encryption settings behave exactly as in direct mode.

::: tip Existing sources are unaffected
Sources created before SSH mode existed keep working exactly as they did. They stay in direct mode, and their File Transfer settings are untouched. There is nothing to migrate.
:::

SSH mode requires an `SSH_KEY` [Credential Profile](/user-guide/security/credential-profiles) and an SSH account on the SQL Server host. That account needs read and write access to the **Backup Path**, but no SQL Server privileges - the database login is still what authenticates against SQL Server.

::: warning The SSH account and SQL Server must share the backup directory
SQL Server writes the `.bak` file, and DBackup fetches it over SSH. Both must mean the **same physical directory**.

This is the usual thing to get wrong when SQL Server runs in a container: `/var/opt/mssql/backup` exists inside the container **and** on the host, but they are two different directories. The backup then succeeds and the download fails with "No such file".

Bind-mount a path that is identical on both sides and set **Backup Path** to it:

```yaml
services:
  mssql:
    volumes:
      - /data/mssql-backups:/data/mssql-backups
```

**Test Connection** checks this for you: it creates a file over SSH and asks SQL Server whether it can see it, so a mismatch is reported before the first backup runs.

Mounting the path is only half of it - SQL Server also has to be allowed to write there, and in a container it does not run as root. See [Backup Permission Denied](#backup-permission-denied).
:::

## Configuration

::: info Credential Profiles required
Microsoft SQL Server requires a [Credential Profile](/user-guide/security/credential-profiles). Create an `USERNAME_PASSWORD` profile in **Settings → Vault → Credentials** before saving the source. SSH connection mode, and SSH file transfer mode in direct connections, additionally require an `SSH_KEY` profile.
:::

### Connection Settings

| Field | Description | Default |
| :--- | :--- | :--- |
| **Connection Mode** | `Direct` or `SSH` (see [Connection Modes](#connection-modes)) | `Direct` |
| **Host** | SQL Server hostname | `localhost` |
| **Port** | SQL Server port | `1433` |
| **Primary Credential** | `USERNAME_PASSWORD` credential profile (SQL Server login + password) | Required |
| **Database** | Database name(s) to backup | Required |

In SSH mode, **Host** and **Port** describe the SQL Server as reachable **from the SSH host**. `localhost:1433` is the usual value when SQL Server runs on that machine.

### Configuration Settings

| Field | Description | Default |
| :--- | :--- | :--- |
| **Encrypt** | Use encrypted connection | `true` |
| **Trust Server Certificate** | Trust self-signed certs | `false` |
| **Request Timeout** | Query timeout in ms | `300000` (5 min) |
| **Additional Options** | Extra BACKUP options | - |

### File Transfer Settings

These apply to **direct** connection mode only. In SSH mode the `.bak` file travels over the SSH connection and none of these fields are shown.

| Field | Description | Default |
| :--- | :--- | :--- |
| **Backup Path (Server)** | Server-side backup directory | `/var/opt/mssql/backup` |
| **File Transfer Mode** | How to access .bak files | `local` |
| **Local Backup Path** | Host-side mounted path (local mode) | `/tmp` |
| **SSH Host** | SSH host (SSH mode, defaults to DB host) | - |
| **SSH Port** | SSH port (SSH mode) | `22` |
| **SSH Credential** | `SSH_KEY` credential profile for file transfer (SSH mode) | - |

## File Transfer Modes

::: info Direct connection mode only
These modes describe how a **direct** connection reaches the `.bak` file. In SSH connection mode the file comes back over the SSH connection already, so there is nothing to choose here. See [Connection Modes](#connection-modes).
:::

DBackup supports two modes to access the `.bak` files that SQL Server creates on its filesystem.

### Local File Transfer (Shared Volume)

Use this when DBackup and SQL Server share a filesystem - typically via Docker volume mounts or NFS shares.

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
4. DBackup packs it into the backup archive (compress/encrypt) and uploads to destination
5. Cleanup: Original `.bak` file is deleted

### SSH File Transfer (Remote Server)

Use this when SQL Server runs on a remote host (bare-metal, VM, or remote Docker) and there is no shared filesystem. DBackup connects via SSH/SFTP to download/upload `.bak` files.

#### Setup

1. Set **File Transfer Mode** to `SSH`
2. Select an `SSH_KEY` credential profile in the **SSH Credential** picker
3. Set **Backup Path (Server)** to the directory on the SQL Server host (e.g., `/var/opt/mssql/backup`)
4. Ensure the SSH user has read/write access to the backup path

::: tip SSH Host Default
If **SSH Host** is left empty, DBackup uses the same hostname as the database connection. This is the most common setup since SSH and SQL Server usually run on the same machine.
:::

::: warning Backup Path is shared between SQL Server and SSH
The **Backup Path (Server)** is used for both the `BACKUP DATABASE` T-SQL command **and** the SSH/SFTP file transfer. This means:
- SQL Server must be able to **write** to this path
- The SSH user must be able to **read and delete** files in this path
- Both must reference the **same physical directory** on disk

If SQL Server runs in **Docker**, the default path `/var/opt/mssql/backup` only exists inside the container. Use a volume-mounted path that is **identical on both the host and inside the container** (e.g., `/data/mssql-backups`), so SSH can reach the same files:

```yaml
services:
  mssql:
    volumes:
      - /data/mssql-backups:/data/mssql-backups
```

Then set **Backup Path (Server)** to `/data/mssql-backups`.

If SQL Server is installed **directly on the host** (bare-metal/VM), you can use the default path `/var/opt/mssql/backup` since SSH has direct access to the host filesystem.
:::

#### How It Works (Backup)

1. DBackup sends `BACKUP DATABASE` command to SQL Server
2. SQL Server writes `.bak` file to the backup path on its filesystem
3. DBackup connects via SSH/SFTP and downloads the `.bak` file
4. DBackup packs it into the backup archive (compress/encrypt) and uploads to destination
5. Cleanup: Remote `.bak` file is deleted via SSH

#### How It Works (Restore)

1. DBackup reads the database's `.bak` out of the backup, by byte range where the destination supports it
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

## SQL Server on Windows

**Backup Path (Server)** is handed to SQL Server exactly as written, so on a Windows server it has to be a Windows path. Both forms are accepted:

| Form | Example |
| :--- | :--- |
| Local drive | `D:/SQLBackup` |
| UNC share | `\\192.168.0.10\SQLBackup` |

Write a drive path with **forward slashes**. Windows accepts either separator in `BACKUP DATABASE`, and forward slashes are also what SFTP expects, so one spelling works in every transfer mode.

::: danger Change the default path first
The default `/var/opt/mssql/backup` is a Linux path. Windows treats it as relative to the instance's own backup directory and the backup fails on the first run:

```
Cannot open backup device
'D:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\Backup\/var/opt/mssql/backup/mydb.bak'
Operating system error 3 (The system cannot find the path specified.)
```

In **local** file transfer mode nothing catches this before the run. The connection test checks the SQL Server connection, and the path is only used once a backup starts. In **SSH** mode the test does check the path, because it can reach it.
:::

### SSH mode

The `.bak` file is written on the Windows side and has to travel back, and SSH mode is what that is for. It behaves exactly as on Linux: DBackup tunnels the SQL Server connection through SSH and the file comes back over the same connection. Nothing is shared, port 1433 does not have to be reachable, and **Backup Path (Server)** stays an ordinary local directory on the server.

On the SQL Server host DBackup only ever uses SFTP and port forwarding, never a remote command, so the default `cmd.exe` shell does not matter.

Windows Server 2019 and newer ship the OpenSSH server as an optional feature. Install and start it in PowerShell as Administrator:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

Then set up the source as described under [Connection Modes](#connection-modes) and point **Backup Path (Server)** at the directory SQL Server writes into, for example `D:/SQLBackup`. **Test Connection** writes a probe file over SFTP and asks SQL Server whether it sees it, so a wrong path is reported before the first backup.

::: warning Administrator accounts keep their public keys elsewhere
When the SSH account belongs to the local **Administrators** group, OpenSSH on Windows reads `C:\ProgramData\ssh\administrators_authorized_keys` and ignores that user's own `authorized_keys`. See [key management in the OpenSSH documentation](https://learn.microsoft.com/windows-server/administration/openssh/openssh_keymanagement).

A normal account avoids the whole question and is enough. It needs read, write and delete access to the backup directory and no SQL Server privileges at all.
:::

### Local mode over an SMB share

Use this where the OpenSSH server is not an option, on Windows Server 2016 and older or where policy rules it out. It also fits when the `.bak` belongs on a NAS rather than on the server's own disk.

```
DBackup (Docker on Synology/Linux)          Windows Server
        │                                   └── SQL Server
        │  BACKUP DATABASE (TCP 1433)  ───────────►  │
        │                                            │ writes
        │                                            ▼
        └── reads /mnt/sql-backup  ◄────  \\synology-nas\sql-backup
                        (the same share, seen from both sides)
```

1. Create the share on the NAS or file server, for example `sql-backup`.
2. Mount it into the DBackup container, for example at `/mnt/sql-backup`.
3. Set **File Transfer Mode** to `local`.
4. Set **Backup Path (Server)** to the UNC path the SQL Server uses, for example `\\synology-nas\sql-backup`.
5. Set **Local Backup Path** to the mount point inside the DBackup container, for example `/mnt/sql-backup`.

The two paths point at the same directory from two sides, exactly as in the Docker volume setup above. DBackup never speaks SMB itself, it reads the mount.

::: warning The SQL Server service account needs access to the share
`BACKUP DATABASE` runs as the **SQL Server service account**, not as the login DBackup connects with. The default service accounts (`NT Service\MSSQLSERVER`, `Network Service`, `Local System`) have no identity on the network, so writing to a UNC path fails with operating system error 5 even when the share is open to every account you tested it with.

Two ways out:

- Run the SQL Server service under a **domain account** and give that account write access to the share.
- Grant the share and NTFS permissions to the **computer account** (`DOMAIN\SERVERNAME$`), which is the identity a default service account presents on the network.

A local Windows account on the SQL Server is not enough, the file server has no way to authenticate it.
:::

::: tip Verify the path from the server before configuring the source
Run this in SSMS on the SQL Server, as the same instance DBackup connects to. If it fails here, no DBackup setting will fix it.

```sql
BACKUP DATABASE [master] TO DISK = N'\\synology-nas\sql-backup\permission-test.bak' WITH INIT
```
:::

### Restoring to a Windows server

Restore uses the same route the backup used and needs no extra setting. When the target database name differs from the one in the backup, DBackup relocates the data and log files into the instance's own default directories, which it reads from the server. On a server too old to report them, SQL Server 2008 R2 and earlier, the files stay in the directory the backup records.

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

The **SQL Server service account** cannot write to the backup directory. The directory usually exists and looks fine from your own shell, because you are checking it as a different user than SQL Server runs as.

<details>
<summary><b>Docker</b> - the common case, and the one where the obvious fix does not work</summary>

The official SQL Server image runs as the user `mssql` with **UID 10001**, not as root. A bind mount passes the host's ownership straight through, so a directory owned by `root` on the host is owned by `root` inside the container too, and SQL Server cannot write to it. Mounting the path correctly is not enough.

There is no `mssql` user on the host, so `chown mssql:mssql` fails or points at the wrong account. Use the numeric ID:

```bash
sudo chown -R 10001:0 /var/opt/mssql/backup
```

No container restart is needed, the mount is live. Confirm the ID first if you use a different image:

```bash
docker exec mssql id
```

</details>

**SQL Server installed directly on the host:**

```bash
sudo chown mssql:mssql /path/to/backup-dir
sudo chmod 770 /path/to/backup-dir
```

Also verify the backup directory exists on the SQL Server - it is **not** created automatically.

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

### SSH File Transfer Failed - Permission Denied (SSH Mode)

```
Failed to download /path/to/backup.bak: Permission denied
```

This is the most common SSH mode issue. The backup **succeeds** (SQL Server writes the `.bak` file), but the SSH/SFTP download **fails** because the SSH user cannot read the file.

**Why this happens:** SQL Server runs as the `mssql` service account and creates `.bak` files with restrictive permissions (typically `640`, owner `mssql:mssql`). Even if the backup directory has `777` permissions, the **file itself** is owned by `mssql` with limited access - your SSH user cannot read it.

**Solution 1 - Add SSH user to the `mssql` group** (recommended):
```bash
sudo usermod -aG mssql your-ssh-user
```
Log out and back in (or run `newgrp mssql`) for the change to take effect.

**Solution 2 - Set default ACL on the backup directory:**
```bash
sudo setfacl -d -m u:your-ssh-user:rwx /path/to/backup-dir
sudo setfacl -m u:your-ssh-user:rwx /path/to/backup-dir
```
This ensures every new file created in the directory is automatically readable by your SSH user.

**Solution 3 - Change SQL Server's default file permissions:**
```bash
sudo systemctl edit mssql-server
```
Add:
```ini
[Service]
UMask=0022
```
Then restart: `sudo systemctl restart mssql-server`. SQL Server will now create files with `644` permissions (world-readable).

::: tip
Solution 1 is the quickest and least invasive fix. Solutions 2 and 3 are alternatives if you cannot modify group membership.
:::

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

Each database is backed up to its own `.bak` and stored as one entry of the backup's seekable archive, so one database can be restored or downloaded out of a backup of many without reading the others. Backups written by earlier versions are a single `.bak`, or a `.tar` of `.bak` files for several databases, and remain restorable.

To restore a SQL Server backup:

1. Go to **Storage Explorer**
2. Find your backup
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
9. **Enable Trust Server Certificate** only in development - use valid certs in production
