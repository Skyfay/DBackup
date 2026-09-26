# Download Tokens

Temporary, single-use links that download a backup, or part of one, without a session.

## Overview

A download link lets a host without a DBackup session fetch a backup with curl, wget or PowerShell. It is what the download dialog of the Storage Explorer and the Redis restore guide put into their commands, and what scripts use with an API key:

- Redis and Valkey restores, where the dump has to reach the Redis host
- Server-to-server transfers and scripted downloads
- Air-gapped or locked-down hosts that can only reach DBackup over HTTP

A link works for **one complete download within 5 minutes**. A download that breaks off hands it back, so the same command can run again.

## Architecture

```
Download dialog, "A server", Make the link
              ↓
POST /api/storage/[id]/download-url      (a pick is planned first, so a missing key shows in the dialog)
              ↓
generateLinkToken({ storageId, file, userId, decrypt, pick })
              ↓
Returns data.url, data.token, data.fileName
              ↓
curl / wget / PowerShell on another host: GET /api/storage/public-download?token=...
              ↓
claimLinkToken()   one request at a time
              ↓
A pick streams through openArchiveDownload(), a whole file through a temp file
              ↓
Last byte sent: markTokenUsed(token, host)     Broke off: releaseLinkToken(token)
              ↓
The dialog asks GET /api/storage/[id]/download-url?token=... every 3 seconds and shows "Fetched at"
```

## Tokens

All tokens live in `src/lib/auth/download-tokens.ts`, in memory.

```typescript
interface DownloadToken {
    storageId: string;
    file: string;
    decrypt: boolean;
    createdAt: number;
    expiresAt: number;       // createdAt + 5 minutes
    used: boolean;
    createdBy?: string;      // links: the user who made it, the only one who sees its status
    fetchedAt?: number;      // links: when the last byte left
    fetchedFrom?: string;    // links: the host, from x-forwarded-for or x-real-ip
    claimed?: boolean;       // links: a request is serving it right now
    database?: string;       // older callers: the one dump of a seekable archive
    pick?: {                 // links: dumps and folders of a seekable archive
        databases?: string[];
        selections?: { src: string; paths?: string[] }[];
        profileIdOverride?: string;
    };
    selection?: { ... };     // browser downloads of a pick, bound to the session
    localFile?: { ... };     // browser downloads prepared into a temp file, bound to the session
}
```

| Function | Purpose |
| :--- | :--- |
| `generateLinkToken(params)` | A public link with its maker. Returns `{ token, expiresAt }` |
| `claimLinkToken(token)` | Takes a link for one request, `null` when it ran out, is used up or is being served |
| `markTokenUsed(token, from?)` | Spends it once the last byte left, with the host |
| `releaseLinkToken(token)` | Hands it back after a transfer that broke off |
| `linkStatus(token, userId)` | `open`, `fetched` or `expired` for its maker, `null` for anyone else |
| `generateSelectionDownloadToken` | A browser download of a pick. Not spent on use, since a browser may retry or resume, and bound to the session instead |
| `generateFileDownloadToken` | A browser download prepared into a temp file first, bound to the session |

A pick streams the same way as a browser download of it: `openArchiveDownload()` reads each entry by byte range, decrypts it and packs it on the fly, one dump as it is, several as one tar.gz at gzip level 1. Nothing waits on the disk of the DBackup host, and the first byte leaves at once. A link for a whole file, the archive as stored or an older backup decrypted, still goes through a temp file.

## API Endpoints

### Make a link

**POST** `/api/storage/[id]/download-url`, with `storage:download`.

```json
{
    "file": "Shop nightly/Shop_nightly_2026-09-24.tar",
    "databases": ["billing"],
    "selections": [{ "src": "src-1" }],
    "profileIdOverride": "optional vault profile"
}
```

`decrypt: false` makes a link to the file as stored. `database` names the one dump for older callers. Without `databases` and `selections` the link is for the whole file.

```json
{
    "success": true,
    "data": { "url": "https://dbackup.example/api/storage/public-download?token=...", "token": "...", "expiresAt": 1790000000000, "fileName": "Shop_nightly_2026-09-24_2-items.tar.gz" },
    "url": "https://dbackup.example/api/storage/public-download?token=...",
    "expiresIn": "5 minutes",
    "singleUse": true
}
```

A pick is planned before the link exists, so a backup that needs a key answers `422` with `ENCRYPTION_KEY_REQUIRED` and the dialog asks for one.

### Ask whether a link was fetched

**GET** `/api/storage/[id]/download-url?token=...`, with `storage:download`.

```json
{ "success": true, "data": { "state": "fetched", "expiresAt": 1790000000000, "fetchedAt": 1789999994000, "fetchedFrom": "10.0.0.5" } }
```

Only the user who made the link gets its status. Anyone else, and a link that was already removed, gets `{ "state": "expired" }`.

### Public download

**GET** `/api/storage/public-download?token=...`, public on purpose. It serves only what a token names, and answers `401` for a link that is used up, ran out or is being served to another request.

## Security

- **Five minutes**: a link runs out after 5 minutes, fetched or not.
- **One complete download**: a link is spent once its last byte left. While a request serves it, a second request is turned away, so a leaked link cannot be fetched in parallel.
- **Status for its maker only**: a token seen in a log tells nobody else whether it was used.
- **In memory**: tokens live in `globalThis.downloadTokenStore`, survive hot reloads, and are lost on a restart. A single instance only.
- **Cleanup**: every minute, tokens past their expiry are removed. A used link stays until then, so its maker can still see when it was fetched. A prepared temp file that was never collected is deleted with its token.

## UI

- `download/download-dialog.tsx`: the download dialog of the Storage Explorer. It lists the databases and folders of a seekable backup to tick, and goes to this computer or to a command for a server.
- `download/use-download-link.ts`: makes a link for a pick, counts down its minutes and asks every 3 seconds whether it was fetched. The Redis restore guide uses it too.
- `download/link-line.tsx`: the line above a command that says whether its link works, ran out or was fetched.
- `download/download-model.ts`: the pick, its words and the command for each tool, free of React.

## Usage Examples

```bash
# curl keeps the name DBackup sends, -f fails instead of saving an error as the file
curl -fOJ "https://example.com/api/storage/public-download?token=abc..."

# wget does the same with --content-disposition
wget --content-disposition "https://example.com/api/storage/public-download?token=abc..."
```

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'https://example.com/api/storage/public-download?token=abc...' -OutFile 'Shop_nightly_2026-09-24_billing.sql'
```

With an API key:

```bash
URL=$(curl -s -X POST "${BASE_URL}/api/storage/${STORAGE_ID}/download-url" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"file\": \"${BACKUP}\", \"databases\": [\"billing\", \"shop\"]}" | jq -r '.data.url')
curl -fOJ "$URL"
```

## Related

- [Storage Explorer](/user-guide/features/storage-explorer) - User documentation
- [Redis restore guide](/developer-guide/adapters/database#redis-restore-guide) - Redis-specific implementation
- [Encryption](/developer-guide/advanced/encryption) - Backup encryption system
