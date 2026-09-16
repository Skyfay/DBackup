# Encryption Vault

Protect your backups with AES-256-GCM encryption.

> The Vault page hosts two tabs: **Encryption** (covered here) and
> **Credentials** (see [Credential Profiles](/user-guide/security/credential-profiles)).
> This page describes the Encryption tab only.

## Overview

DBackup uses a **two-layer encryption architecture**:

1. **System Encryption**: Protects credentials stored in the database
2. **Backup Encryption**: Protects backup files using Encryption Profiles

## How It Works

```
Database → Dump → Compress → Encrypt → Upload
                              ↑
                    Encryption Profile Key
```

Each backup is encrypted with:
- **Algorithm**: AES-256-GCM
- **Key**: 256-bit from Encryption Profile
- **IV**: Unique random value per backup
- **Auth Tag**: Integrity verification

## Encryption Profiles

Profiles are managed in **Settings > Vault**.

### Create a Profile

1. Go to **Settings** → **Vault**
2. Click **Create Profile**
3. Enter a descriptive name
4. Click **Create**

The system generates a secure 256-bit key.

### View Profile Key

After creation:
1. Click on the profile
2. Click **Show Key**
3. Copy the 64-character hex string

::: danger Save Your Key
This key is the **only way** to decrypt your backups. Store it securely in a password manager!
:::

### Import a Key

To restore access after reinstallation:
1. Click **Import Key**
2. Enter a name
3. Paste the 64-character hex key
4. Click **Import**

## Using Encryption

### Enable on Job

1. Edit a backup job
2. Enable **Encryption**
3. Select an Encryption Profile
4. Save

All future backups will be encrypted.

### Encrypted Backup Files

Every backup is a seekable archive that encrypts each database dump and each file as a separate entry, so one entry can be read without decrypting the rest. The archive keeps its `.tar` name, and the encryption parameters are stored inside it and in its `.meta.json`:
```
backup_2024-01-15.tar
backup_2024-01-15.tar.index
backup_2024-01-15.tar.meta.json
```

The layout is specified in the [Archive Format reference](/developer-guide/reference/archive-format).

Backups written by earlier versions for database-only jobs are encrypted as a whole and carry the extension `.enc`:
```
backup_2024-01-15.sql.gz.enc
backup_2024-01-15.sql.gz.enc.meta.json
```

Their `.meta.json` file contains:
```json
{
  "encryption": {
    "enabled": true,
    "profileId": "uuid-of-profile",
    "iv": "hex-encoded-iv",
    "authTag": "hex-encoded-auth-tag"
  },
  "compression": "GZIP"
}
```

## System Encryption

The `ENCRYPTION_KEY` environment variable encrypts:
- Database passwords
- API keys and secrets
- Encryption Profile master keys

### Generate Key

```bash
openssl rand -hex 32
```

### Store Securely

```bash
# .env file
ENCRYPTION_KEY=a1b2c3d4e5f6...64-characters...
```

::: warning Critical
If you lose `ENCRYPTION_KEY`, you cannot decrypt stored credentials or backup keys!
:::

## Security Architecture

```
┌─────────────────────────────────────────┐
│           Backup File (.enc)            │
│  ┌─────────────────────────────────┐    │
│  │    Encrypted with Profile Key    │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
                    ↑
                    │
┌─────────────────────────────────────────┐
│        Encryption Profile (DB)          │
│  ┌─────────────────────────────────┐    │
│  │   Profile Key (256-bit)          │    │
│  │   Encrypted with ENCRYPTION_KEY  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
                    ↑
                    │
┌─────────────────────────────────────────┐
│        ENCRYPTION_KEY (env var)         │
│         32-byte hex string              │
└─────────────────────────────────────────┘
```

## Decryption

### Automatic (Restore)

When restoring through DBackup:
1. System reads `.meta.json`
2. Looks up profile by ID
3. Decrypts profile key
4. Decrypts backup stream
5. Restores to database

### Smart Key Discovery

If profile ID doesn't match (e.g., after key import):
1. System tries imported keys
2. Validates by checking decrypted content
3. Uses matching key automatically

### Manual (Recovery Kit)

If DBackup is unavailable:
1. Download Recovery Kit from profile
2. Use included script with backup file
3. Decrypt without DBackup

## Recovery Kit

Each profile can generate a Recovery Kit:

1. Go to **Vault**
2. Click profile
3. Click **Download Recovery Kit**

The kit contains:
- Your encryption key
- Decryption script (Node.js)
- Instructions

### Using the Recovery Kit

```bash
# Extract the kit
unzip recovery-kit.zip

# Decrypt a backup
node decrypt.js backup.sql.gz.enc

# Output: backup.sql.gz
```

## Best Practices

### Key Management

1. **Generate strong keys** (use built-in generator)
2. **Store keys in password manager** (1Password, Bitwarden)
3. **Download Recovery Kit** immediately after creation
4. **Test decryption** before relying on backups

### Multiple Profiles

Create separate profiles for:
- Different environments (prod/staging)
- Different compliance requirements
- Key rotation purposes

### Regular Key Rotation

1. Create new profile
2. Update jobs to use new profile
3. Keep old profile until old backups expire
4. Delete old profile

### Disaster Recovery

Prepare for worst case:
1. Store keys in multiple secure locations
2. Document recovery procedures
3. Test restore from encrypted backup
4. Keep Recovery Kit with offsite backups

## Troubleshooting

### Cannot Decrypt Backup

**Causes**:
- Wrong encryption profile
- Key was deleted
- Backup corrupted

**Solutions**:
1. Verify correct profile ID in `.meta.json`
2. Try importing the key again
3. Use Recovery Kit if available

### Profile Not Found

**Cause**: Profile was deleted or ID mismatch

**Solutions**:
1. Import the key as new profile
2. Smart Recovery will find matching key
3. Use Recovery Kit manually

### Corrupted Backup

**Cause**: Transfer error or storage issue

**Signs**:
- Auth tag verification fails
- Decryption produces garbage

**Solutions**:
1. Re-download from storage
2. Check storage integrity
3. Use older backup if available

## Algorithm Details

### AES-256-GCM

- **Block cipher**: AES (Advanced Encryption Standard)
- **Key size**: 256 bits
- **Mode**: GCM (Galois/Counter Mode)
- **Benefits**: Authenticated encryption (confidentiality + integrity)

### Why GCM?

- Detects tampering (auth tag)
- Parallelizable encryption
- No padding oracle attacks
- Industry standard

### IV (Initialization Vector)

- 12 bytes (96 bits)
- Randomly generated per backup
- Stored in metadata file
- Never reused with same key

## Compliance

Encryption helps meet:
- **GDPR**: Technical measures for data protection
- **HIPAA**: Encryption of PHI
- **PCI-DSS**: Encryption of cardholder data
- **SOX**: Protection of financial data

## Next Steps

- [Recovery Kit](/user-guide/security/recovery-kit) - Emergency decryption
- [Compression](/user-guide/security/compression) - Reduce backup size
- [Creating Jobs](/user-guide/jobs/) - Configure encrypted backups
