# Configuration Backup (Meta-Backup)

The configuration backup is a copy of DBackup's own SQLite database, compressed and encrypted with a key of the Vault. A copy holds every table and every link, so no part of DBackup needs export or import code, and a table a later version adds is in it without a word.

## Overview

```
Live database ──VACUUM INTO──▶ Copy ──▶ without sign-ins, caches and (optionally) history
                                         + keys row ──▶ gzip ──▶ AES-256-GCM ──▶ Destination
```

### Core Concepts

1. **Complete by construction**: the copy is the database, templates, folders of file jobs, second factors and passkeys included
2. **Keys travel with it**: a row `configBackup.copyKeys` in `SystemSetting` of the copy holds `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, the version and the time. It only ever exists in a copy, and a restore removes it
3. **Always encrypted**: the task refuses to run without a key, since the file holds every login and both keys of the instance

## The Copy

`createConfigCopy({ includeHistory })` in `src/services/config/database-copy.ts`:

1. `createDatabaseSnapshot()` writes a consistent copy with `VACUUM INTO`, the same one Download database uses
2. `openCopy()` opens it with a second `PrismaClient`, apart from the live one
3. `DROPPED_TABLES` are emptied (sessions, verifications, caches), and without Include the history the `HISTORY_TABLES` too
4. The keys row is written, then `VACUUM` gives the freed space back

`runConfigBackup()` in `src/lib/runner/config-runner.ts` streams the copy through gzip and the encryption stream and uploads `config-backups/config_backup_<timestamp>.db.gz.enc`. Its `.meta.json` carries `kind: "database"`, `appVersion` and the usual `encryption` block. The retention keeps the newest files named `config_backup_*`, older JSON files included.

## Restore of a Copy

A restore has two steps, `src/services/config/restore-flow.ts`:

1. **Check**: `checkUploadedBackup()` or `checkStoredBackup()` decrypt and unpack the file into a temp file with `openBackupFile()`. `isDatabaseCopy()` reads the SQLite header, and `inspectDatabaseCopy()` runs `PRAGMA integrity_check`, compares `_prisma_migrations` with `prisma/migrations` so a copy of a newer version is refused, reads the keys row and counts what the copy holds. A copy without keys row, like a download of the database, is refused when its secrets do not open with the key of this instance. The checked file waits in `pending-restores.ts` for 30 minutes under a token bound to the user who checked it
2. **Apply**: `applyCheckedRestore()` refuses while a run is `Running`. `stageDatabaseRestore()` drops triggers and views, encrypts the secrets again when the keys row names other keys, removes the keys row and the sign-ins, writes an audit entry into the copy, lays it beside the live database as `restore-pending.db` and calls `restartSoon()`, which ends the process after the answer went out
3. **Swap**: `scripts/apply-pending-restore.js` runs before `prisma migrate deploy`, in `docker-entrypoint.sh` and in `pnpm dev`. It moves the live database with its `-wal`, `-shm` and `-journal` files aside as `dbackup.db.before-restore*` and renames the copy into place. On a failure it puts everything back and keeps the copy as `restore-failed-<time>.db`, so the next start does not try again

### Encrypting Again

`rekeyCopy()` in `copy-rekey.ts` runs when the keys of the copy differ from the ones of this instance. Every value DBackup encrypts has the form `iv:authTag:data` in hex, and AES-GCM opens only a value that really is one, so the copy is searched rather than listed: every `TEXT` column of every table, and every string inside a JSON value. Tables that never hold a secret are skipped for speed. Second factors are encrypted by better-auth with `BETTER_AUTH_SECRET` and go through `symmetricDecrypt` and `symmetricEncrypt`.

A new table needs nothing here. A table that can never hold a secret may join the skip list.

### Routes

| Route | Who | What |
|-------|-----|------|
| `POST /api/settings/config-backup/restore` | SuperAdmin session | Checks an uploaded file, up to the 10 MB the middleware passes |
| `POST /api/settings/config-backup/restore/destination` | SuperAdmin session | Checks a backup at a destination, read on the server |
| `POST /api/settings/config-backup/restore/apply` | SuperAdmin session | Restores a checked backup by its token |
| `POST /api/setup/restore`, `/api/setup/restore/apply` | Anyone while no account exists | The same on the sign-up page of a new instance |

`requireConfigRestorer()` in `src/lib/server/config-restore-guard.ts` guards the routes in Settings. A 413 answers an upload over `CONFIG_UPLOAD_MAX_BYTES` before its body is read, and a missing key the usual 422 of `keyRequiredResponse()`.

## Import of Older Files

Configuration backups of versions before the copy are JSON files, `config_backup_*.json.gz.enc`. A check recognises them by their content and the same two steps restore them, as a whole, without a restart. The Backups page still restores them in parts through `restoreFromStorageAction`.

`importConfiguration()` in `src/services/config/import.ts` restores the parts the caller picked in one transaction, in the order the links need. Each part lives in a module of its own:

| Module | Restores |
|--------|----------|
| `import-connections.ts` | Settings, saved logins, connections, encryption keys |
| `import-jobs.ts` | Jobs, their destinations and the channels they name |
| `import-users.ts` | Groups, users with their sign-ins, API keys, sign-in providers |
| `import-history.ts` | Runs, audit log, notifications and storage history |

`import-context.ts` holds what they share: the transaction, the maps from an ID of the file to the ID here, the IDs known to exist and the notes.

### Matching and Links

| Scenario | Resolution |
|----------|------------|
| Same ID exists | Update existing record |
| Same name exists under another ID | Update that record and keep its ID, every link follows through the ID maps |
| New ID | Create new record |
| Link to a record neither in the file nor here | Drop the link and add a note |

A foreign key must never stop a restore. Every link is checked before the write, and the record comes back without what is missing:

| Missing | What the restore does |
|---------|-----------------------|
| Retention policy of a job destination | `retentionPolicyId` null and `retention` keeps everything, so the default policy cannot remove backups |
| Naming template or schedule preset of a job | The link is null, the job uses the default names or its own `schedule` |
| Encryption key of a job | The key is null and the job paused, so it does not back up unencrypted |
| Database connection of a job | `sourceId` is null |
| Job or connection of a destination, user of an API key | The row is left out |
| Second factor of a user | `twoFactorEnabled` or `passkeyTwoFactor` is false |

`importConfiguration()` returns `{ notes }`, one sentence per kind of change. `restoreFromStorage()` writes them to the log of the run as warnings, and Restore from a file shows them in a toast. A table the export learns later needs its links checked the same way.

## Service Layer

The copy and its restore live in `src/services/config/`: `database-copy.ts`, `copy-inspect.ts`, `copy-rekey.ts`, `open-backup.ts`, `pending-restores.ts`, `restore-staging.ts` and `restore-flow.ts`. `config-service.ts` is the facade of the JSON files of older versions:

```typescript
class ConfigService {
  export(options: ExportOptions): Promise<AppConfigurationBackup>;
  parseBackupFile(filePath: string, metaFilePath?: string, rawKeyHex?: string): Promise<AppConfigurationBackup>;
  import(data: AppConfigurationBackup, strategy: "OVERWRITE", options?: RestoreOptions): Promise<ImportResult>;
  restoreFromStorage(storageConfigId: string, file: string, decryptionProfileId?: string, options?: RestoreOptions): Promise<string>;
}
```

`export()` writes such a JSON file, which no part of DBackup does any more.

## Security Considerations

### Who Restores

A restore writes users, groups, API keys and sign-in providers, so it could make anyone a SuperAdmin. The routes in Settings and `restoreFromStorageAction` check `settings:write` first and then refuse anyone who is no SuperAdmin, the routes also every API key. The routes of the sign-up page answer only while no account exists, the moment anyone who reaches the page may create the first account too. Taking a config backup stays with `settings:write`.

### The File

The file holds every secret of the instance and both of its keys, so its encryption key is as sensitive as the server itself. Keep the recovery kit of that key apart from the backups.
