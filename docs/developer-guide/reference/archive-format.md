# Archive Format

Byte-level specification of the seekable archive format (manifest version 2) that DBackup
writes for jobs with directory sources.

This document is the contract. The Recovery Kit's `restore_archive.js` is an independent
implementation of it, and your backups remain recoverable as long as this document and a
Node.js runtime exist - DBackup itself is not required.

::: info Which backups use this format
Jobs with **directory sources** produce a v2 archive. Jobs that back up **only databases**
keep producing the older format: a single dump file, or a plain multi-database TAR
(manifest version 1), compressed and encrypted as a whole. Those are decrypted with
`decrypt_backup.js` instead.
:::

## Design goals

| Goal | How the format achieves it |
| :--- | :--- |
| Restore one file without downloading the backup | The archive is never compressed or encrypted as a whole, and the index records each entry's exact byte offset |
| Browse contents without downloading the backup | A small index sidecar sits next to the archive |
| Encrypted backups leak nothing | Member names are opaque, and the index (paths, sizes, checksums) is encrypted |
| Recoverable without DBackup | Documented format plus a standalone script, no server or database |
| Unencrypted backups need no tooling at all | Real paths as member names, so `tar -xf` works |

## Files

Three files are written per backup, to every destination:

```
<name>              The archive: a TAR, never compressed or encrypted as a whole
<name>.index        Index sidecar, byte-identical to the archive's own "index" member
<name>.meta.json    DBackup's backup metadata (cleartext)
```

The sidecar exists purely for access speed. Everything it contains is also inside the
archive, so losing it costs performance, never data.

## Archive layout

TAR members, in this order:

```
manifest.json     Cleartext. Contains no user data.
<data members>    [compress] -> [seal], one entry each
index             Sealed NDJSON index, always last
```

The index is last because it records byte offsets that only exist once the data members
have been written.

### Member names

| | Unencrypted archive | Encrypted archive |
| :--- | :--- | :--- |
| Database dump | `databases/<name>.<ext>[.gz\|.br]` | `d/000001` |
| Directory file | `sources/<jobSourceId>/<path>[.gz\|.br]` | `d/000002` |
| Index | `index` | `index` |

Encrypted archives use opaque names on purpose. TAR headers are not encrypted, so real
paths there would publish the file listing next to the encrypted data and make the sealed
index pointless.

`<ext>` is `sql`, `dump` (PostgreSQL custom format), `archive` (MongoDB), `bak` (MSSQL) or
`fbk` (Firebird).

## manifest.json

Always cleartext, always first, and deliberately free of user data - no paths, no database
names, no plaintext checksums. It carries only what a reader needs *before* it can decrypt
anything.

```jsonc
{
  "version": 2,
  "createdAt": "2026-07-22T03:00:00.000Z",
  "chain": {                          // absent on a standalone full backup
    "id": "<uuid>",                   // shared by the full and every incremental on it
    "type": "incremental",            // "full" | "incremental"
    "base": "full-2026-07-15.tar",    // predecessor filename, absent on the full
    "index": 3                        // position in the chain, the full is 0
  },
  "sourceType": "mysql",              // or "directory-only"
  "engineVersion": "8.0.32",
  "compression": "GZIP",              // "NONE" | "GZIP" | "BROTLI"
  "encryption": {                     // absent when unencrypted
    "algorithm": "aes-256-gcm",
    "kdfSalt": "<64 hex chars>",      // 32 bytes, not a secret
    "noncePrefix": "<8 hex chars>",   // 4 bytes, not a secret
    "profileId": "<uuid>"
  },
  "bundled": true,                    // small files packed together (encrypted archives only)
  "counts": { "databases": 1, "directorySources": 2, "files": 48120, "entries": 96 },
  "totalSize": 91234567,              // logical, uncompressed
  "indexMember": "index"
}
```

## Cryptography

### Key derivation

The encryption profile's master key is never used directly:

```
K_profile (32 bytes, from the encryption profile / master.key)
  |
  +- HKDF-SHA256(salt = kdfSalt, 32 bytes, fresh per archive)
       |
       +- info "dbackup/archive/v2/data"   -> K_data   (entry payloads)
       +- info "dbackup/archive/v2/index"  -> K_index  (the index)
```

Two reasons, both load-bearing:

