# SMB / CIFS

Store backups on a Windows share, NAS, or any SMB/CIFS-compatible network storage.

## Configuration

::: info Credential Profile required
SMB requires a [Credential Profile](/user-guide/security/credential-profiles) of type `USERNAME_PASSWORD`. Create one in **Settings → Vault → Credentials** before saving the destination. For anonymous access, the credential profile username defaults to `guest` with no password.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **Address** | UNC share path (e.g. `//server/share`) | - | ✅ |
| **Primary Credential** | `USERNAME_PASSWORD` credential profile (username + password) | - | ❌ |
| **Domain** | Windows domain / workgroup | - | ❌ |
| **Max Protocol** | Highest SMB protocol version to use | `SMB3` | ❌ |
| **Path Prefix** | Subfolder within the share | - | ❌ |

### Protocol Versions

| Protocol | Notes |
| :--- | :--- |
| `SMB3` | Default, recommended - encrypted transport |
| `SMB2` | Fallback for older NAS devices |
| `NT1` | SMB1 legacy - use only if required |

## Setup Guide

1. Create a `USERNAME_PASSWORD` credential profile in **Settings → Vault → Credentials** ([guide](/user-guide/security/credential-profiles))
2. Ensure the SMB share is accessible from the DBackup server
3. Create a dedicated user with write access to the share (recommended)
4. Go to **Connections** → **Backup Destinations** → **Add New** → **SMB / CIFS**
5. Enter the **Address** in UNC format: `//hostname-or-ip/sharename`
6. Select the credential profile in the **Primary Credential** picker (or leave empty for anonymous access)
7. (Optional) Set **Domain** if authenticating against a Windows domain
8. (Optional) Set **Path Prefix** for a subfolder within the share
9. Click **Test** to verify the connection

::: tip NAS Devices
Synology, QNAP, TrueNAS, and OpenMediaVault all support SMB shares. Create a dedicated share and user for backups in your NAS admin panel.
:::

## How It Works

- DBackup mounts the SMB share temporarily for each operation, then unmounts
- Files are written directly to the share - same behavior as local storage
- All credentials are stored AES-256-GCM encrypted in the database
- `smbclient` must be available in the DBackup container (included in the default Docker image)

## Troubleshooting

### Connection Refused

```
NT_STATUS_CONNECTION_REFUSED
```

**Solution:** Verify the server address and that SMB is enabled. Check the firewall allows port 445.

### Access Denied

```
NT_STATUS_ACCESS_DENIED
```

**Solution:** Check username, password, and domain. Ensure the user has write permission on the share. For guest access, ensure the share allows anonymous connections.

### Protocol Negotiation Failed

```
NT_STATUS_INVALID_NETWORK_RESPONSE
```

**Solution:** Try lowering **Max Protocol** to `SMB2` or `NT1`. Some older NAS firmware doesn't support SMB3.

### Share Not Found

```
NT_STATUS_BAD_NETWORK_NAME
```

**Solution:** Verify the share name is correct. List available shares: `smbclient -L //server -U username`.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
