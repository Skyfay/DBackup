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
Pick **Create as directory source** in the menu of a destination, or **Create as backup destination** on a source, to copy it into the opposite role with its login, then adjust the path. Two adapters for one server is intentional: they point at different paths and are monitored separately.
:::

## Adding a Destination

1. Navigate to **Connections** → **Backup Destinations** → **Add New**
2. Select the storage type
3. Fill in the parts listed on the left. A check marks each part that has everything it needs.
4. Leave **Used as** on **Backup destination** in the **Behavior** part
5. Click **Test connection**, then **Create destination**

## Storage Structure

Backups are organized by job name with sidecar metadata files:

```
/your-prefix/
└── job-name/
    ├── backup_2024-01-15T12-00-00.sql.gz.enc
    └── backup_2024-01-15T12-00-00.sql.gz.enc.meta.json
```

The `.meta.json` file stores compression, encryption metadata (IV, auth tag, profile ID), database version, and timestamp.

## Upload Performance (S3)

A backup is one large file, so the only way to use more of a fast link is to send several pieces of it at the same time. Every S3 destination (Amazon S3, Cloudflare R2, Hetzner Object Storage, S3-Compatible) splits an upload into parts and sends **8 parts of 8 MB** at once by default.

Both values are adjustable per destination in the **Speed** part of its form:

| Field | Description | Default | Range |
| :--- | :--- | :--- | :--- |
| **Parts at once** | Parts uploaded simultaneously | `8` | 1 to 32 |
| **Largest part (MB)** | Upper bound on the size of each part | `8` | 5 to 64 |

### Parts at once is the speed setting

Each part travels over its own connection, and a single connection to an object store is usually capped somewhere between 5 and 10 MB/s no matter how much bandwidth is available. Total throughput is therefore roughly `parts at once x per-connection speed`, so raising this is what makes an upload faster.

Raise it when the upload speed in the run log is well below what the server's link can do. Lower it if the provider starts answering with `SlowDown` or `503`.

::: tip Measured example
Uploading a 1.39 GB backup to Cloudflare R2 over a 10 Gbit link, where each connection managed about 5.9 MB/s:

| Parts at once | Throughput |
| :--- | :--- |
| 4 | 26 MB/s |
| 32 | 187 MB/s |
:::

### Max part size is a memory setting

Parts in flight are held in memory, so an upload uses roughly `(parts + 1) x part size` while it runs. The form shows the figure as you change the values. The default works out to about 72 MB, the maximum to about 2 GB.

You are setting an upper bound, not a fixed size. **DBackup picks the largest part size at or below your value that still gives every connection something to upload.** The right size depends on how large a backup turns out to be, and that differs from run to run, so it is not something a static setting can track.

Why it matters: with 32 parts at once, a 1.39 GB backup split into 64 MB parts is only 21 parts. Eleven connections would get nothing, and the upload would take as long as its single slowest part. The automatic adjustment prevents that, and the run log reports the size actually used.

::: warning Concurrent jobs
If **Max Concurrent Jobs** is above 1, several uploads can run at once and each one uses its own memory budget. Destinations within a single job upload one after another, so those do not add up.
:::

DBackup also raises the part size above your maximum in one case: when an archive is so large that your value would need more than S3's limit of 10,000 parts. The alternative there is an upload the service rejects.

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
