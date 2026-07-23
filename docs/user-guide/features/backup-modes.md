# Backup Modes

Jobs with directory sources can store either a complete copy every run, or only what

New to file backups? [File & Folder Backups](/user-guide/features/file-backups) covers
setting one up and what each adapter supports.
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

An incremental run filters every file twice, and the two filters are not interchangeable:
**a checksum can only be taken from a file that was actually fetched.** So the checksum is
never the first filter - it only ever sees what the first filter let through.

With the switch **off**, out of 1000 files of which 3 really changed:

```
1000 files
   ↓  Filter 1: size and timestamp   (a guess - the file is not read)
   5 fetched                          (the 3 real ones + 2 that were only touched)
   ↓  Filter 2: checksum              (reads what was fetched)
   3 stored
```

The other 995 are never touched. Filter 2 never sees them, because there are no bytes to
checksum.

With the switch **on**:

```
1000 files
   ↓  Filter 1 skipped
1000 fetched
   ↓  Filter 2: checksum
   3 stored
```

**The same 3 files are stored either way.** Turning the switch on saves no extra storage -
it only changes how much crossed the wire, 5 files against 1000.

So the switch does not turn the checksum on. It turns the *guess* off. Filter 1 is what
makes an incremental backup cheap in the first place, and it is a guess made without
reading the file - which is exactly why it can be wrong.

**Leave it off** unless your source can change a file without changing its size *or* its
timestamp. Such a file is never fetched, so the checksum never gets to see it and the
backup keeps the old version. It needs both to hold at once, which is rare:

- FTP servers reporting timestamps only to the minute, where an edit lands within the same
  minute and keeps the file's length
- Files written back with their original timestamp preserved - `cp -p`, an archive
  extraction, or a sync tool restoring an older copy
- A source whose clock is corrected backwards

Any timestamp difference counts, in either direction, so a file replaced by an older copy
is picked up too.

**And it is not the only line of defence.** A full backup re-reads and re-checksums
everything, so anything the timestamp check missed is corrected at the next full at the
latest - which is what *Full backup every N days* controls.

The cost of turning it on is the full transfer on every run. On a large library over a slow
link that removes the main reason to use incremental backups in the first place.

## How chains are stored

Each chain gets its own folder, and the archive name says what it is:

```
plex/
  chain-2026-07-15T03-00-00/
    full-000-2026-07-15.tar
    inc-001-2026-07-16.tar
    inc-002-2026-07-17.tar
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
A chain is only deleted once **every** one of its snapshots has expired, so in practice
**a chain lives until its newest member ages out.** Locking any snapshot pins its whole
chain the same way.

### Worked example: keep 3, full every 7 days, daily schedule

| Day | New backup | Policy keeps | Old chain |
| :--- | :--- | :--- | :--- |
| 7 | A7 | A7, A6, A5 | pinned |
| 8 | **B1** - new chain | B1, A7, A6 | pinned via A7, A6 |
| 9 | B2 | B2, B1, A7 | pinned via A7 |
| 10 | B3 | B3, B2, B1 | **deleted - A1 to A7 all go** |

The old chain survives to day 10, not day 3. At the peak the destination holds nine
backups instead of three - one full plus its deltas, not nine full copies.

Worst case: `keepCount + (fullEveryDays - 1)` backups.

### With GFS this matters more

A weekly, monthly or yearly slot that lands in the middle of a chain pins the **whole**
chain for as long as that one snapshot is kept. With `monthly: 12` that can mean twelve
chains held in full, each a full plus its incrementals - roughly *number of slots x chain
length* instead of *number of slots*.

So the two settings pull in opposite directions: a **longer** full interval saves storage
under a simple count policy, but costs more under GFS, because every pinned slot drags a
longer chain along with it.

### Seeing it

The retention log names the backups that only survive because of their chain:

```
[NAS] Retention: 2 incremental chain(s) present - a chain is only deleted once all of its snapshots expire.
[NAS] Retention: 5 backup(s) past the policy are kept because their chain is still in use: full-000-2026-07-15.tar, inc-001-2026-07-16.tar, ...
```

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
