# WebDAV

Store backups on any WebDAV-compatible server - Nextcloud, ownCloud, Synology, Apache, and more.

## Configuration

::: info Credential Profile required
WebDAV requires a [Credential Profile](/user-guide/security/credential-profiles) of type `USERNAME_PASSWORD`. Create one in **Settings → Vault → Credentials** before saving the destination.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **URL** | WebDAV endpoint URL | - | ✅ |
| **Primary Credential** | `USERNAME_PASSWORD` credential profile (username + password or app password) | - | ✅ |
| **Path Prefix** | Subfolder path on the server | - | ❌ |

## Setup Guide

1. Create a `USERNAME_PASSWORD` credential profile in **Settings → Vault → Credentials** ([guide](/user-guide/security/credential-profiles))
2. Obtain the WebDAV URL from your provider (see examples below)
3. Go to **Connections** → **Backup Destinations** → **Add New** → **WebDAV**
4. Enter the **URL** and select the credential profile in the **Primary Credential** picker
5. (Optional) Set a **Path Prefix** to organize backups in a subfolder
6. Click **Test** to verify the connection

<details>
<summary>Nextcloud / ownCloud Setup</summary>

1. WebDAV URL format: `https://your-cloud.example.com/remote.php/dav/files/USERNAME/`
2. **Recommended**: Create an App Password under **Settings** → **Security** → **Devices & Sessions** instead of using your account password
3. Set **Path Prefix** to e.g. `Backups/DBackup`

</details>

<details>
<summary>Synology NAS WebDAV Setup</summary>

1. Enable WebDAV in **Package Center** → install **WebDAV Server**
2. Configure HTTPS port (default: 5006) under **WebDAV Server** → **Settings**
3. WebDAV URL: `https://your-nas:5006/`
4. Use Path Prefix to target a specific shared folder

</details>

## How It Works

- Files are uploaded via HTTP PUT to the WebDAV endpoint
- DBackup creates subdirectories per job within the Path Prefix automatically
- All credentials are stored AES-256-GCM encrypted in the database
- Supports both HTTP and HTTPS endpoints

## Troubleshooting

### 401 Unauthorized

```
401 Unauthorized
```

**Solution:** Check username and password. For Nextcloud, use an App Password instead of your account password (especially with 2FA enabled).

### 405 Method Not Allowed

```
405 Method Not Allowed
```

**Solution:** Verify the WebDAV URL is correct. A common mistake is using the web UI URL instead of the WebDAV endpoint.

### SSL Certificate Error

```
UNABLE_TO_VERIFY_LEAF_SIGNATURE
```

**Solution:** Ensure your server has a valid SSL certificate. For self-signed certs, set `NODE_TLS_REJECT_UNAUTHORIZED=0` (not recommended for production).

### MKCOL Failed

```
409 Conflict
```

**Solution:** The parent directory doesn't exist. Create the target folder manually in your WebDAV client or adjust the Path Prefix.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
