# Storage Destinations

DBackup supports multiple storage backends for your backups.

## Supported Destinations

### Local & Network

| Destination | Type | Best For |
| :--- | :--- | :--- |
| [Local Filesystem](/user-guide/destinations/local) | File | Quick setup, on-premise |
| [SFTP](/user-guide/destinations/sftp) | Remote | Existing Linux/Unix servers |
| [FTP / FTPS](/user-guide/destinations/ftp) | Remote | Legacy infrastructure, shared hosting |
| [SMB / Samba](/user-guide/destinations/smb) | Network | Windows shares, NAS devices |
| [WebDAV](/user-guide/destinations/webdav) | Network | Nextcloud, ownCloud, NAS |
| [Rsync (SSH)](/user-guide/destinations/rsync) | Remote | Efficient delta transfers |

### S3-Compatible

| Destination | Best For |
| :--- | :--- |
| [Amazon S3](/user-guide/destinations/s3-aws) | AWS infrastructure, high durability |
| [S3 Compatible](/user-guide/destinations/s3-generic) | MinIO, DigitalOcean, Backblaze |
| [Cloudflare R2](/user-guide/destinations/s3-r2) | Zero egress fees |
| [Hetzner Object Storage](/user-guide/destinations/s3-hetzner) | EU data residency, GDPR |

### Cloud Drives

| Destination | Free Tier | Auth |
| :--- | :--- | :--- |
| [Google Drive](/user-guide/destinations/google-drive) | 15 GB | OAuth 2.0 |
| [Dropbox](/user-guide/destinations/dropbox) | 2 GB | OAuth 2.0 |
| [Microsoft OneDrive](/user-guide/destinations/onedrive) | 5 GB | OAuth 2.0 |

## Destination or Directory Source

The same storage backends serve two different purposes, and each configured adapter is set
to exactly one of them:

| Role | What it does | Path it uses |
| :--- | :--- | :--- |
| **Backup Destination** | Receives backups | The configured path, with one folder per job written into it (plus a folder per chain for incremental jobs) |
| **Directory Source** | Provides files to back up | Folders below the configured path, picked per job |

They are mutually exclusive on purpose. A destination owns its path and creates folders
there, while a source reads from that same path - and a source set to "Back up everything"
reads the path itself. One adapter doing both would mean a job backing up its own previous
archives, growing without limit.

Both live on the **Connections** page, on the **Backup Destinations** and **Directory Sources** tabs.

::: tip Same server for both
Pick **Create as Directory Source** on a destination's row (or the reverse on a source) to
copy it into the opposite role, credentials and all - then adjust the path. Two adapters
for one server is intentional: they point at different paths and are monitored separately.
:::

## Adding a Destination

1. Navigate to **Connections** → **Backup Destinations** → **Add New**
2. Select the storage type
3. Fill in configuration details
4. Leave **Role** on *Backup Destination*
5. Click **Test Connection** → **Save**

## Storage Structure

Backups are organized by job name with sidecar metadata files:

```
/your-prefix/
└── job-name/
    ├── backup_2024-01-15T12-00-00.sql.gz.enc
    └── backup_2024-01-15T12-00-00.sql.gz.enc.meta.json
```

The `.meta.json` file stores compression, encryption metadata (IV, auth tag, profile ID), database version, and timestamp.

## Retention Policies

Destinations work with retention policies to automatically clean up old backups:

- **Simple**: Keep last N backups
- **Smart (GFS)**: Grandfather-Father-Son rotation

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
