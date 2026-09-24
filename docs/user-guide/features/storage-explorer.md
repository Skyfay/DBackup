# Storage Explorer

Browse, restore, download and manage the backups at your destinations, by job or by destination.

## Overview

Open **Storage Explorer** in the sidebar. The tabs at the top pick how the backups are shown:

| Tab | Shows |
| :--- | :--- |
| **Jobs** | The backups of one job. Each row is one run, with every destination that holds a copy of it. |
| **Destinations** | The backups at one destination, in a folder per job, plus its **History** and **Alerts**. |

The field next to the tabs picks the job or the destination and searches as you type. The page remembers what you picked in its address, so a link or a reload opens the same view.

The jobs list has three groups:

- **Jobs**: the jobs that exist
- **Deleted jobs**: jobs that are gone while their backups are still at a destination
- **Not from a job**: the config backups of DBackup itself, and files that nothing links to a job

::: tip Many jobs
With hundreds of jobs, type part of a name into the field. It filters jobs, deleted jobs and the other entries at once.
:::

## By job

The strip on top counts the backups of the job, what they take up, the newest one, how many copies exist and how many passed their integrity check.

| Column | Shows |
| :--- | :--- |
| **Backup** | When the backup was made |
| **Started by** | Schedule, API with the key name, or By hand with the user |
| **Type** | Full, or Incremental with its place in the chain, for jobs with incremental backups |
| **Size** | The complete snapshot, with what the archive stores under it for an incremental |
| **Stored at** | Every destination that holds a copy |
| **Integrity** | Verified, Check failed or Not checked |

A copy shows as **missing** when a destination of the job holds older backups of it but not this one. A destination added to the job later, or one whose retention keeps fewer backups, is not reported for the runs it never had. A destination the job no longer writes to, and every destination of a deleted job, only counts for the runs between its oldest and its newest backup of the job.

The quick filters beside the search show only locked backups, runs with a missing copy or runs with a failed check. For an incremental job the list is grouped by chain, the newest chain open.

Actions in this view work on the first copy in the upload order of the job. **Delete** removes the backup from every destination that holds it.

## By destination

The strip shows what the destination stores, how many backups it holds and from how many jobs, the newest backup, the locked ones and the integrity checks.

The switch beside the search shows the backups in one of two ways:

| View | Shows |
| :--- | :--- |
| **Folders** | One row per job, like the folders the jobs write into on the storage, with its number of backups, size, newest backup, the other destinations that hold copies and its integrity checks. A click opens the folder and lists its backups. |
| **All backups** | Every backup at the destination in one list with its job. Rows of different jobs can be selected together for **Lock**, **Unlock** and **Delete**. |

An open folder has **All folders** to go back and **Open in Jobs** to see the same job at every destination. Its list offers the same selection for the backups of that job. The **Also at** column names the other destinations that hold the same backup.

### Backups of a deleted job

When a job is deleted, its backups stay. Retention no longer runs for them, since retention runs as part of a job. Its folder is marked **Job deleted**, and inside it a note says so and offers to delete all of its backups at this destination. Locked ones are left out.

A deleted job leaves the list once none of its backups are left: when they are deleted here or on the storage, or when the destination itself is deleted in DBackup, which drops its list with it. A destination that does not answer keeps showing its last list, marked with a clock, until it answers again.

## Timeline

The switch next to the tabs shows a timeline above the list, from md screens up. It covers 7, 30 or 90 days:

- a point is one backup, a filled larger point the full backup of a chain, a ring an incremental
- a line joins the backups of one incremental chain
- a bar stands for a day with several backups, like an hourly job
- an amber ring marks a missing copy, a red point a failed check, a lock a locked backup

The list stays hidden under the timeline, since it would show the same backups. By job the timeline has one lane for the job, and a click on it lists its backups below. By destination it has one lane per job at that destination, and a click on a lane opens the folder of that job below. A second click hides the list again, and a click on a point opens that backup.

## Details

A click on a row opens the panel of that backup:

- **Restore**, **Download**, **Lock** and **Verify**, and the rest in the menu next to them
- why a copy is missing: an upload that failed in a partial run, with **Open the run**
- for a backup of a deleted job, that it stays until you delete it
- **Its chain** for an incremental: the full and every incremental as boxes, the backups a restore reads, and which later incrementals build on it
- **Stored at** with the last check of every copy and a download per destination
- what is inside, the last integrity check, compression, encryption and the path

A backup that later incrementals build on can only be deleted together with them. Deleting it alone is refused, since they could no longer be restored.

## How current the list is

