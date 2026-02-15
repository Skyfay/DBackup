# Storage Destinations

DBackup supports multiple storage backends for your backups. Choose based on your requirements for availability, cost, and compliance.

## Supported Destinations

| Destination | Type | Best For |
| :--- | :--- | :--- |
| [Local Filesystem](/user-guide/destinations/local) | File | Quick setup, on-premise |
| [Amazon S3](/user-guide/destinations/s3-aws) | Cloud | AWS infrastructure |
| [S3 Compatible](/user-guide/destinations/s3-generic) | Cloud | MinIO, self-hosted |
| [Cloudflare R2](/user-guide/destinations/s3-r2) | Cloud | Zero egress fees |
| [Hetzner Object Storage](/user-guide/destinations/s3-hetzner) | Cloud | EU data residency |
| [SFTP](/user-guide/destinations/sftp) | Remote | Existing servers |
| [SMB / Samba](/user-guide/destinations/smb) | Network | Windows shares, NAS |
| [WebDAV](/user-guide/destinations/webdav) | Network | Nextcloud, ownCloud, NAS |
| [FTP / FTPS](/user-guide/destinations/ftp) | Remote | Classic FTP servers |
| [Rsync (SSH)](/user-guide/destinations/rsync) | Remote | Efficient delta transfers |
| [Google Drive](/user-guide/destinations/google-drive) | Cloud | OAuth-based cloud storage |
| [Dropbox](/user-guide/destinations/dropbox) | Cloud | OAuth-based cloud storage |
| [Microsoft OneDrive](/user-guide/destinations/onedrive) | Cloud | OAuth-based cloud storage |

## Choosing a Destination

### Local Filesystem

**Pros:**
- No external dependencies
- Fastest backup speed
- Zero cost

**Cons:**
- Single point of failure
- Limited by disk space
- No offsite protection

**Best for:** Development, testing, or as first stage before cloud sync.

### Amazon S3

**Pros:**
- High durability (99.999999999%)
- Glacier for long-term archives
- Global infrastructure

**Cons:**
- Egress fees
- Complexity of IAM

**Best for:** AWS-based infrastructure, enterprise requirements.

### S3 Compatible (MinIO, etc.)

**Pros:**
- Self-hosted control
- No vendor lock-in
- Works with any S3-compatible API

**Cons:**
- Self-managed infrastructure
- Requires setup expertise

**Best for:** On-premise object storage, data sovereignty.

### Cloudflare R2

**Pros:**
- **Zero egress fees**
- S3-compatible API
- Global edge network

**Cons:**
- Newer service
- Limited regions

**Best for:** Frequent downloads, cost-sensitive workloads.

### Hetzner Object Storage

**Pros:**
- EU data residency (GDPR)
- Competitive pricing
- German infrastructure

**Cons:**
- Limited to EU regions
- Smaller feature set

**Best for:** EU compliance, budget-conscious teams.

### SFTP

**Pros:**
- Works with existing servers
- Simple setup
- Encrypted transfer

**Cons:**
- Limited to single server
- Manual capacity management

**Best for:** Utilizing existing infrastructure.

### SMB / Samba

**Pros:**
- Native Windows/Active Directory integration
- Works with NAS devices out of the box
- Domain authentication support

**Cons:**
- Requires `smbclient` on the host
- Limited to network shares
- Less secure than SSH-based transfers

**Best for:** Windows environments, NAS devices, Active Directory networks.

### WebDAV

**Pros:**
- Works over HTTP/HTTPS — no special ports
- Native Nextcloud/ownCloud integration
- No CLI dependencies required

**Cons:**
- Performance depends on HTTP server
- Some servers have upload size limits

**Best for:** Nextcloud/ownCloud users, HTTP-accessible storage.

### FTP / FTPS

**Pros:**
- Widely supported, works with almost any hosting provider
- Optional TLS encryption (FTPS)
- No CLI dependencies required

**Cons:**
- FTP without TLS is unencrypted
- Passive mode can be tricky with firewalls
- Legacy protocol

**Best for:** Shared hosting, legacy infrastructure, simple file transfer needs.

### Rsync (SSH)

**Pros:**
- Delta transfers — only changed blocks are sent
- Encrypted transfer via SSH
- Built-in compression
- Works with any Linux/macOS server

**Cons:**
- Requires `rsync` and `sshpass` on the host
- No Windows server support
- SSH access required on remote

**Best for:** Efficient recurring backups to Linux servers, bandwidth-limited environments.

### Google Drive

**Pros:**
- 15 GB free storage
- OAuth 2.0 — no API keys needed
- Scoped access (`drive.file` + `drive.readonly`) — minimal permissions
- Automatic token refresh

