# Encryption Key

The `ENCRYPTION_KEY` protects all sensitive credentials stored in DBackup's database.

## What It Protects

The `ENCRYPTION_KEY` is a **system-level key** that encrypts sensitive data at rest inside DBackup's SQLite database. This includes:

- Database source passwords (MySQL, PostgreSQL, MongoDB, etc.)
- Storage destination credentials (S3 secret keys, SFTP passwords, OAuth tokens)
- SSO provider client secrets
- API key hashes
- Encryption Profile keys (used for backup file encryption)

::: info Not the same as Encryption Profiles
The `ENCRYPTION_KEY` protects **credentials in the database**. [Encryption Profiles](/user-guide/security/encryption) protect **backup files**. These are two separate layers.
:::

## Generating a Key

```bash
openssl rand -hex 32
```

This produces a 64-character hex string (256-bit key). Set it as an environment variable:

```bash
ENCRYPTION_KEY="a3f8c1d2e4b5..."
```

::: danger Store it securely
Keep this key in a password manager or secrets vault (e.g., HashiCorp Vault, Bitwarden, 1Password). Without it, all encrypted data in the database becomes permanently inaccessible.
:::

## What Happens If You Lose the Key

If you start DBackup with a **different** `ENCRYPTION_KEY` than the one used when data was stored, all encrypted fields fail to decrypt. The practical result:

| What breaks | Effect |
| :--- | :--- |
| Source credentials | Connection tests fail, backups cannot run |
| Destination credentials | Uploads fail, storage explorer is inaccessible |
| OAuth tokens (Google Drive, Dropbox, etc.) | Re-authorization required |
| SSO client secrets | SSO login stops working |
| Encryption Profile keys | Existing encrypted backups **cannot be restored** |

DBackup will **not crash** - it starts normally. Errors only surface when a feature tries to use an encrypted value.

## Restoring After a Key Loss

There is no automatic recovery - AES-256-GCM encryption cannot be reversed without the correct key.

**Options:**

1. **Restore the original key** - If you have the key somewhere (password manager, old `.env` file, CI/CD secret), set it back. Everything works again immediately.

2. **Re-enter all credentials manually** - If the key is truly lost:
   - Delete and recreate all Sources and Destinations (re-enter passwords)
   - Re-authorize OAuth destinations (Google Drive, Dropbox, OneDrive)
   - Re-configure SSO providers
   - Recreate Encryption Profiles - **note:** existing backup files encrypted with old profiles cannot be decrypted

3. **Reset the database** - If starting fresh is acceptable, delete `dbackup.db` and start over with a new key.

## Using a Database From a Different Installation

If you restore a `dbackup.db` file from a backup or another server, you **must also use the same `ENCRYPTION_KEY`** that was set when that database was created. The key is not stored inside the database file - it must be provided separately.

Mismatched key + database = all credentials broken. The fix is to set the correct key for that database.

## Key Rotation

DBackup does not currently support in-place key rotation (re-encrypting all data with a new key). To rotate:

1. Back up your configuration via **Settings → Configuration backup**
2. Spin up a fresh instance with a new `ENCRYPTION_KEY`
3. Re-import the config - credentials will need to be re-entered manually since they were encrypted with the old key

## Next Steps

- [Encryption Vault](/user-guide/security/encryption) - Encrypt backup files with Encryption Profiles
- [Recovery Kit](/user-guide/security/recovery-kit) - Offline decryption for encrypted backup files
- [System Backup](/user-guide/features/system-backup) - Back up your DBackup configuration
