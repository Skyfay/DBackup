# Storage Explorer

Browse, restore, download and manage the backups at your destinations, in one list of every backup or by destination.

## Overview

Open **Storage Explorer** in the sidebar. The tabs at the top switch between two lists:

| Tab | Shows |
| :--- | :--- |
| **Backups** | Every backup of every job. Each row is one run, with every destination that holds a copy of it. |
| **Destinations** | Every destination with how it is doing, and the details of a picked one under the list: its numbers, its size over time, its alerts and every job with backups there. |

The page remembers its filters and the picked destination in its address, so a link or a reload opens the same view. **Open backups** in the menu of a job on the Jobs page opens the list filtered to that job. Both tabs remember whether you last looked at the table or the timeline.

## Backups

The strip on top counts the backups the list shows, what they take up, the newest one, how many copies exist and how many passed their integrity check.

| Column | Shows |
| :--- | :--- |
| **Backup** | When the backup was made |
| **Job** | The job that made it, marked when the job was deleted |
| **Type** | Full, or Incremental with its place in the chain |
| **Started by** | Schedule, API with the key name, or By hand with the user |
| **Size** | The complete snapshot, with what the archive stores under it for an incremental |
| **Stored at** | Every destination that holds a copy |
| **Integrity** | Verified, Check failed or Not checked |

**Columns** switches columns on and off, moves them and picks a row height, like on the other lists. **What is inside** starts switched off. The switch next to the tabs shows the list as a table or as a timeline from md screens up, and a phone always gets the backups as cards.

A dot on every copy in **Stored at** tells whether its destination answers right now, from the connection check that runs every minute: green when it does, amber when it missed its last check, red with the word **offline** after three missed checks in a row. A restore or download of an offline copy fails, and hovering the copy says since when it has not answered and where the same backup lies. A clock marks a copy whose destination could not be listed lately, so its list is old.

A copy shows as **missing** when a destination of the job holds older backups of it but not this one. A destination added to the job later, or one whose retention keeps fewer backups, is not reported for the runs it never had. A destination the job no longer writes to, and every destination of a deleted job, only counts for the runs between its oldest and its newest backup of the job.

### Filters

The filters beside the search narrow the list. Each opens a list with a search, a checkbox per entry and the number of backups every entry would leave, and several entries can be picked. The box beside the search picks every entry the search shows, the foot tells how many are picked and **Clear** empties the filter, and a filter that holds something is framed in the color of filtering:

- **Job** lists the jobs in three groups: **Jobs**, the jobs that exist, **Deleted jobs**, jobs that are gone while their backups are still at a destination, and **Not from a job**, the config backups of DBackup itself and files that nothing links to a job. Type part of a name to find one among hundreds.
- **Destination** keeps the backups with a copy at the picked destinations, a missing one included.
- **Started by** lists **Schedule** under **System**, every person who started a run under **By hand** and every API key that started one under **API keys**.
- **State** keeps the backups with a missing copy, a failed check, no copy that answers right now, a lock, or of a deleted job. While nothing is picked, it counts in amber the backups with a missing copy and in red the ones with a failed check or no copy that answers.

The filters narrow each other. Entries without backups under the other filters wait at the end of a list under **No backups with the other filters** and cannot be picked.

A **Destination** filter also decides what the rest counts: the strip, the states, **Stored at** and the actions only look at the copies at the picked destinations. **A copy is missing** with **NAS Backups** picked lists the backups NAS Backups lacks.

### Timeline

The timeline of the switch next to the tabs shows every job by day, from md screens up: a row per job and a column per day, as many days as the screen has room for. A cell tells what a job made that day:

- a filled cell is a backup, with a number when there were several, **F** marks the full backup that starts a chain and an outline its incrementals
- amber marks a missing copy, red a failed check, and a dashed red cross a day whose scheduled runs did not start at all
- a striped bar stands for the days before the oldest backup a job still has, and for the days after the last backup of a deleted job

The row **Every job** on top counts the backups of each day, and the filters above narrow the timeline like the list.

The arrows page through the days, a screen at a time. The button with the dates opens a calendar to jump to a day, which then shows in the middle, and **Today** comes back. At today the arrow on the right adds the next 7 days with the runs the schedules plan, dashed, while today stays in view. Hovering a planned day tells whether it starts a new chain and which backups the retention of each destination removes after it.

The list below waits for a click. A day of a job lists its backups on that day, a date the backups of every job that day, and a job its backups in view. The pick shows in the toolbar of the list, and a click on it or a second click on the same cell hides the list again. Missed runs are looked for over the last 90 days, from the last change of the job on.

