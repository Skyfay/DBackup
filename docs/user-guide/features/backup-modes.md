# Backup Modes

Jobs with directory sources can store either a complete copy every run, or only what
changed since the last one.

## Full vs Incremental

| | Full (default) | Incremental |
| :--- | :--- | :--- |
| Each run stores | Everything | Only changed and new files |
| One backup file is | Complete on its own | Part of a chain in one folder |
| Storage for 7 daily copies of 60 GB | ~420 GB | ~66 GB |
| Losing one backup file costs | That one backup | Everything the chain built on it |

Incremental is **off by default** and only appears on jobs that have directory sources.

::: warning Database dumps are always full
An incremental archive contains **every database in full**, plus only the directory files
that changed. If your job is mostly a large database, incremental saves very little.
:::

## Enabling it

1. Open the job and go to **Options**.
2. Turn on **Incremental backups**.
3. Set **Full backup every N days** (default 7).
4. Optionally turn on **Detect changes by content**.

### Full backup every N days

Starts a fresh chain on this interval. It is the safety valve: a shorter interval uses more
storage but limits how many backups a single damaged archive can affect.

With the default of 7 and a daily schedule you get one full and six incrementals per week.

### Detect changes by content

By default a file counts as unchanged when its size and modification time are unchanged,
so unchanged files are never transferred at all.

Turn this on when the source has unreliable timestamps - clock skew, or copies that
preserve mtime. Every file is then read and compared by checksum. Unchanged files are still
not stored twice, but they are transferred, so you keep the storage saving and lose the
bandwidth saving.

## How chains are stored

Each chain gets its own folder, and the archive name says what it is:

```
plex/
  chain-2026-07-15T03-00-00/
    full-2026-07-15.tar
    inc-2026-07-16.tar
    inc-2026-07-17.tar
```

Copying "a backup" means copying the folder. This works in any file browser without
knowing anything about DBackup.

## Restoring

Every snapshot is a complete, restorable point in time - the Storage Explorer shows one row
per snapshot with its full size, not just what that archive stores. Restoring reads from
whichever archives of the chain hold the data, automatically.

On destinations that support ranged reads only the needed bytes are transferred. On the
others (SMB, Rsync) each referenced archive is fetched once. See
[Storage Explorer](/user-guide/features/storage-explorer#browse-files) for the full list.

Backups made without DBackup are restored the same way: point the
[Recovery Kit](/user-guide/security/recovery-kit) at the snapshot and keep the other
archives in the same folder.

## Retention

Retention still evaluates individual snapshots - `keepDaily: 7` means 7 days, not 7 chains.
A chain is only deleted once **every** one of its snapshots has expired.

The practical consequence: slightly more is kept than you asked for, because a chain
lingers until its newest member ages out. Locking any snapshot pins its whole chain.

## When DBackup falls back to a full backup

This is automatic and logged in the execution. It happens when:

- there is no previous backup to build on
- the configured interval has elapsed
- the previous backup's metadata or file index cannot be read
- a destination is missing part of the chain
- the encryption profile changed
- a directory source was added, removed or replaced
- a directory source's exclude patterns changed
- the chain's full backup failed its last integrity check

All of these mean the previous snapshot is no longer a trustworthy basis, so DBackup starts
over rather than building on it.

## Next Steps

- [Storage Explorer](/user-guide/features/storage-explorer) - browsing and restoring files
- [Retention Policies](/user-guide/features/templates) - configuring what is kept
- [Recovery Kit](/user-guide/security/recovery-kit) - restoring without DBackup