**Cons:**
- Requires Google Cloud Console setup
- Free tier shared with Gmail/Photos
- API quotas apply

**Best for:** Personal backups, small teams, cloud storage without additional costs.

### Dropbox

**Pros:**
- 2 GB free storage
- OAuth 2.0 — no API keys needed
- Simple Dropbox App Console setup
- Automatic token refresh
- Large file support (chunked uploads)

**Cons:**
- Small free tier (2 GB)
- Requires Dropbox App Console setup
- App folder mode limits access to app-owned folder

**Best for:** Personal backups, simple cloud storage, Dropbox users.

### Microsoft OneDrive

**Pros:**
- 5 GB free storage
- OAuth 2.0 via Microsoft Identity Platform
- Works with personal and organizational accounts
- Automatic token refresh
- Large file support (chunked upload sessions)

**Cons:**
- Azure App Registration required (one-time setup)
- Client secrets expire (max 24 months)
- Setup more involved than Google Drive or Dropbox

**Best for:** Microsoft 365 users, organizational environments, Windows/Azure ecosystems.

## Adding a Destination

1. Navigate to **Destinations** in the sidebar
2. Click **Add Destination**
3. Select the storage type
4. Fill in configuration details
5. Click **Test Connection**
6. Save the destination

## Test Connection

Every destination adapter implements a `test()` function that verifies:

1. **Network connectivity** - Can reach the service
2. **Authentication** - Credentials are valid
3. **Write permission** - Can create files
4. **Delete permission** - Can remove files (for retention)

::: warning Test Failure
If "Test Connection" fails, backups will also fail. Always test before creating jobs.
:::

## Storage Structure

When backups are uploaded, DBackup creates:

```
/your-prefix/
├── job-name/
│   ├── backup_2024-01-15T12-00-00.sql
│   ├── backup_2024-01-15T12-00-00.sql.meta.json
│   ├── backup_2024-01-16T12-00-00.sql.gz
│   ├── backup_2024-01-16T12-00-00.sql.gz.meta.json
│   └── ...
```

Each backup has a corresponding `.meta.json` sidecar file containing:
- Compression settings
- Encryption metadata (IV, auth tag, profile ID)
- Database engine version
- Backup timestamp

## Security

### Credential Storage

All storage credentials (access keys, passwords) are encrypted at rest using your `ENCRYPTION_KEY`.

### Transfer Encryption

- **S3**: Uses HTTPS (TLS 1.2+)
- **SFTP**: Uses SSH encryption
- **SMB**: Uses SMB3 encryption (configurable protocol version)
- **WebDAV**: Uses HTTPS (TLS 1.2+)
- **FTP/FTPS**: Uses TLS when enabled
- **Rsync**: Uses SSH encryption
- **Google Drive**: Uses HTTPS (TLS 1.2+) + OAuth 2.0
- **Dropbox**: Uses HTTPS (TLS 1.2+) + OAuth 2.0
- **OneDrive**: Uses HTTPS (TLS 1.2+) + OAuth 2.0 (Microsoft Graph API)
- **Local**: No network transfer

### Backup Encryption

For additional security, enable backup encryption:
1. Create an Encryption Profile in the Vault
2. Assign it to your backup job
3. Backups are encrypted before upload

## Multiple Destinations

You can:
- Use different destinations for different jobs
- Create the same backup to multiple destinations
- Separate production and test backups

## Retention Policies

Destinations work with retention policies to automatically clean up old backups:

- **Simple**: Keep last N backups
- **Smart (GVS)**: Grandfather-Father-Son rotation

See [Retention Policies](/user-guide/jobs/retention) for details.
- [FTP / FTPS](/user-guide/destinations/ftp)

## Next Steps

Choose your storage destination:

- [Local Filesystem](/user-guide/destinations/local)
- [Amazon S3](/user-guide/destinations/s3-aws)
- [S3 Compatible](/user-guide/destinations/s3-generic)
- [Cloudflare R2](/user-guide/destinations/s3-r2)
- [Hetzner Object Storage](/user-guide/destinations/s3-hetzner)
- [SFTP](/user-guide/destinations/sftp)
- [SMB / Samba](/user-guide/destinations/smb)
- [WebDAV](/user-guide/destinations/webdav)
- [FTP / FTPS](/user-guide/destinations/ftp)
- [Rsync (SSH)](/user-guide/destinations/rsync)
- [Google Drive](/user-guide/destinations/google-drive)
- [Dropbox](/user-guide/destinations/dropbox)
- [Microsoft OneDrive](/user-guide/destinations/onedrive)