### Actions

Rows can be selected for **Lock**, **Unlock** and **Delete**, across jobs. Without a **Destination** filter they act on every copy of a backup, with one only on the copies at the picked destinations. The menu of a row works on the first copy in the upload order of the job, or on the copy at the picked destination.

::: tip Cleaning up after a deleted job
Pick **Job deleted**, select the backups with the box in the head of the table and delete them. With a **Destination** filter they go from that destination only.
:::

## Destinations

The strip shows how many destinations answer right now, what they store together, how much that grew in the last 7 days, their backups and the alerts that fire.

The table lists every destination with its status, what it stores, the share of its storage limit when that alert is on, the growth of the last 7 days, its backups, the jobs that write to it, how old its list is and its active alerts. **Type** and **State** filter it, the state being whether it answers, whether its list is old and whether an alert fires. The menu of a row offers **Show details**, **Open backups**, which lists its backups in the **Backups** tab, and **Check now**. Phones get a card per destination.

### Details of a destination

A click on a destination shows its details under the list, as wide as the page, and a second click hides them again:

- whether it answers, with **Open backups**, **Check now**, **Edit alerts** and **Open connection**, and a banner with the error when it does not
- what it stores, how that changed in the last 7 days, its backups, the newest one and how old its list is
- its size over the last 30 days, 90 days or year, measured with every storage refresh
- its **Alerts** for a usage spike, a storage limit and a missing backup, each off, all well or active. **Edit alerts** changes them and needs the permission to change settings

**Jobs with backups here** lists every job with backups at the destination: how many and how big, the newest, the other destinations that hold copies and what the retention there keeps. Its search and its **Type** and **State** filters find a job among many, the states being a deleted job, a missing copy, a failed check and locked backups. **Show backups** lists the backups of a job at this destination in the **Backups** tab.

### Backups of a deleted job

When a job is deleted, its backups stay. Retention no longer runs for them, since retention runs as part of a job, and a new job with the same name writes into the same folder but leaves them alone. The job keeps its row, marked **Job deleted**, with **Delete** for all of its backups at this destination after a confirmation. Locked ones are left out.

A deleted job leaves the lists once none of its backups are left: when they are deleted here or on the storage, or when the destination itself is deleted in DBackup, which drops its list with it. A destination that does not answer keeps showing its last list, marked with a clock, until it answers again.

### Timeline

The timeline of the switch next to the tabs shows every destination by day, from md screens up, as many days as the screen has room for:

- a filled cell counts the backups that arrived that day
- amber marks a day with a missing copy, and a red cross today at a destination that does not answer
- at today the arrow on the right adds the next 7 days with the backups the schedules plan, dashed, and scissors where the retention removes backups after them

The row **Every destination** on top counts the backups of each day. The arrows, the calendar and **Today** work like on the timeline of the backups. The list waits under the timeline, and a click on a destination or one of its days shows its details under it.

## Details

A click on a row opens the panel of that backup:

- **Restore**, **Download**, **Lock** and **Verify**, and the rest in the menu next to them, with the copy they read from. A copy whose destination answers right now goes first, and **Stored at** shows every copy with its state and **Check now** for one that is offline
- why a copy is missing: an upload that failed in a partial run, with **Open the run**
- for a backup of a deleted job, that it stays until you delete it
- **Its chain** for an incremental: the full and every incremental as boxes, the backups a restore reads, and which later incrementals build on it
- **Stored at** with the last check of every copy and a download per destination
- what is inside, the last integrity check, compression, encryption and the path

A backup that later incrementals build on can only be deleted together with them. Deleting it alone is refused, since they could no longer be restored.

## How current the list is

DBackup keeps a list of the files at every destination. Its own backups, deletions, locks and checks change the list at once. The **Pre-warm Storage Cache** system task compares it with the storage every hour.

The page never waits for a destination. It opens with the lists DBackup has, and lists a destination it has no list for, or only an old one, in the background. The backups show up as soon as the listing is done. A destination that did not answer keeps its last list and is left alone for five minutes before the page asks it again. One that the health check calls offline is left to the hourly task.

The button next to the tabs tells when the lists were last compared, or how many of them are up to date when some are not, like **4 of 9 up to date**. It turns into **Listing** while a listing runs. Its popover shows when each destination was last compared. One that is not up to date shows the date in amber, and hovering it tells why, like a failed listing or a destination that is offline. From six destinations on, it folds them into **Not up to date**, which opens first, and **Up to date**. The backups of a destination that is not up to date show as they were at its last list, with a clock on their chips. **Check now** compares the destinations again right away, even one that failed a moment ago.

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
