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

## Shadow copies (VSS)

Available when the SMB adapter is a **directory source**. Backing up a live share means
reading a tree that keeps changing: open files cannot be read, and files collected at the
start and at the end of a long run do not belong to the same moment. For media or documents
that rarely matters; for a share holding a running application - a file-based database, PST
files, VM images - it produces a backup that does not restore cleanly.

With the option on, DBackup asks the file server for a point-in-time snapshot
(**MS-FSRVP**, the same mechanism Synology Active Backup uses), reads the backup from that
snapshot, and releases it afterwards. No agent is installed on the server.

### Requirements

| Requirement | Note |
| :--- | :--- |
| Windows Server 2012 or newer | Or Samba 4.2+ configured as an FSRVP server |
| **File Server VSS Agent Service** | A role service, **not** installed by default |
| An account with backup privileges | Plain read access on the share is not enough |
| RPC reachable through the firewall | The request does not travel over the SMB share itself |

### Enabling it

The switch stays disabled until **Check availability** succeeds - the server is asked
directly, so a missing agent service or insufficient rights shows up while configuring
rather than during the first backup. The same check runs again when the adapter is saved,
so it cannot be bypassed through the API.

::: warning A job configured for shadow copies fails without one
If snapshots turn out to be unavailable at backup time - the agent service stopped, rights
revoked, the server replaced - the run **fails** instead of quietly backing up the live
share. A backup that claims point-in-time consistency and does not have it is worse than a
missing one, and the job's failure notification tells you about it.
:::

### Cleanup

The snapshot is released when the run ends, whether it succeeded, failed or was cancelled.
Should DBackup be killed outright, the leftover is detected and removed before the next
backup of that share - which matters, because the server refuses a new snapshot while an
old one is still open. `vssadmin list shadows` on the server shows what is currently held.

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
