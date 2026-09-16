# Archive Format

Byte-level specification of the seekable archive format (manifest version 2) that DBackup writes for every backup job.

This document is the contract. The Recovery Kit's `dbackup-recover.js` is an independent
implementation of it, and your backups remain recoverable as long as this document and a
Node.js runtime exist - DBackup itself is not required.

::: info Which backups use this format
Every backup job writes a v2 archive, whether it backs up databases, directory sources or both. Each database is its own entry, so a single database can be restored or downloaded by byte range.

Backups written by earlier versions for jobs that backed up **only databases** use the older format: a single dump file, or a plain multi-database TAR (manifest version 1), compressed and encrypted as a whole. DBackup still restores and downloads them, and `dbackup-recover.js --decrypt` recovers them offline.
:::

## Design goals

| Goal | How the format achieves it |
| :--- | :--- |
| Restore one file or one database without downloading the backup | The archive is never compressed or encrypted as a whole, and the index records each entry's exact byte offset |
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

### Header sizes

Plain POSIX ustar headers, with one detail that matters if you write your own reader: an
entry of **8 GiB or more** does not fit the 11-digit octal size field, and is written in
GNU **base-256** form instead - the high bit of the field's first byte is set, and the
remaining bytes are the size big-endian. Reading such a field as octal yields zero, and a
reader that walks the archive by adding sizes then loses its place for every member that
follows. `tar` itself handles this; a hand-written parser has to.

### Member names

| | Unencrypted archive | Encrypted archive |
| :--- | :--- | :--- |
| Database dump | `databases/<name>.<ext>[.gz\|.br]` | `d/000001` |
| Directory file | `sources/<jobSourceId>/<path>[.gz\|.br]` | `d/000002` |
| Index | `index` | `index` |

Encrypted archives use opaque names on purpose. TAR headers are not encrypted, so real
paths there would publish the file listing next to the encrypted data and make the sealed
index pointless.

`<ext>` is `sql`, `dump` (PostgreSQL custom format), `archive` (MongoDB), `bak` (MSSQL), `bacpac` (Azure SQL Database), `fbk` (Firebird), `rdb` (Redis and Valkey) or `sqlite` (SQLite).

`<name>` is the database name with `/`, `\`, NUL and control characters replaced by `_`, and a leading `.` replaced by `_` as well. A Firebird alias such as `/data/shop.fdb` therefore becomes one flat member, and a name like `../x` can never climb out of the folder `tar -xf` extracts into. The index keeps the real name. Readers take the member name from the index `e` line rather than rebuilding it.

Redis and Valkey store one RDB snapshot holding every logical database of the server, so their archive has a single database entry named `dump`. A SQLite source is one file, and its entry is named after that file.

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
    "base": "full-000-2026-07-15.tar",    // predecessor filename, absent on the full
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
  // `files` includes symbolic links. `symlinks` is absent when the archive holds none.
  "counts": { "databases": 1, "directorySources": 2, "files": 48120, "entries": 96, "symlinks": 12 },
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
{"k":"deps","archives":["full-000-2026-07-15.tar","inc-003-2026-07-18.tar"]}

// Physical entry: one TAR member holding bytes
{"k":"e","n":1,"member":"d/000001","off":1536,"size":8421,"sealed":true,"comp":"GZIP","bundle":true}

// The same, but carried forward - its bytes live in another archive of the chain
{"k":"e","n":7,"a":"full-000-2026-07-15.tar","member":"d/000007","off":9216,"size":4096,"sealed":true}

// Database dump
{"k":"db","name":"appdb","format":"custom","n":1,"s":4211000,"h":"<sha256>"}

// Directory source
{"k":"d","src":"<jobSourceId>","label":"SFTP: /var/www","fileCount":48120,"totalSize":91234567,"excludePatterns":["*.log"]}

// Logical file
{"k":"f","src":"<jobSourceId>","p":"www/index.php","s":4211,"m":"2026-07-22T10:00:00.000Z","h":"<sha256>","n":2,"o":0,"l":4211}

// Symbolic link: no bytes anywhere, so no `n`
{"k":"f","src":"<jobSourceId>","p":"live/npm-10/cert.pem","s":0,"m":"2026-07-22T10:00:00.000Z","lnk":"../../archive/npm-10/cert1.pem"}
```