- **Nonce safety.** Each entry is encrypted separately, so one backup can consume hundreds
  of thousands of nonces. NIST caps a single AES-GCM key at 2^32 invocations with random
  nonces, and nonce reuse under GCM is a total break - plaintext recovery plus forgery -
  not a gradual weakening.
- **Blast radius.** A leaked archive key exposes exactly one archive, never the profile.

### Nonces

```
nonce = noncePrefix (4 bytes) || uint64BE(ordinal)     // 12 bytes total
```

Ordinal `0` is reserved for the index. Data entries start at `1`. Because the key is fresh
per archive and the counter never repeats within one, `(key, nonce)` repetition is
impossible by construction rather than merely unlikely.

### Entry sealing

```
sealed = AES-256-GCM(K, nonce, plaintext) || authTag (16 bytes)
```

The tag is appended rather than stored elsewhere, so an entry is self-contained: a byte
offset and a length are enough to open it. GCM adds no padding, so:

```
sealedLength = plaintextLength + 16
```

Order of operations when writing an entry: **compress, then seal**. Reading reverses it.

## The index

NDJSON, gzipped, then sealed with `K_index` (ordinal `0`) when the archive is encrypted.

NDJSON rather than a JSON array because the index scales with file count: half a million
files is roughly 80 MB of JSON, and `JSON.parse` on that needs about a gigabyte of heap.
One object per line streams in constant memory.

### Line types

```jsonc
// Header, first line
{"k":"h","v":2,"createdAt":"2026-07-22T03:00:00.000Z","archive":"backup.tar"}

// Archives this snapshot needs besides its own (incremental chains only)
{"k":"deps","archives":["full-2026-07-15.tar","inc-2026-07-18.tar"]}

// Physical entry: one TAR member holding bytes
{"k":"e","n":1,"member":"d/000001","off":1536,"size":8421,"sealed":true,"comp":"GZIP","bundle":true}

// The same, but carried forward - its bytes live in another archive of the chain
{"k":"e","n":7,"a":"full-2026-07-15.tar","member":"d/000007","off":9216,"size":4096,"sealed":true}

// Database dump
{"k":"db","name":"appdb","format":"custom","n":1,"s":4211000}

// Directory source
{"k":"d","src":"<jobSourceId>","label":"SFTP: /var/www","fileCount":48120,"totalSize":91234567,"excludePatterns":["*.log"]}

// Logical file
{"k":"f","src":"<jobSourceId>","p":"www/index.php","s":4211,"m":"2026-07-22T10:00:00.000Z","h":"<sha256>","n":2,"o":0,"l":4211}
```

| Field | Meaning |
| :--- | :--- |
| `n` | Entry ordinal, **unique within its own archive**. Also the nonce counter. |
| `a` | Archive holding these bytes. Absent means this archive. Set on carried-forward content. |
| `off` | Byte offset of the member's payload within the archive |
| `size` | Bytes stored in the TAR, i.e. after compression and sealing |
| `sealed` | Present when the payload is encrypted |
| `comp` | Compression applied to the payload, absent when stored as-is |
| `bundle` | Present when the entry holds several small files |
| `p` / `s` / `m` / `h` | File path, uncompressed size, mtime, SHA-256 of the plaintext |
| `o` / `l` | Byte range within the *decompressed* entry. Only for bundled files. |

Separating physical entries (`e`) from logical files (`f`) is what makes bundling possible:
many `f` lines can point at one `e` line.

Because ordinals repeat between archives, an entry is addressed by the pair `(a, n)`, not
by `n` alone. The ordinal has to stay as it was in its own archive, since that is what
derives its nonce.

## Incremental chains

An incremental archive stores only the files that changed, but **its index still describes
the whole snapshot**. Unchanged files keep pointing at whichever archive already holds
them via `a`, and the entries they reference are copied into this index too. A restore
therefore resolves a snapshot in one lookup and never replays the chain.

Deleted files simply do not appear in the new index. There are no tombstones.

### Folder layout

A chain lives in its own folder, so copying "a backup" means copying a folder. This is
visible in any file browser without knowing anything about the format:

```
<job name>/
  chain-2026-07-15T03-00-00/
    full-2026-07-15.tar      + .index + .meta.json
    inc-2026-07-16.tar       + .index + .meta.json
    inc-2026-07-17.tar       + .index + .meta.json
```

