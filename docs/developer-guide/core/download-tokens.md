# Download Tokens

Temporary, single-use links that download a backup, or part of one, without a session.

## Overview

A download link lets a host without a DBackup session fetch a backup with curl, wget or PowerShell. It is what the download dialog of the Backups page and the Redis restore guide put into their commands, and what scripts use with an API key:

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
generateLinkToken({ tenantId, storageId, file, userId, apiKeyId, decrypt, pick })
              ↓
Returns data.url, data.token, data.fileName
              ↓
curl / wget / PowerShell on another host: GET /api/storage/public-download?token=...
              ↓
claimLinkToken()   one request at a time
              ↓
makerMayDownload()   its maker, and the API key it was made with, may still download in its tenant
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
    kind?: "link";           // links: the only tokens the public download serves
    tenantId?: string;       // the tenant it was made in and is served in, which collects it
    apiKeyId?: string;       // the API key that made it, none for a session
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
    shared?: boolean;        // the dump of a shared database, collected through /api/shared/download only
}
```

| Function | Purpose |
| :--- | :--- |
| `generateLinkToken(params)` | A public link with its tenant and its maker, `kind: "link"`. Returns `{ token, expiresAt }` |
| `claimLinkToken(token)` | Takes a link for one request, `null` when it ran out, is used up or is being served, and for every token that is no link with a tenant and a maker |
| `markTokenUsed(token, from?)` | Spends it once the last byte left, with the host |
| `releaseLinkToken(token)` | Hands it back after a transfer that broke off |
| `linkStatus(token, userId)` | `open`, `fetched` or `expired` for its maker, `null` for anyone else |
| `generateSelectionDownloadToken` | A browser download of a pick. Not spent on use, since a browser may retry or resume, and bound to the session instead. Served in `runAsTenant` of its tenant |
| `generateFileDownloadToken` | A browser download prepared into a temp file first, bound to the session |
| `madeBy(token, maker)` | Whether a request is the one that made a token: the same tenant and the same API key, or none for a session. `consumeFileDownloadToken` and `consumeSelectionDownloadToken` take the maker of the request and read any other token as ran out, so the permission check of the request that collects it held for the tenant of the file |
| `generateSharedDownloadToken`, `consumeSharedDownloadToken` | The dump of a shared database a customer collects, bound to the user and the tenant that asked for it. The download of a destination never serves it |

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

**GET** `/api/storage/public-download?token=...`, public on purpose. It serves only a link, inside `runAsTenant` of the tenant it was made in, and answers `401` for a link that is used up, ran out or is being served to another request, and for any token that is no link. A link without a tenant or a maker is refused as well, it never falls back to the home tenant. No session checks a permission here, so `makerMayDownload` in `src/lib/auth/download-maker.ts` asks again whether its maker may still download in its tenant, and for a link made with an API key whether that key is on, not expired, allowed in its tenant and holds the right its owner still has. It answers `403` otherwise.

A [configuration backup](/developer-guide/advanced/config-backup#who-downloads-it) gets no link: `POST /download-url` refuses one with `403`, whoever asks, and the public download refuses one again before it reads a byte.

### Shared download

**GET** `/api/shared/download?token=...`, with `storage:download`. A customer collects the dump of a [shared database](/user-guide/admin/shared-databases) here, which `prepareSharedDownload` in `src/services/tenant/shared-databases.ts` pulled out of the backup into a temp file. The address carries the token alone and never names the destination of the server's tenant. The token works once, for five minutes, for the user and the tenant that asked for it, and one that does not fit answers `410`.

## Security

- **Five minutes**: a link runs out after 5 minutes, fetched or not.
- **One complete download**: a link is spent once its last byte left. While a request serves it, a second request is turned away, so a leaked link cannot be fetched in parallel.
- **Status for its maker only**: a token seen in a log tells nobody else whether it was used.
- **In memory**: tokens live in `globalThis.downloadTokenStore`, survive hot reloads, and are lost on a restart. A single instance only.
- **Cleanup**: every minute, tokens past their expiry are removed. A used link stays until then, so its maker can still see when it was fetched. A prepared temp file that was never collected is deleted with its token.

## UI

- `download/download-dialog.tsx`: the download dialog of the Backups page. It lists the databases and folders of a seekable backup to tick, and goes to this computer or to a command for a server.
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

- [Backups](/user-guide/features/backups) - User documentation
- [Redis restore guide](/developer-guide/adapters/database#redis-restore-guide) - Redis-specific implementation
- [Encryption](/developer-guide/advanced/encryption) - Backup encryption system
