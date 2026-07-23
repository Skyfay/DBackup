# S3-Compatible Storage

Store backups in any S3-compatible storage provider - MinIO, Wasabi, DigitalOcean Spaces, Backblaze B2, and more.

## Configuration

::: info Credential Profile required
S3-Compatible Storage requires a [Credential Profile](/user-guide/security/credential-profiles) of type `ACCESS_KEY`. Create one in **Settings → Vault → Credentials** before saving the destination.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **Endpoint** | S3-compatible API endpoint URL | - | ✅ |
| **Region** | Storage region | `us-east-1` | ❌ |
| **Bucket** | Bucket name | - | ✅ |
| **Primary Credential** | `ACCESS_KEY` credential profile (Access Key ID + Secret Access Key) | - | ✅ |
| **Force Path Style** | Use path-style URLs (`endpoint/bucket`) instead of virtual-hosted | `false` | ❌ |
| **Path Prefix** | Folder path within the bucket | - | ❌ |

::: tip Force Path Style
Enable this for providers that don't support virtual-hosted-style URLs (e.g. MinIO, Ceph). When enabled, requests go to `endpoint/bucket/key` instead of `bucket.endpoint/key`.
:::

## Setup Guide

1. Create a bucket in your S3-compatible provider
2. Generate access credentials (access key + secret key)
3. **Create an `ACCESS_KEY` credential profile** in **Settings → Vault → Credentials** with those keys ([guide](/user-guide/security/credential-profiles))
4. Go to **Connections** → **Backup Destinations** → **Add New** → **S3-Compatible**
5. Enter the **Endpoint** URL and Bucket, then select the credential profile in the **Primary Credential** picker
6. Enable **Force Path Style** if required by your provider
7. (Optional) Set a **Path Prefix** for organizing backups
8. Click **Test** to verify the connection

<details>
<summary>MinIO Setup</summary>

1. Access the MinIO Console (default: `http://your-server:9001`)
2. Create a bucket under **Buckets** → **Create Bucket**
3. Create an access key under **Access Keys** → **Create Access Key**
4. Use endpoint `http://your-minio-host:9000` with **Force Path Style** enabled

Common Docker setup:

```yaml
services:
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data
```

</details>

<details>
<summary>Wasabi Setup</summary>

1. Create a bucket at [console.wasabisys.com](https://console.wasabisys.com/)
2. Create an API access key under **Access Keys**
3. Use the regional endpoint, e.g. `https://s3.eu-central-1.wasabisys.com`
4. **Force Path Style**: off (Wasabi supports virtual-hosted style)

</details>

<details>
<summary>DigitalOcean Spaces Setup</summary>

1. Create a Space in [DigitalOcean Console](https://cloud.digitalocean.com/spaces)
2. Generate a Spaces access key under **API** → **Spaces Keys**
3. Use endpoint `https://<region>.digitaloceanspaces.com` (e.g. `https://fra1.digitaloceanspaces.com`)
4. **Force Path Style**: off

</details>

<details>
<summary>Backblaze B2 Setup</summary>

1. Create a bucket at [Backblaze Console](https://secure.backblaze.com/b2_buckets.htm)
2. Create an **Application Key** with read/write access to your bucket
3. Use endpoint `https://s3.<region>.backblazeb2.com` (e.g. `https://s3.us-west-002.backblazeb2.com`)
4. **Force Path Style**: off

</details>

## How It Works

- Uses the S3-compatible API via the AWS SDK
- Multipart upload for large files
- All credentials are stored AES-256-GCM encrypted in the database

## Troubleshooting

### Connection Refused

```
connect ECONNREFUSED
```

**Solution:** Verify the endpoint URL is correct and reachable from the DBackup server. Include the protocol (`http://` or `https://`) and port if non-standard.

### SignatureDoesNotMatch

```
The request signature we calculated does not match
```

**Solution:** Usually caused by incorrect Secret Access Key. Re-enter the credentials. Some providers need specific region values.

### NoSuchBucket

```
The specified bucket does not exist
```

**Solution:** Create the bucket first in your provider's console. Bucket names must match exactly (case-sensitive).

### SSL Certificate Error

```
self-signed certificate / UNABLE_TO_VERIFY_LEAF_SIGNATURE
```

**Solution:** For self-signed certificates (e.g. local MinIO), set the `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable. Not recommended for production.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