Jobs in full-backup mode keep the flat `<job name>/<file>.tar` layout.

### Resolving a chain

1. Read the snapshot's index and its `deps` line.
2. Look for each named archive **in the same folder**. If one is missing, stop and report
   it by name - a partial restore is worse than a clear failure.
3. For each `f` line, take `a` to find the archive and `(a, n)` to find the entry.
4. Open the foreign archive and read **its own** manifest for the `kdfSalt` and
   `noncePrefix`. Each archive derives its own keys from the same profile key, so no extra
   secret is involved.

::: tip Work archive by archive
Group the files by `a` and finish one archive before opening the next. A reader that has to
download whole archives (because the storage backend cannot serve byte ranges) otherwise
ends up holding the entire chain on disk at once.
:::

### Database dumps are never incremental

Every archive stores its databases in full. An incremental archive is "every database
complete, plus only the directory files that changed", so `db` lines never carry an `a`.

::: warning The checksum belongs in the sealed index
`h` is a SHA-256 over plaintext, which is a confirmation oracle: anyone holding a candidate
file can prove it is in the backup, and public hash databases can identify contents without
the key. It is safe here only because the index is encrypted whenever the archive is.
:::

## Small-file bundling

Files at or below **64 KB** are packed into shared bundles of about **4 MB**, and the
bundle is compressed and sealed once. Without it, every small file costs a 512-byte TAR
header, a compression header whose dictionary restarts from nothing, and a 16-byte auth
tag - on a million 2 KB files that is hundreds of MB of pure overhead plus a ruined
compression ratio.

Random access survives: restoring one small file fetches ~4 MB instead of a few KB, which
is negligible next to the round trip.

**Bundling is applied only to encrypted archives.** A bundle has no single real path, so
enabling it for unencrypted archives would break the promise that `tar -xf` is enough.

## Reading an archive

To restore one file:

1. Read the first 512 bytes. `manifest.json` is always the first member, and its name always
   fits the ustar layout, so its payload starts at exactly offset 512.
2. Parse the manifest. If `encryption` is present, derive `K_data` and `K_index`.
3. Read the index - from the `.index` sidecar, or from the archive's last member.
4. Find the `f` line for the file, then the `e` line matching its `n`.
5. Fetch bytes `[off, off + size - 1]`. Over HTTP this is a single Range request.
6. Unseal with `K_data` and the entry's ordinal, then decompress per `comp`.
7. If `o` and `l` are set, slice that range out of the result.
8. Verify against `h`.

### Finding the index without a sidecar

The index is the last member before the end-of-archive trailer. Scan backwards from the end
of the file in 512-byte steps for a header block whose ustar magic is at offset 257 and
whose name is `index`. Walking forwards from the front also works but means reading every
header on a potentially enormous archive.

## Recovering without DBackup

**Encrypted archives** need the Recovery Kit (Settings → Vault → Download Recovery Kit):

```bash
node restore_archive.js --list    backup.tar <hex_key>
node restore_archive.js --extract backup.tar ./out <hex_key> 'www/**'
```

For an incremental chain, point the tool at the snapshot you want and keep the other
archives in the same folder - it resolves them itself and lists what it is missing:

```bash
node restore_archive.js --list ./chain-2026-07-15/inc-2026-07-17.tar <hex_key>
```

**Unencrypted archives** need no tooling:

```bash
tar -xf backup.tar
# If the job used compression, the extracted files are gzip/brotli streams:
find . -name '*.gz' -exec gunzip {} +
```

## What an encrypted archive still reveals

Full disclosure of the residual leak:

- The **number of entries** and each one's **stored size**. Bundling blurs this for small
  files, but a large file's approximate size is visible. restic and borg leak the same.
- The **archive's own size and timestamp**.
- Everything in `.meta.json`, which is cleartext by design - job name, source name and type,
  engine version, timestamps, and the crypto parameters. It contains no file paths or
  database names.

Not revealed: file paths, directory structure, database names, file checksums, mtimes, or
any content.

## Next Steps

- [Encryption](/user-guide/security/encryption) - how encryption profiles work
- [Recovery Kit](/user-guide/security/recovery-kit) - getting and using the offline tools
- [Restore](/user-guide/features/restore) - restoring through the UI
