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

An encryption profile is a key in the Vault. Keys live on the **Encryption** tab of the **Vault** page in the sidebar.

### The Encryption Tab

The numbers on top count the keys and how many are in use, the encrypted backups of all backups, backups whose key is missing, the keys that were never in a recovery kit and when the last kit was downloaded. The backups come from the listings the Backups page keeps of each destination, so a destination that was never listed is not counted.

Each key is a row with:

| Column | Shows |
| :--- | :--- |
| **Key** | Its name and description |
| **Key ID** | The first 8 characters of a hash of the key, see [Key ID](#key-id) |
| **Encrypts** | The jobs, and the config backup, that encrypt their new backups with it |
| **Protects** | How many backups were made with it, at how many destinations |
| **Recovery kit** | When it was last in a downloaded kit, or **Never downloaded** in amber |
| **Created** | When the key was made |

The chips beside the search show **All**, **In use** and **Never in a kit**. A click on a row opens a side panel with the jobs of the key, its backups per destination, its recovery kit and when it was made and last revealed, as far as the audit log still reaches. A right click on a row, or the button at its end, offers **Recovery kit**, **Reveal key**, **Edit** and **Delete**. Several selected keys get a recovery kit or are deleted together. A phone shows the keys as cards.

When backups at a destination name a key the Vault does not have, a banner above the list says how many and where. Import that key from their recovery kit to open them again.

### Key ID

The Key ID tells keys apart without showing one, like two installs that should hold the same key, or an imported key and the one it came from. It is the start of the SHA-256 of the 32 bytes of the key, so anyone holding a key can check it:

```bash
echo -n "<64 hex characters>" | xxd -r -p | sha256sum | cut -c1-8
```

### Create a Key

1. Click **New key**
2. Enter a name and, if it helps, a description
3. Click **Create key**

DBackup makes a random 256-bit key. The dialog then offers the recovery kit of the new key, which holds the key and the tool to open its backups without DBackup. **Later** skips it, and the list marks the key until a kit with it was downloaded.

### Reveal a Key

**Reveal key** shows the Key ID and the 64 hex characters of the key with a copy button. Every reveal is written to the audit log first, like a revealed credential.

::: danger Save Your Key
This key is the **only way** to decrypt your backups. A [recovery kit](/user-guide/security/recovery-kit) is the better way to keep it, since it holds the key together with the tool that uses it.
:::

### Import a Key

To restore access after a reinstall, or to open backups of another install:

1. Click **Import key**
2. Enter a name
3. Paste the 64 hex characters of the key, or drop a file from its recovery kit: `master.key`, a file from its `keys/` folder, or the whole `.zip`. A kit with several keys asks which one.
4. Check the Key ID under the field, then click **Import key**

A key the Vault holds already is refused with the name of the key that has it. Backups that name a key the Vault lacks open with an imported key that fits, the restore finds it by itself.

A key imported from a recovery kit remembers the ID it had in the install the kit came from, so the Vault counts the backups that name that ID under the imported key right away. A kit with a single key made by an older version does not name the ID. Then the Vault learns it the first time a restore, or the **Encryption Key Required** dialog of a backup, opens one of those backups with the key.

### Edit a Key

**Edit** changes the name and the description. The key itself never changes, for a new one create a key and pick it in the jobs.

Backups, jobs and Recovery Kits identify the key by the profile ID, so they keep working after a rename. A Recovery Kit downloaded earlier still lists the old name.

::: warning Config Backup Import
Importing a config backup matches encryption profiles by name. If the imported config backup contains a different profile with the same name as a local one, its jobs are linked to the local key.
:::

### Delete a Key

A key that a job or the config backup still encrypts with cannot be deleted. The dialog names them with a link to each, pick another key there first. Deleting it anyway would have stored the next backups of those jobs unencrypted.

A key that backups still need names them and asks you to confirm that a recovery kit keeps the key, or that the backups are no longer needed. A key that was never in a kit can get its kit right there. After the delete nobody can open those backups, DBackup neither.

## Using Encryption

### Enable on Job

1. Edit a backup job and open its **Encryption** part
2. Pick a key from the list, or make one with **New**
3. Save

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