DBackup keeps a list of the files at every destination. Its own backups, deletions, locks and checks change the list at once. The **Pre-warm Storage Cache** system task compares it with the storage every hour.

The page never waits for a destination. It opens with the lists DBackup has, and lists a destination it has no list for, or only an old one, in the background. The backups show up as soon as the listing is done. A destination that did not answer keeps its last list and is left alone for five minutes before the page asks it again. One that the health check calls offline is left to the hourly task.

The button next to the tabs tells when the list was last compared, and turns into **Listing** while a listing runs. Its popover shows every destination with the time of its list, and marks one that is offline or whose last listing failed, with the reason. Its backups show as they were at the last list, with a clock on their chips. **Check now** compares the destinations again right away, even one that failed a moment ago.

::: tip Changes outside DBackup
Backups copied into a destination by hand show up with the next comparison, found by their `.meta.json` sidecar. Files deleted by hand drop out the same way.
:::

## Actions

### Restore

**Restore** opens the restore page. For a backup with databases and directory sources, the menu asks first:

| Choice | Opens |
| :--- | :--- |
| **Restore everything** | Both halves, databases and files |
| **Restore databases only** | The database section, files hidden |
| **Restore files only** | The file trees, no database target needed |

See [Restore](/user-guide/features/restore) for the whole flow. Listing a backup's contents reads only a small index file stored next to it, and destinations with ranged reads restore without transferring the whole archive. Which ones support that is in [File & Folder Backups](/user-guide/features/file-backups).

::: warning Glacier / Deep Archive
Backups in S3 `GLACIER` or `DEEP_ARCHIVE` have **Restore** and **Download** disabled. Restore the object in the AWS Console first, then try again.
:::

### Download

The download entries depend on the backup. For a seekable archive:

- **Download Encrypted Archive** or **Download Archive (.tar)**: the stored archive as it is
- **Download Decrypted Dump** or **Download Dump**: for a backup of one database, that database as a plain dump
- **Download Database...**: for several databases, a list with a download and a wget / curl link per database
- **Download Contents**, **Download Decrypted Contents** or **Download Complete Snapshot**: everything in the backup as a `.tar.gz`, for an incremental assembled from its chain
- **wget / curl link**: a temporary link for a server

For a backup written by an earlier version, **Download Encrypted (.enc)** gives the raw file and **Download Decrypted** decrypts it without decompressing.

A wget / curl link works once and expires after 5 minutes:

```bash
wget -O "backup.sql.gz" "https://your-server/api/storage/public-download?token=..."
curl -o "backup.sql.gz" "https://your-server/api/storage/public-download?token=..."
```

### Verify integrity

**Verify** checks the stored file against the checksums in its sidecar. The result is written back and shows in the list. S3, Cloudflare R2, Hetzner, Google Drive and OneDrive verify with their native checksum API, other destinations download the file. See [Backup Verification](/user-guide/features/backup-verification).

### Lock and unlock

A locked backup is skipped by retention and cannot be deleted until it is unlocked. Locking any backup of a chain keeps the whole chain, see [Backup Modes](/user-guide/features/backup-modes).

### Delete

Delete removes the archive and its sidecars. It cannot be undone.

## File layout

Backups sit in a folder per job, incremental chains in a folder per chain:

```
/storage-root/
├── Shop nightly/
│   ├── Shop_nightly_2026-09-23_03-00-00.tar
│   ├── Shop_nightly_2026-09-23_03-00-00.tar.meta.json
│   └── Shop_nightly_2026-09-23_03-00-00.tar.index
└── Media sync/
    └── chain-2026-09-20T00-30-00/
        ├── full-000-Media_sync_2026-09-20.tar
        └── inc-001-Media_sync_2026-09-21.tar
```

The `.meta.json` sidecar holds the job, the source, the databases, compression, encryption, checksums and the lock. The explorer reads it to put the copies of one backup side by side, and to tell the backups of a deleted job from those of a new job with the same name.

## Troubleshooting

### A destination is missing its backups

**Solution:** Open the popover next to the tabs. It says whether the destination is being listed or why its last listing failed. Fix the connection on the Connections page, then use **Check now**.

### A copy shows as missing

**Solution:** Open the backup and read why. A partial run names the failed upload in its log. A copy deleted by hand stays missing, the next run makes a new backup.

### Backups show without a job

**Solution:** These files have no `.meta.json`, because they were copied by hand or written by an old version. They can still be restored and downloaded.

## Next Steps

- [Restore](/user-guide/features/restore) - restore a backup
- [Retention Policies](/user-guide/jobs/retention) - automatic cleanup
- [Backup Modes](/user-guide/features/backup-modes) - full and incremental chains
