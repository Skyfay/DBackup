# Backup Verification

Detect corrupted or tampered backup files before you need to restore them.

## Why Verification Matters

A backup that silently corrupts mid-upload is worse than no backup at all - you only discover the problem at the worst possible moment, during a restore. Verification catches this early by comparing a cryptographic checksum of the backup file against the original value recorded immediately after the dump.

## How It Works

### Checksum Generation (at upload time)

Every backup file gets a SHA-256 checksum computed from the final processed file - after compression and encryption if enabled. For adapters that natively support MD5 (Google Drive), an MD5 checksum is computed in the same pass at no extra cost.

Both values are stored in the `.meta.json` sidecar file alongside the backup:

```json
{
  "checksum": "a3f1b2c4...",
  "checksumMd5": "d8e9f0a1...",
  "verification": {
    "verifiedAt": "2026-06-10T14:32:00Z",
    "passed": true,
    "trigger": "post-upload"
  }
}
```

### Verification Logic

When a verification is triggered, DBackup uses the best available method for each storage adapter:

| Adapter | Method | No Download Needed |
| :--- | :--- | :--- |
| **Local Filesystem** | Direct file hash via stream | Yes |
| **S3 / R2 / Hetzner** | `HeadObject` - reads SHA-256 from object metadata | Yes |
| **Google Drive** | `files.get` API - reads native MD5 field | Yes |
| **OneDrive** | Graph API - reads native SHA-256 hash | Yes |
| SFTP / FTP | Download + compute SHA-256 | No |
| SMB | Download + compute SHA-256 | No |
| WebDAV | Download + compute SHA-256 | No |
| Dropbox | Download + compute SHA-256 | No |
| Rsync | Download + compute SHA-256 | No |

For adapters without native checksum APIs, DBackup downloads the full file, recomputes the hash, and compares it against the stored value.

The result is written back into the `.meta.json` sidecar so it persists across sessions and appears immediately in the Storage Explorer without re-verifying.

## Triggering a Verification

### Manual Verification (on-demand)

In the **Storage Explorer**, open the menu at the end of a backup's row and pick **Verify integrity**, or click **Verify** in the panel a click on the row opens. A loading toast appears while the check runs, then the result is shown and the list updates.

The **Integrity** column shows the last result: **Verified**, **Check failed** or **Not checked**.

::: tip Re-verify anytime
You can verify a backup again at any time. The panel offers **Verify again** once a check has run.
:::

### Post-Upload Verification (automatic)

DBackup can verify each backup immediately after it finishes uploading. This is controlled by the `backup.postUploadVerify` system setting.

**Local filesystem destinations always verify**, regardless of this setting - the check is a direct file read with near-zero overhead.

For remote destinations (S3, Google Drive, SFTP, etc.), post-upload verification is **opt-in** and off by default. Enable it in **Settings - System** if you want automatic verification for all destinations.

::: warning Bandwidth for download-based adapters
For SFTP, FTP, SMB, WebDAV, Dropbox, and Rsync, automatic post-upload verification downloads the full backup file a second time to recompute the hash. For large backups on slow or metered connections this adds significant time and transfer costs. For S3, Google Drive, OneDrive, and local storage, verification has near-zero overhead and is safe to enable freely.
:::

### Scheduled Integrity Check

DBackup includes a **Scheduled Integrity Check** job that periodically verifies all backups across all storage destinations. It runs through each destination, reads the `.meta.json` sidecar for each backup file, and runs the same native-first verification logic as the manual check.

Results are written back to the sidecars as they complete, so the Storage Explorer badges stay up to date without any manual action.

The scheduler can be configured under **Settings - Scheduler** (cron expression). A weekly or monthly check on your full archive is a reasonable default for most setups.

::: info What counts as "scheduled"
The `trigger` field in `.meta.json` records how each check was triggered: `manual`, `post-upload`, or `scheduled`. This lets you distinguish between a fresh post-upload check and an older scheduled check in the metadata.
:::

## Interpreting Results

| Status | Meaning |
| :--- | :--- |
| **Verified (green)** | File matches its checksum - no corruption or tampering detected |
| **Failed (red)** | Hash mismatch - file may be corrupted or was modified after upload |
| **No checksum** | Backup predates checksum support - no baseline to compare against |
| **No metadata** | File has no `.meta.json` sidecar (manually placed file) |
| **-** (dash) | Never been verified |

A **Failed** result does not necessarily mean the backup is unrestorable - it means something changed since the original upload. Possible causes:

- Storage provider-level corruption (rare but documented on HDD-backed storage)
- Partial re-upload or file replacement
- Ransomware or accidental modification
- Network error during original upload that was not caught

If you see a failed check on a backup you intend to use for a restore, treat it as suspect and try an older backup if available.

## Limitations

- **Encrypted backups**: The checksum covers the encrypted file, not the plaintext. A passing integrity check confirms the encrypted bytes are intact, but does not guarantee the decryption key is still available.
- **Legacy backups**: Files uploaded before checksum support was added have no baseline. Verification will report "No checksum" and no comparison is possible.
- **Native SHA-256 on S3**: The SHA-256 is stored as S3 custom metadata (`dbackup-sha256`) during upload. If the object was copied or re-uploaded via external tools without preserving this metadata, native verification will fall back gracefully and report "unsupported" - which triggers a download-based check instead.

## Next Steps

- [Storage Explorer](/user-guide/features/storage-explorer) - Browse and manage backup files
- [Restore](/user-guide/features/restore) - Restore a backup to a database
- [Encryption](/user-guide/security/encryption) - Encrypt backup files at rest