| Field | Meaning |
| :--- | :--- |
| `n` | Entry ordinal, **unique within its own archive**. Also the nonce counter. Absent on symbolic links. |
| `a` | Archive holding these bytes. Absent means this archive. Set on carried-forward content. |
| `off` | Byte offset of the member's payload within the archive |
| `size` | Bytes stored in the TAR, i.e. after compression and sealing |
| `sealed` | Present when the payload is encrypted |
| `comp` | Compression applied to the payload, absent when stored as-is |
| `bundle` | Present when the entry holds several small files |
| `p` / `s` / `m` / `h` | File path, uncompressed size, mtime, SHA-256 of the plaintext |
| `o` / `l` | Byte range within the *decompressed* entry. Only for bundled files. |
| `lnk` | Symbolic link target, raw and unresolved. Its presence marks the line as a link. |
| `name` / `format` | Database name as the server reported it, and its dump format (`sql`, `custom`, `archive`, `bak`, `fbk`, `bacpac`, `rdb`, `sqlite`) |
| `db` line `s` / `h` | Size of the dump as the adapter wrote it, and the SHA-256 of those bytes. `h` is absent on archives written before dumps carried a checksum. A reader verifies it before handing a dump to a database, since an unencrypted archive has no other integrity check. |

Separating physical entries (`e`) from logical files (`f`) is what makes bundling possible:
many `f` lines can point at one `e` line.

## Symbolic links

A link is stored as the link, never as a copy of what it points at. `lnk` holds the target
exactly as the source stored it - a relative target stays relative. Resolving it would be
wrong twice over: a relative target only means something from the link's own directory, and
following it would pull in bytes from outside the source that was asked for.

Three rules follow, and a reader has to implement all three:

1. **`lnk` present means `n` absent.** A link has no payload and no entry. Resolving one is
   the mistake to guard against - it is what turns a link into a failed restore.
2. **Unencrypted archives also carry a real TAR symlink member** (typeflag `2`, `linkname`,
   zero payload), so `tar -xf` alone produces a correct tree. Encrypted archives carry none:
   a target is a path, a TAR header is cleartext, and writing it there would publish user
   data next to the entries that exist to hide exactly that. Encrypted archives keep targets
   in the sealed index only.
3. **Create links last, after every regular file.** This is a security requirement, not a
   style preference. Path containment checks operate on strings and never consult the
   filesystem, so an archive holding `foo -> /etc/cron.d` followed by a file `foo/x` passes
   every check and still writes outside the output directory - the classic TAR symlink
   traversal. Writing all files before any link exists closes it regardless of what the
   targets say.

Links never take part in incremental carry-forward. They store no bytes, so there is nothing
to reference, and every snapshot restates its links in full.

`counts.symlinks` in the manifest reports how many the archive holds, so a reader that cannot
recreate them can still say how many it is dropping.

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
    full-000-2026-07-15.tar      + .index + .meta.json
    inc-001-2026-07-16.tar       + .index + .meta.json
    inc-002-2026-07-17.tar       + .index + .meta.json
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

## Compression is per entry

The manifest's `compression` field records what the job was configured with. **`comp` on the
index entry is what a reader has to follow**, and the two routinely disagree. Two rules take
individual entries out of compression even when the job asks for it:

- A dump the adapter already compressed itself, such as `pg_dump -Z`.
- A file whose extension names an already-compressed format - video, audio, images, archives,
  ZIP containers like `.docx` and `.apk`, web fonts, encrypted payloads. The list lives in
  `src/lib/incompressible-formats.ts`. Recompressing these costs a full temp-file round trip
  and the CPU with it, for a fraction of a percent.

The rule applies to standalone entries only. Small files stay in their bundle and the bundle
is compressed as a whole, since lifting one out would cost it a TAR header and an auth tag -
more than the compression saved on a file that size.

In an unencrypted archive the member name follows the entry: a stored file keeps its real
name, a compressed one gains `.gz` or `.br`. So a mixed archive extracts with plain `tar -xf`
and only the suffixed members need a decompressor.

This is not a format change. `comp` has been per entry since version 2, so an older reader -
including a Recovery Kit generated before this rule existed - handles a mixed archive without
any update.

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
node dbackup-recover.js --list    backup.tar
node dbackup-recover.js --extract backup.tar ./out 'www/**'
```

For an incremental chain, point the tool at the snapshot you want and keep the other
archives in the same folder - it resolves them itself and lists what it is missing:

```bash
node dbackup-recover.js --list ./chain-2026-07-15
```

**Unencrypted archives** need no tooling:

```bash
tar -xf backup.tar
# Members carrying .gz or .br are compressed streams, the rest are already the real file:
find . -name '*.gz' -exec gunzip {} +
```

## What an encrypted archive still reveals

Full disclosure of the residual leak:

- The **number of entries** and each one's **stored size**. Bundling blurs this for small
  files, but a large file's approximate size is visible. restic and borg leak the same.
  An entry stored uncompressed gives its exact plaintext size rather than an approximate
  one, since sealing adds a fixed 16 bytes. That only happens for formats which are already
  compressed, and for those a compressed entry gives the same figure to within a fraction of
  a percent anyway.
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
