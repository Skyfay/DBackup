# Older Backup Formats

Every backup job now writes a [seekable archive](/developer-guide/reference/archive-format). Before that, jobs that backed up only databases wrote other formats, and DBackup still restores and downloads them. This page lists the code that exists only for those formats, so it can be removed deliberately once it is no longer needed.

## The formats

| Format | What it looks like | How it is recognised |
| :--- | :--- | :--- |
| Single dump file | `backup.sql`, `.sql.gz`, `.sql.br`, optionally `.enc`, compressed and encrypted as a whole | `.meta.json` without an `archive` block, or the file extension |
| Multi-database TAR | `backup.tar`, optionally `.gz` / `.br` / `.enc` as a whole, with `manifest.json` version 1 plus one dump per database | `isMultiDbTar()` inside each adapter's `restore()` |
| MSSQL TAR of `.bak` files | A TAR of `.bak` files without any manifest, still named `.bak` | `checkIfTarArchive()` in `mssql/restore.ts` |

## Finding the code

Every place is marked with a comment that starts with `LEGACY-FORMAT`:

```bash
grep -rn "LEGACY-FORMAT" src scripts
```

The tag in parentheses says what the code is and when it can go:

| Tag | Meaning | Remove when |
| :--- | :--- | :--- |
| `LEGACY-FORMAT(write)` | Code that produced the older formats. Nothing calls it anymore except tests. | Now. See [Stage 1](#stage-1-the-writer). |
| `LEGACY-FORMAT(read)` | Code that reads backups in the older formats. | Only once those backups no longer need restoring. See [Stage 2](#stage-2-the-reader). |
| `LEGACY-FORMAT(shared)` | Looks like it belongs to the older formats, but config backups still use whole-file compression and encryption. | Never together with the rest. See [What stays](#what-stays). |

Do not search for the word "legacy" alone. It also names unrelated things, such as the PostgreSQL compression setting, per-destination retention JSON and the MSSQL file transfer mode.

## Stage 1: the writer

This can be done at any time, it changes nothing for existing backups.

- [ ] Remove `dump()` from `DatabaseAdapter` in `src/lib/core/interfaces.ts` and from the adapter registrations in each `index.ts`.
- [ ] Delete `dump()` in `mysql`, `postgres`, `mongodb`, `firebird`, `mssql` and `azure-sql`, including the multi-database branches and the MSSQL TAR packer. Keep any per-database helper `dumpOne()` still calls.
- [ ] Move the body of `dump()` into `dumpOne()` for `sqlite` and `redis`, which currently wrap it.
- [ ] Remove the whole-file compression and encryption in `src/lib/runner/steps/03-upload.ts`, together with the `compression`, `encryption` and `multiDb` fields it writes into the metadata sidecar. The `isSeekableArchive` guard then has nothing left to guard.
- [ ] `createMultiDbTar()` and `TarFileEntry` stay until stage 2, because the tests for the reader build their fixtures with them. Move them into a test helper if stage 2 is far off.
- [ ] Rewrite or delete the tests that call `dump()`: `tests/unit/adapters/database/{mysql,postgres,mongodb,azure-sql,redis,sqlite}/dump.test.ts`, `tests/unit/adapters/mssql/dump.test.ts`, `tests/unit/adapters/database/firebird.test.ts`, the `.gz` and `.enc` cases in `tests/unit/runner/steps/03-upload.test.ts`, and `tests/integration/{backup,multidb-backup,ssh-mode}.test.ts`.
- [ ] Update `docs/developer-guide/adapters/database.md` and `src/lib/adapters/CLAUDE.md`, which still describe `dump()` as part of the interface.

## Stage 2: the reader

DBackup cannot tell whether anyone still holds a backup in an older format. Retention eventually deletes them from a destination, but locked backups, long retention policies and copies taken elsewhere can keep them around for years. Removing the reader turns those backups into files only the Recovery Kit can open, so it needs a release with a breaking change note that tells users to restore or re-create what they still need first.

- [ ] Restore pipeline: in `src/services/restore/pipeline.ts`, reject a backup without an `archive` block instead of downloading, decrypting and decompressing it. The metadata fields and the extension fallback marked there go too.
- [ ] Adapters: remove `restore()` from `DatabaseAdapter`. Delete it in `mysql`, `postgres`, `mongodb`, `firebird`, `mssql` and `azure-sql`, and move its body into `restoreOne()` for `sqlite` and `redis`, which currently wrap it.
- [ ] Analysis: remove `analyzeDump` from the interface and every `analyze.ts` (plus `analyzeDump` in `azure-sql/restore.ts`), and the metadata shortcuts and download fallback in `src/app/api/storage/[id]/analyze/route.ts`. Keep that route's fallback to the embedded index of a seekable archive whose sidecar is missing.
- [ ] TAR utilities: move `createTempDir`, `cleanupTempDir`, `shouldRestoreDatabase` and `getTargetDatabaseName` out of `common/tar-utils.ts`, then delete `common/tar-utils.ts` and `common/types.ts`.
- [ ] Metadata: remove `multiDb` from `BackupMetadata`.
- [ ] UI: remove `classicMode` from `restore-validation.ts` and what depends on it in `restore-client.tsx`.
- [ ] Recovery Kit: remove `unpackMultiDbTar()` from `scripts/dbackup-recover.js`. `--decrypt` stays for config backups.
- [ ] Tests: `tests/unit/services/restore-legacy-formats.test.ts`, `tests/unit/services/restore-pipeline*.test.ts`, the multi-database cases in the adapter `restore.test.ts` files, `tests/unit/adapters/database/{mysql,postgres,mongodb}/analyze.test.ts`, `tests/unit/adapters/database/common/tar-utils.test.ts`, the older-format cases in `tests/unit/lib/storage-analyze-route.test.ts` and `tests/unit/lib/recovery-kit-archive.test.ts`, and `tests/integration/{restore,multidb-restore}.test.ts`.
- [ ] Docs: the older-format passages in `docs/user-guide/security/recovery-kit.md`, `encryption.md` and `compression.md`, `docs/user-guide/features/{restore,storage-explorer,api-reference}.md`, `docs/user-guide/sources/{mssql,azure-sql,redis}.md`, the multi-database TAR section in `docs/developer-guide/adapters/database.md`, the info box at the top of the archive format reference, and this page.

## What stays

Config backups are written as a `.tar.gz`, encrypted as a whole with the same AES-256-GCM stream the older database backups used. Everything marked `LEGACY-FORMAT(shared)` serves them and has to survive both stages:

- `src/lib/crypto/stream.ts` and the compression streams
- `resolveDecryptionKey()` and `legacyHeadVerifier()` in `src/services/restore/smart-recovery.ts`, and the whole-file branch in `src/services/backup/key-recovery.ts`
- The whole-file decryption and the `.enc` zip branch in `storageService.downloadFile()`
- `compression` and `encryption` in `BackupMetadata`
- The modes for rows without a file index in `src/components/dashboard/storage/download/download-dialog.tsx`
- `restoreWholeFile()` and `--decrypt` in the Recovery Kit
