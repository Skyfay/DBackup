# SMB / Samba

Store backups on Windows network shares or NAS devices via SMB/CIFS protocol.

## Overview

SMB (Server Message Block) is the standard file sharing protocol in Windows networks. Benefits:

- 🖥️ Native Windows/Active Directory integration
- 📁 Works with NAS devices (Synology, QNAP, TrueNAS)
- 🔑 Domain authentication support
- 🔒 SMB3 encryption support

::: warning Prerequisite
The SMB adapter requires the `smbclient` CLI tool to be installed on the host system. This is included in the official Docker image. For local development, install it via your package manager (e.g., `brew install samba` on macOS or `apt install smbclient` on Debian/Ubuntu).
:::

## Configuration

| Field | Description | Default |
| :--- | :--- | :--- |
| **Name** | Friendly name | Required |
| **Address** | UNC path to share (e.g. `//server/share`) | Required |
| **Username** | SMB username | `guest` |
| **Password** | SMB password | Optional |
| **Domain** | Workgroup or domain name | Optional |
| **Max Protocol** | Maximum SMB protocol version | `SMB3` |
| **Path Prefix** | Subdirectory on the share | Optional |

## Setup Examples

### Windows File Server

1. Create a shared folder on your Windows server
2. Set share permissions (read/write for backup user)
3. Configure in DBackup:
   - **Address**: `//fileserver.domain.local/Backups`
   - **Username**: `DOMAIN\backupuser`
   - **Password**: Your password
   - **Domain**: `DOMAIN`

### Synology NAS

1. Enable SMB in **Control Panel > File Services > SMB**
2. Create a shared folder for backups
3. Create a user with read/write access
4. Configure in DBackup:
   - **Address**: `//synology-ip/BackupShare`
   - **Username**: `backupuser`
   - **Password**: Your password

### QNAP NAS

1. Enable SMB in **Control Panel > Network & File Services > Win/Mac/NFS/WebDAV > Microsoft Networking**
2. Create a shared folder and set permissions
3. Configure in DBackup:
   - **Address**: `//qnap-ip/BackupShare`
   - **Username**: `backupuser`
   - **Password**: Your password

### TrueNAS

1. Create a dataset for backups
2. Create an SMB share pointing to the dataset
3. Create a user with appropriate permissions
4. Configure in DBackup:
   - **Address**: `//truenas-ip/backups`
   - **Username**: `backupuser`
   - **Password**: Your password

### Samba Server (Linux)

1. Install Samba: `sudo apt install samba`
2. Create a share in `/etc/samba/smb.conf`:

```ini
[backups]
    path = /srv/backups
    valid users = backupuser
    read only = no
    create mask = 0644
    directory mask = 0755
```

3. Create Samba user: `sudo smbpasswd -a backupuser`
4. Restart Samba: `sudo systemctl restart smbd`
5. Configure in DBackup:
   - **Address**: `//linux-server-ip/backups`
   - **Username**: `backupuser`
   - **Password**: Your Samba password

## Protocol Version

The **Max Protocol** setting controls the maximum SMB protocol version used:

| Protocol | Description |
| :--- | :--- |
| **SMB3** | Latest, with encryption support (recommended) |
| **SMB2** | Widely compatible, no encryption |
| **NT1** | Legacy (SMB1), use only for old devices |

::: warning Security
Avoid using NT1 (SMB1) unless absolutely necessary. SMB1 has known security vulnerabilities and is deprecated by Microsoft.
:::

## Directory Structure

After backups, your share will contain:

```
//server/share/
├── your-prefix/           (if Path Prefix is set)
│   ├── mysql-daily/
│   │   ├── backup_2024-01-15T12-00-00.sql.gz
│   │   ├── backup_2024-01-15T12-00-00.sql.gz.meta.json
│   │   └── ...
│   └── postgres-weekly/
│       └── ...
```

## Docker Configuration

The official DBackup Docker image includes `smbclient` out of the box. No additional configuration is needed.

If you're building a custom image, ensure `samba-client` is installed:

```dockerfile
RUN apk add --no-cache samba-client
```

## Troubleshooting

### Connection Failed

```
NT_STATUS_LOGON_FAILURE
```

**Solutions**:
1. Verify username and password are correct
2. Check if domain is required (e.g., `DOMAIN\user`)
3. Ensure the share exists and is accessible
4. Verify network connectivity to the server

### Access Denied

```
NT_STATUS_ACCESS_DENIED
```

**Solutions**:
1. Check share permissions for the user
2. Verify NTFS/filesystem permissions on the target folder
3. Ensure the user has write access

### Share Not Found

```
NT_STATUS_BAD_NETWORK_NAME
```

**Solutions**:
1. Verify the share name is correct (case-sensitive on some servers)
2. Check if the share is enabled and accessible
3. Try using the IP address instead of hostname

### Protocol Negotiation Failed

```
NT_STATUS_CONNECTION_DISCONNECTED
```

**Solutions**:
1. Try lowering **Max Protocol** to `SMB2`
2. Check if the server supports the selected protocol version
3. Verify firewall allows ports 445 (and optionally 139)

### smbclient Not Found

```
smbclient: command not found
```

**Solutions**:
1. Docker: Use the official DBackup image (includes smbclient)
2. Debian/Ubuntu: `sudo apt install smbclient`
3. Alpine: `apk add samba-client`
4. macOS: `brew install samba`

## Security Best Practices

1. **Use SMB3** — Provides encryption in transit
2. **Dedicated backup user** — Create a separate account for backups
3. **Minimal permissions** — Only grant read/write to the backup folder
4. **Network segmentation** — Restrict SMB traffic to trusted networks
5. **Firewall rules** — Limit source IPs that can access the share
6. **Disable guest access** — Require authentication for the share
7. **Enable backup encryption** — Use DBackup's encryption profiles for at-rest encryption

### Firewall Rules

SMB uses TCP port 445 (and optionally 139 for NetBIOS):

```bash
# UFW
sudo ufw allow from 10.0.0.0/8 to any port 445

# iptables
iptables -A INPUT -p tcp -s 10.0.0.0/8 --dport 445 -j ACCEPT
```

## Comparison with Other Destinations

| Feature | SMB | SFTP | S3 | Local |
| :--- | :--- | :--- | :--- | :--- |
| Setup complexity | Easy | Medium | Easy | Easiest |
| Windows native | ✅ | ❌ | ❌ | ❌ |
| NAS support | ✅ | ✅ | ❌ | ❌ |
| Self-hosted | ✅ | ✅ | ❌ | ✅ |
| Encryption in transit | ✅ (SMB3) | ✅ | ✅ | N/A |
| Domain auth | ✅ | ❌ | ❌ | N/A |
| Scalability | Limited | Limited | High | Limited |

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
