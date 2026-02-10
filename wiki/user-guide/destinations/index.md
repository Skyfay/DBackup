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

## Next Steps

Choose your storage destination:

- [Local Filesystem](/user-guide/destinations/local)
- [Amazon S3](/user-guide/destinations/s3-aws)
- [S3 Compatible](/user-guide/destinations/s3-generic)
- [Cloudflare R2](/user-guide/destinations/s3-r2)
- [Hetzner Object Storage](/user-guide/destinations/s3-hetzner)
- [SFTP](/user-guide/destinations/sftp)
- [SMB / Samba](/user-guide/destinations/smb)
