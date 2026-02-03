# Download Tokens

Temporary, single-use download tokens for CLI/API access to backup files.

## Overview

Download tokens allow users to download backup files via wget/curl without requiring browser cookies or session authentication. This is essential for:

- Redis restore workflows (RDB must be copied to server)
- Server-to-server backup transfers
- Scripted/automated downloads
- Air-gapped environments

## Architecture

```
User clicks "Generate Download Link"
              ↓
POST /api/storage/[id]/download-url
              ↓
generateDownloadToken(storageId, file, decrypt)
              ↓
Returns public URL with token
              ↓
wget/curl downloads via /api/storage/public-download?token=xxx
              ↓
consumeDownloadToken() validates & marks used
              ↓
File streamed (decrypted if requested)
```

## Token Lifecycle

### Generation

```typescript
// src/lib/download-tokens.ts
import { generateDownloadToken } from "@/lib/download-tokens";

// Parameters:
// - storageId: Storage adapter config ID
// - file: File path within storage
// - decrypt: Whether to decrypt on download (default: true)
const token = generateDownloadToken(storageId, filePath, decrypt);
```

### Token Data Structure

```typescript
interface DownloadToken {
    storageId: string;    // Storage adapter ID
    file: string;         // File path
    decrypt: boolean;     // Decrypt before streaming
    createdAt: number;    // Unix timestamp
    expiresAt: number;    // Unix timestamp (createdAt + 5 min)
    used: boolean;        // Single-use flag
}
```

### Consumption

```typescript
import { consumeDownloadToken, markTokenUsed } from "@/lib/download-tokens";

// Step 1: Validate token (does NOT mark as used yet)
const data = consumeDownloadToken(token);

if (!data) {
    // Token invalid, expired, or already used
    return error;
}

// Step 2: Perform the download operation
const result = await downloadFile(data.storageId, data.file, data.decrypt);

if (!result.success) {
    // Download failed - token is NOT consumed, can be retried
    return error;
}

// Step 3: Mark token as used ONLY after successful download
markTokenUsed(token);
```

**Important:** The two-step process (`consumeDownloadToken` + `markTokenUsed`) ensures that tokens are only invalidated after a successful operation. If the download fails, the user can retry with the same token.

## API Endpoints

### Generate Token

**POST** `/api/storage/[id]/download-url`

**Request:**
```json
{
    "file": "backups/mysql/backup_2024-01-15.sql.gz.enc",
    "decrypt": true
}
```

**Response:**
```json
{
    "success": true,
    "url": "https://example.com/api/storage/public-download?token=abc123...",
    "expiresIn": "5 minutes",
    "singleUse": true
}
```

**Requires:** `STORAGE.DOWNLOAD` permission

### Public Download

**GET** `/api/storage/public-download?token=xxx`

**No authentication required** - token provides authorization.

**Response:** File stream with appropriate headers

**Errors:**
- `400`: Missing token
- `401`: Invalid/expired token
- `500`: Download failed

## Security Features

### Time-Limited

Tokens expire after **5 minutes** (configurable via `TOKEN_TTL_MS`).

### Single-Use

Each token can only be used once. After `consumeDownloadToken()` is called:
- Token is marked as `used: true`
- Subsequent requests return `null`
- Token is cleaned up after 1 minute

### In-Memory Store

Tokens are stored in-memory (`Map<string, DownloadToken>`), which means:
- ✅ Fast lookups
- ✅ No database overhead
- ⚠️ Tokens lost on server restart (acceptable for 5-min TTL)

**Development Note:** The store uses `globalThis` to persist across Next.js hot reloads:

```typescript
// Survives hot module replacement in development
const globalForTokens = globalThis as unknown as {
    downloadTokenStore: Map<string, DownloadToken> | undefined;
};

if (!globalForTokens.downloadTokenStore) {
    globalForTokens.downloadTokenStore = new Map();
}

const tokenStore = globalForTokens.downloadTokenStore;
```

### Automatic Cleanup

Background interval removes expired/used tokens every 60 seconds:

```typescript
function cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, data] of tokenStore.entries()) {
        if (now > data.expiresAt ||
            (data.used && now > data.createdAt + CLEANUP_INTERVAL_MS)) {
            tokenStore.delete(token);
        }
    }
}
```

## UI Components

### DownloadLinkModal

Reusable modal for generating download links:

```tsx
import { DownloadLinkModal } from "@/components/dashboard/storage/download-link-modal";

<DownloadLinkModal
    open={isOpen}
    onOpenChange={setIsOpen}
    storageId="storage-config-id"
    file={{
        name: "backup.sql.gz.enc",
        path: "backups/backup.sql.gz.enc",
        size: 1048576,
        isEncrypted: true
    }}
/>
```

**Features:**
- Format selection (encrypted/decrypted) for encrypted files
- Live countdown timer showing time until expiration
- Copy-to-clipboard for wget and curl commands
- Regenerate button for new tokens

### Integration in Storage Explorer

The modal is integrated into the file actions dropdown:

```tsx
// src/components/dashboard/storage/cells/actions-cell.tsx
<DropdownMenuItem onClick={() => onGenerateLink(file)}>
    <Terminal className="mr-2 h-4 w-4" />
    <span>wget / curl Link</span>
</DropdownMenuItem>
```

## Usage Examples

### wget

```bash
# Download decrypted
wget -O "backup.sql.gz" "https://example.com/api/storage/public-download?token=abc..."

# Save to specific location
wget -O "/var/restore/dump.rdb" "https://..."
```

### curl

```bash
# Download decrypted
curl -o "backup.sql.gz" "https://example.com/api/storage/public-download?token=abc..."

# Follow redirects
curl -L -o "backup.sql.gz" "https://..."
```

### Scripted Usage

```bash
#!/bin/bash
# Request token via authenticated API
TOKEN=$(curl -s -X POST \
    -H "Cookie: session=..." \
    -H "Content-Type: application/json" \
    -d '{"file": "backup.sql.gz.enc", "decrypt": true}' \
    "https://example.com/api/storage/abc123/download-url" \
    | jq -r '.url')

# Download using token
wget -O backup.sql.gz "$TOKEN"
```

## Configuration

### Token TTL

Modify in `src/lib/download-tokens.ts`:

```typescript
// Token validity: 5 minutes (default)
const TOKEN_TTL_MS = 5 * 60 * 1000;
```

### Cleanup Interval

```typescript
// Cleanup interval: 1 minute (default)
const CLEANUP_INTERVAL_MS = 60 * 1000;
```

## Best Practices

1. **Use decrypt=true** for most cases - avoids manual decryption
2. **Generate links just before use** - minimize expiration risk
3. **Don't share links** - they're single-use for security
4. **Handle failures gracefully** - regenerate if download fails
5. **Use `-f` flag with curl** to fail on HTTP errors: `curl -f -o file.sql "..."`

## Adding to Other Components

To add download link generation to another part of the app:

### 1. Add State and Handler

```tsx
import { DownloadLinkModal } from "@/components/dashboard/storage/download-link-modal";

// State
const [downloadLinkFile, setDownloadLinkFile] = useState<FileInfo | null>(null);

// Handler
const handleGenerateLink = (file: FileInfo) => {
    setDownloadLinkFile(file);
};
```

### 2. Add Modal to JSX

```tsx
{downloadLinkFile && (
    <DownloadLinkModal
        open={!!downloadLinkFile}
        onOpenChange={(o) => { if (!o) setDownloadLinkFile(null); }}
        storageId={selectedStorageId}
        file={{
            name: downloadLinkFile.name,
            path: downloadLinkFile.path,
            size: downloadLinkFile.size,
            isEncrypted: downloadLinkFile.isEncrypted,
        }}
    />
)}
```

### 3. Add Trigger Button

```tsx
<DropdownMenuItem onClick={() => handleGenerateLink(file)}>
    <Terminal className="mr-2 h-4 w-4" />
    <span>wget / curl Link</span>
</DropdownMenuItem>
```

### Required Props

| Prop | Type | Description |
|------|------|-------------|
| `open` | `boolean` | Controls modal visibility |
| `onOpenChange` | `(open: boolean) => void` | Called when modal should close |
| `storageId` | `string` | Storage adapter config ID |
| `file.name` | `string` | Display filename |
| `file.path` | `string` | Full path within storage |
| `file.size` | `number` | File size in bytes |
| `file.isEncrypted` | `boolean` | Shows format selection if true |

## Related

- [Storage Explorer](/user-guide/features/storage-explorer) - User documentation
- [Redis Restore Wizard](/developer-guide/adapters/database#redis-restore-wizard) - Redis-specific implementation
- [Encryption](/developer-guide/core/encryption) - Backup encryption system
