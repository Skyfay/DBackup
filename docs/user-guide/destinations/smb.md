# SMB / CIFS

Store backups on a Windows share, NAS, or any SMB/CIFS-compatible network storage.

## Configuration

::: info Credential Profile required
SMB requires a [Credential Profile](/user-guide/security/credential-profiles) of type `USERNAME_PASSWORD`. Create one in **Vault → Credentials** before saving the destination. For anonymous access, the credential profile username defaults to `guest` with no password.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **Address** | UNC share path, `//server/share` or `\\server\share`. The server is a DNS or NetBIOS name, an IPv4 address or an IPv6 address without brackets, like `//fd00::9/share`. In a tenant that blocks the local network it is a DNS name or an address | - | ✅ |
| **Login** | `USERNAME_PASSWORD` credential profile (username + password). The username cannot hold a `%` | - | ❌ |
| **Domain** | Windows domain / workgroup. Cannot hold a `%` | - | ❌ |
| **Highest SMB version** | Highest SMB protocol version to use | `SMB3` | ❌ |
| **Folder** | Subfolder within the share. The folder button beside it browses the share once the connection and its login are filled in | - | ❌ |

### Protocol Versions

| Protocol | Notes |
| :--- | :--- |
| `SMB3` | Default, recommended - encrypted transport |
| `SMB2` | Fallback for older NAS devices |
| `NT1` | SMB1 legacy - use only if required |

## Setup Guide

1. Create a `USERNAME_PASSWORD` credential profile in **Vault → Credentials** ([guide](/user-guide/security/credential-profiles))
2. Ensure the SMB share is accessible from the DBackup server
3. Create a dedicated user with write access to the share (recommended)
4. Go to **Connections** → **Destinations** → **New destination** → **SMB / CIFS**
5. Enter the **Address** in UNC format: `//hostname-or-ip/sharename`
6. Pick the credential profile under **Login** (or leave empty for anonymous access)
7. (Optional) Set **Domain** if authenticating against a Windows domain
8. (Optional) Set a **Folder** in the **Location** part for a subfolder within the share, or pick it with the folder button (📂)
9. Click **Test connection** to verify the connection

::: tip NAS Devices
Synology, QNAP, TrueNAS, and OpenMediaVault all support SMB shares. Create a dedicated share and user for backups in your NAS admin panel.
:::

## How It Works

- DBackup mounts the SMB share temporarily for each operation, then unmounts
- Files are written directly to the share - same behavior as local storage
- All credentials are stored AES-256-GCM encrypted in the database
- The password reaches `smbclient` and `rpcclient` in their `PASSWD` environment variable, never on their command line, where every user of the machine could read it in the process list
- `smbclient` must be available in the DBackup container (included in the default Docker image)
- The server is looked up the way Samba does by default, in DNS and `/etc/hosts` and by its NetBIOS name, so a NAS known only by its NetBIOS name works
- In a tenant the platform keeps off the local network, the server is looked up in DNS (and `/etc/hosts`) only, never by a NetBIOS broadcast, which the check of the tenant cannot see. A NAS known only by its NetBIOS name needs a DNS entry or its IP address there, see [Network](/user-guide/admin/tenants#network)

::: info Addresses and logins of a tenant without the local network
`smbclient` reads some spellings of a server otherwise than they look: `//nas#20/share` dials `nas`, and `rpcclient` takes `//ncacn_ip_tcp:10.0.0.9[135]/share` as a connection to `10.0.0.9`. An address like that, a port after a colon or brackets around an IPv6 address are refused, since `smbclient` never read them the way they look. In a tenant the platform keeps off the local network, a **Login** or **Domain** with `@`, like `backup@corp.example`, is refused as well, because `smbclient` then asks a Kerberos server of that realm, which it finds on its own. Enter the user alone and the domain in **Domain**.
:::

::: warning Names smbclient cannot take
`smbclient` takes its commands as one line that it splits at every semicolon, with each path in double quotes it never escapes. So a path or **Folder** holding a semicolon (`;`), a double quote (`"`) or a control character, like a line break, is refused before `smbclient` runs, and so is an address with one in its server, share or folders. A file or folder of a directory source with such a name is left out of the backup and named in the server log, a restored file with one is listed as failed, and a job name with one is refused on every destination, since the name becomes a folder. Windows allows a semicolon in names, so rename such files to have them backed up. A name a server lists with a `/` or `\` in it, or of dots alone, is no name of its folder and is left out and named the same way.

The username of the **Login** and the **Domain** cannot hold a `%`. `smbclient` and `rpcclient` read what follows a `%` in a login as its password, which would win over the password of the **Login**, so such a connection is refused on save and before `smbclient` runs.
:::

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
| A share name without spaces or quotes | `rpcclient` splits its command at whitespace and quotes, so a share like `//server/My Share` works for backups but not for shadow copies. A share or a server whose name starts with `-` is refused too, `rpcclient` would read it as an option |

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

**Solution:** Try lowering **Highest SMB version** to `SMB2` or `NT1`. Some older NAS firmware doesn't support SMB3.

### Share Not Found

```
NT_STATUS_BAD_NETWORK_NAME
```

**Solution:** Verify the share name is correct. List available shares: `smbclient -L //server -U username`.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Backups](/user-guide/features/backups)
