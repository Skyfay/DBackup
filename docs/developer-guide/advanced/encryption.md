# Encryption Pipeline

DBackup uses a two-layer encryption architecture for maximum security of both stored credentials and backup files.

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   Layer 1: System                       │
│         ENCRYPTION_KEY (Environment Variable)           │
│                                                         │
│  Protects: Database credentials, SSO secrets,           │
│            Encryption Profile Master Keys               │
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                Layer 2: Backup Profiles                 │
│         User-created Encryption Profiles                │
│                                                         │
│  Protects: Actual backup files in storage               │
└────────────────────────────────────────────────────────┘
```

## Layer 1: System Encryption

### ENCRYPTION_KEY

- **Source**: Environment variable
- **Format**: 32-byte hex string (64 characters)
- **Algorithm**: AES-256-GCM

### What It Protects

- Database passwords (MySQL, PostgreSQL, etc.)
- S3 secret keys and credentials
- OIDC/SSO client secrets
- Encryption Profile master keys

### Implementation

```typescript
// src/lib/crypto/index.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

export function encrypt(plaintext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, "hex");
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex-encoded)
  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

export function decrypt(ciphertext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, "hex");
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final("utf8");
}
```

### Config Encryption

Automatically encrypt sensitive fields:

```typescript
const SENSITIVE_FIELDS = ["password", "secret", "secretKey", "privateKey"];

export function encryptConfig(config: Record<string, unknown>): Record<string, unknown> {
  const result = { ...config };

  for (const [key, value] of Object.entries(result)) {
    if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f))) {
      if (typeof value === "string" && value) {
        result[key] = encrypt(value);
      }
    }
  }

  return result;
}

