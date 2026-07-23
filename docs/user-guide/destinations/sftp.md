# SFTP

Store backups on a remote server via SSH File Transfer Protocol. Supports password, private key, and SSH agent authentication.

## Configuration

::: info Credential Profile required
SFTP requires a [Credential Profile](/user-guide/security/credential-profiles) of type `SSH_KEY`. Create one in **Settings → Vault → Credentials** before saving the destination.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **Host** | Hostname or IP of the SFTP server | - | ✅ |
| **Port** | SSH port | `22` | ❌ |
| **Primary Credential** | `SSH_KEY` credential profile (username + key or password) | - | ✅ |
| **Path Prefix** | Remote directory for backups | - | ❌ |

### Authentication Methods (via `SSH_KEY` profile)

| Auth Type | Description |
| :--- | :--- |
| `password` | Username + password |
| `privateKey` | SSH private key (PEM format) |
| `agent` | Use the host's SSH agent (keys loaded via `ssh-add`) |

Select the auth type when creating the `SSH_KEY` credential profile in the Vault.

## Setup Guide

1. Create an `SSH_KEY` credential profile in **Settings → Vault → Credentials** ([guide](/user-guide/security/credential-profiles))
2. Ensure the target server has SSH/SFTP enabled
3. Create a dedicated user for backups (recommended):
   ```bash
   sudo useradd -m -s /bin/bash dbackup
   sudo mkdir -p /home/dbackup/backups
   sudo chown dbackup: /home/dbackup/backups
   ```
4. Go to **Connections** → **Backup Destinations** → **Add New** → **SFTP**
5. Enter Host and select the credential profile in the **Primary Credential** picker
6. (Optional) Set **Path Prefix** to the remote backup directory (e.g. `/home/dbackup/backups`)
7. Click **Test** to verify the connection

::: tip Private Key Format
Paste the entire PEM key content including the `-----BEGIN` and `-----END` lines when creating the credential profile. Supports RSA, ED25519, and ECDSA keys.
:::

## How It Works

- Files are uploaded via SFTP (SSH subsystem) - all transfers are encrypted in transit
- DBackup creates subdirectories per job within the Path Prefix automatically
- All credentials (passwords, private keys) are stored AES-256-GCM encrypted in the database

## Troubleshooting

### Connection Refused

```
connect ECONNREFUSED
```

**Solution:** Verify the host and port. Ensure the SSH service is running and the port is open in the firewall.

### Authentication Failed

```
All configured authentication methods failed
```

**Solution:** Check username/password or private key. For key auth, ensure the public key is in the server's `~/.ssh/authorized_keys` and file permissions are correct (`chmod 600`).

### Permission Denied on Write

```
EACCES: permission denied
```

**Solution:** Ensure the SSH user has write access to the target directory. Check ownership and file permissions on the remote server.

### Host Key Verification

```
Host key verification failed
```

**Solution:** DBackup accepts host keys automatically on first connection. If the server was reinstalled, the host key may have changed. This is expected after server reprovisioning.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
