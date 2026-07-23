# Hetzner Object Storage

Store backups in Hetzner Object Storage - affordable S3-compatible storage in European and US data centers.

## Configuration

::: info Credential Profile required
Hetzner Object Storage requires a [Credential Profile](/user-guide/security/credential-profiles) of type `ACCESS_KEY`. Create one in **Settings → Vault → Credentials** before saving the destination.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **Region** | Hetzner data center region | `fsn1` | ✅ |
| **Bucket** | Bucket name | - | ✅ |
| **Primary Credential** | `ACCESS_KEY` credential profile (Access Key + Secret Key) | - | ✅ |
| **Path Prefix** | Folder path within the bucket | - | ✅ |

### Regions

| Region | Location |
| :--- | :--- |
| `fsn1` | Falkenstein, Germany (default) |
| `nbg1` | Nuremberg, Germany |
| `hel1` | Helsinki, Finland |
| `ash` | Ashburn, USA |

## Setup Guide

1. **Create a bucket** in the [Hetzner Cloud Console](https://console.hetzner.cloud/) → **Object Storage** → **Create Bucket**
2. **Generate S3 credentials**: Go to **Object Storage** → **Settings** → **Generate credentials**
   - Copy the **Access Key** and **Secret Key** immediately (shown only once)
3. **Create an `ACCESS_KEY` credential profile** in **Settings → Vault → Credentials** with those keys ([guide](/user-guide/security/credential-profiles))
4. Go to **Connections** → **Backup Destinations** → **Add New** → **Hetzner Object Storage**
5. Select your **Region**, enter the Bucket name, then select the credential profile in the **Primary Credential** picker
6. Enter a **Path Prefix** (required - e.g. `backups` or `dbackup/prod`)
6. Click **Test** to verify the connection

::: warning Path Prefix Required
Unlike other S3 adapters, Hetzner Object Storage **requires** a Path Prefix. Set it to any folder name (e.g. `backups`).
:::

## How It Works

- DBackup connects to `https://<bucket>.<region>.your-objectstorage.com` automatically
- Uses S3-compatible API - uploads via multipart for large files
- All credentials are stored AES-256-GCM encrypted in the database

## Troubleshooting

### AccessDenied

```
Access Denied (403)
```

**Solution:** Regenerate S3 credentials in Hetzner Cloud Console. Ensure the credentials haven't been revoked.

### Bucket Not Found

```
NoSuchBucket
```

**Solution:** Verify the bucket name and region match exactly. Buckets are region-specific.

### Missing Path Prefix

```
Validation error: path prefix is required
```

**Solution:** Enter a Path Prefix - this field is mandatory for Hetzner Object Storage.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