export function decryptConfig(config: Record<string, unknown>): Record<string, unknown> {
  const result = { ...config };

  for (const [key, value] of Object.entries(result)) {
    if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f))) {
      if (typeof value === "string" && value.includes(":")) {
        try {
          result[key] = decrypt(value);
        } catch {
          // Not encrypted or different format
        }
      }
    }
  }

  return result;
}
```

## Layer 2: Encryption Profiles

### Concept

Users create "Encryption Profiles" in the Vault. Each profile has a unique master key used to encrypt backup files.

### Database Model

```prisma
model EncryptionProfile {
  id          String   @id @default(cuid())
  name        String
  description String?
  secretKey   String   // Master key (encrypted with ENCRYPTION_KEY)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### Key Generation

```typescript
// src/services/backup/encryption-service.ts
export async function createEncryptionProfile(name: string, description?: string) {
  // Generate a 32-byte random key and encrypt it with the system key before storage
  const encryptedMasterKey = encrypt(crypto.randomBytes(32).toString("hex"));

  return prisma.encryptionProfile.create({
    data: { name, description, secretKey: encryptedMasterKey },
    select: summaryFields, // everything but secretKey
  });
}

export async function getProfileMasterKey(profileId: string): Promise<Buffer> {
  const profile = await prisma.encryptionProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new Error(`Encryption profile not found: ${profileId}`);

  return Buffer.from(decrypt(profile.secretKey), "hex");
}
```

Every function of the service that returns profiles, the list included, selects `summaryFields` and returns an `EncryptionProfileSummary`. Their results reach the browser through the Server Actions, so `secretKey` stays out of them even in its encrypted form. The key only leaves the service through `getProfileMasterKey()` and `getDecryptedMasterKey()`, which read one profile by id for a backup, a restore, revealing the master key in the Vault or a recovery kit.

## Backup Encryption Pipeline

### Stream-Based Encryption

For efficient memory usage with large backups:

```typescript
// src/lib/crypto/stream.ts
import crypto from "crypto";
import { Transform } from "stream";

export interface EncryptionStreamResult {
  stream: Transform;
  getAuthTag: () => Buffer;
  iv: Buffer;
}

export function createEncryptionStream(key: Buffer): EncryptionStreamResult {
  const iv = crypto.randomBytes(16); // 16-byte IV for AES-256-GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  // getAuthTag() is only valid after the stream has ended (flush complete)
  return { stream: cipher, getAuthTag: () => cipher.getAuthTag(), iv };
}

export function createDecryptionStream(
  key: Buffer,
  iv: Buffer,
  authTag: Buffer
): Transform {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher;
}
```

::: warning Call `getAuthTag()` after stream end
`getAuthTag()` is only available after the cipher stream has fully flushed. Await `pipeline()` or the `finish` event before reading the auth tag.
:::

### Backup Flow

```
Database Dump
    │
    ▼
┌─────────────────┐
│   Dump Stream   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│   Compression   │ ──▶ │   .sql.gz       │
│   (Gzip/Brotli) │     │   .sql.br       │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│   Encryption    │ ──▶ │   .sql.gz.enc   │
│   (AES-256-GCM) │     │   .sql.br.enc   │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Storage Upload  │
└─────────────────┘
```

### Metadata File

Every encrypted backup has a sidecar `.meta.json`:

```json
{
  "jobId": "abc123",
  "jobName": "daily-mysql",
  "timestamp": "2024-01-15T10:30:00Z",
  "sourceAdapter": "mysql",
  "databases": ["myapp", "analytics"],
  "size": 52428800,
  "compression": "brotli",
  "encrypted": true,
  "encryptionProfileId": "profile-uuid",
  "iv": "a1b2c3d4e5f6...",
  "authTag": "f6e5d4c3b2a1...",
  "checksum": "sha256-hash-of-final-encrypted-file"
}
```

> **Note:** The `checksum` field (added in v0.9.5) contains the SHA-256 hash of the final backup file (after compression and encryption). It is used for post-upload verification, pre-restore verification, and periodic integrity checks. See [Runner Pipeline](/developer-guide/core/runner) for details.

## Restore Decryption

### Standard Flow

```typescript
async function decryptBackup(
  encryptedPath: string,
  metadata: BackupMetadata
): Promise<string> {
  // 1. Get encryption key
  const key = await EncryptionService.getDecryptedKey(
    metadata.encryptionProfileId!
  );

  // 2. Create decryption stream
  const decryptStream = createDecryptionStream(
    key,
    Buffer.from(metadata.iv!, "hex"),
    Buffer.from(metadata.authTag!, "hex")
  );

  // 3. Pipe through decryption
  const decryptedPath = encryptedPath.replace(".enc", "");

  await pipeline(
    createReadStream(encryptedPath),
    decryptStream,
    createWriteStream(decryptedPath)
  );

  return decryptedPath;
}
```

### Smart Recovery

If the encryption profile ID doesn't match (e.g., after reimporting a key), the system attempts automatic key discovery:

```typescript
async function smartRecovery(
  encryptedPath: string,
  metadata: BackupMetadata
): Promise<Buffer | null> {
  // Get all available profiles
  const profiles = await prisma.encryptionProfile.findMany();

  for (const profile of profiles) {
    try {
      const key = await EncryptionService.getDecryptedKey(profile.id);

      // Try to decrypt first 1KB
      const decryptStream = createDecryptionStream(
        key,
        Buffer.from(metadata.iv!, "hex"),
        Buffer.from(metadata.authTag!, "hex")
      );

      const sample = await readFirstBytes(encryptedPath, 1024);
      const decrypted = decryptStream.update(sample);

      // Validate: check for compression magic bytes or SQL content
      if (isValidContent(decrypted)) {
        console.log(`Smart Recovery: Matched profile "${profile.name}"`);
        return key;
      }
    } catch {
      // Try next profile
    }
  }

  return null;
}

function isValidContent(buffer: Buffer): boolean {
  // Check for Gzip magic bytes
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return true;

  // Check for Brotli (less reliable)
  // Check for SQL content (ASCII printable)
  const printableRatio = buffer
    .filter(b => b >= 32 && b <= 126)
    .length / buffer.length;

  return printableRatio > 0.9;
}
```

## Key Management

### Exporting Keys

Users can export keys for disaster recovery:

```typescript
// UI: Copy raw hex key
const rawKey = decrypt(profile.key); // 64-char hex string

// UI: Download Recovery Kit
const recoveryKit = {
  profileName: profile.name,
  masterKey: rawKey,
  createdAt: profile.createdAt,
  instructions: "Import this key to restore access to encrypted backups...",
};
```

### Importing Keys

```typescript
async function importKey(name: string, hexKey: string) {
  // Validate key format (64 hex chars = 32 bytes)
  if (!/^[a-f0-9]{64}$/i.test(hexKey)) {
    throw new Error("Invalid key format");
  }

  // Encrypt and store as new profile
  const encryptedKey = encrypt(hexKey);

  return prisma.encryptionProfile.create({
    data: { name, key: encryptedKey },
  });
}
```

## Security Best Practices

1. **Backup ENCRYPTION_KEY**: Store it securely outside the application
2. **Export Profile Keys**: Save master keys in a password manager
3. **Regular Restore Tests**: Verify encryption/decryption works
4. **Key Rotation**: Create new profiles periodically for new backups
5. **Enable Integrity Checks**: Activate the `system.integrity_check` system task for periodic SHA-256 checksum verification of all backups

## Checksum & Encryption Interaction

The SHA-256 checksum is always calculated on the **final** backup file - after both compression and encryption have been applied. This means:

- The checksum verifies the encrypted file, not the raw dump
- Integrity can be verified without decryption (no encryption key needed for checksum verification)
- The checksum is stored alongside encryption metadata (`iv`, `authTag`) in the `.meta.json` sidecar file
- During restore, the checksum is verified **before** decryption begins - preventing wasted processing on corrupted files

## Related Documentation

- [Security - Encryption](/user-guide/security/encryption)
- [Recovery Kit](/user-guide/security/recovery-kit)
- [Runner Pipeline](/developer-guide/core/runner)
