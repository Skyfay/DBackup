# Backup Jobs

Backup jobs are the core of DBackup. They connect a database, folders or both to one or more storage destinations and define when and how backups should run.

## Overview

A job defines:
- **What** to back up (a database, folders from storage connections, or both)
- **Where** to store it (one or more destinations)
- **When** to run (schedule)
- **How** to process (compression, encryption)
- **How long** to keep (retention per destination)

## The Jobs Page

**Jobs** in the sidebar lists every job with how it is doing:

| Column | What it shows |
| :--- | :--- |
| **Job** | The name and the schedule in words, like "Every day at 03:00", with the preset it follows |
| **Last run** | Done, Partial, Failed or Running, and when it ran and how long it took. A failed run shows its error, a running one how far it got |
| **Last 12 runs** | One bar per run, the newest on the right |
| **What goes where** | The source and the destinations, with the encryption key and the compression |
| **Next run** | The time within the next day, otherwise how long until then, or Paused |

The **Columns** menu adds what a job keeps, who it notifies and when it was added, and moves or hides the rest. The tabs above the list show **All**, the jobs that **Need attention** because their last run failed or was partial, the **Running** ones and the **Paused** ones.

The switch beside **New job** shows the jobs as a table or as cards. A card shows the way of a backup from left to right: the source, what happens on the way and the destinations. A phone always shows the cards. The page remembers the view per user.

A click on a job opens its details: the last run and how often the last 30 days succeeded, the next run, the size of the last backup, the last 30 runs as bars, what goes in, the destinations with what each keeps, and the settings.

## Creating a Job

1. Open **Jobs** and click **New job**
2. Fill in the parts listed on the left of the dialog
3. Click **Create job**

A part shows a check once it has what the job needs. When something is missing, **Create job** opens the part with the problem and names it.

| Part | What it holds |
| :--- | :--- |
| **Basics** | The name, whether the job runs on its schedule, and when it runs: its own schedule or a schedule preset |
| **Source** | A database, folders from storage connections set up as directory sources, or both. For a database, all of its databases (also ones added later) or the picked ones |
| **Destinations** | Where the backups go, in upload order, each with its retention policy (see [Multi-Destination](#multi-destination)) |
| **Compression** | How pg_dump and DBackup make the backups smaller, see [Compression](#compression) |
| **Encryption** | The key from the Vault that encrypts every backup, or none |
| **Notifications** | The notification templates that report the runs |
| **Advanced** | The file names, incremental backups for folders and the scheduled integrity check |

### Picking Databases

**All databases** backs up every database of the source, also the ones added to the server later. **Some databases** lists the databases on the server to pick from:

- The search above the list finds a database by name. The checkbox beside it picks every database the search shows, or all of them without a search, and picks them off again.
- Each database shows its size and its tables where the server tells them, and the **Name** button sorts the list by size instead.
- The line below says how many are picked and how big they are together, and **Clear** picks them all off.
- A picked database the server no longer has stays on top with **Not on the server**, so it can be unticked.

Once every database is picked, the list offers **Use All databases**, which also takes the databases added later.

### Compression

Reduce backup size significantly in the **Compression** part. Every option is a card that says what it is good for:

| Algorithm | Speed | Compression | Best For |
| :--- | :--- | :--- | :--- |
| **None** | Fastest | 0% | Quick backups, already compressed |
| **Gzip** | Fast | 60-70% | General use |
| **Brotli** | Slower | 70-80% | Maximum compression |

A PostgreSQL job lets `pg_dump` compress the dump while it writes it, with Gzip, LZ4 or Zstd, and a slider for the level between faster and smaller that marks the default. DBackup then does not compress the dump a second time, only the folders of a job that has them. With **None** for the dump, DBackup compresses the whole backup instead. An option the PostgreSQL server cannot do stays visible and says which version it needs. See [PostgreSQL → PostgreSQL Compression](/user-guide/sources/postgresql#postgresql-compression).

### Encryption

Protect sensitive data by picking a key in the **Encryption** part of the job. The list starts with **No encryption** and holds the keys of the [Vault](/user-guide/security/encryption) with how many jobs use each one. **New** makes a key right there and picks it.

Backups are encrypted with AES-256-GCM. Download the Recovery Kit of the key in the Vault and keep it somewhere safe, since the backups cannot be opened without it.

### Schedule

Pick when a job runs hourly, daily, weekly or monthly, or write a cron expression. The picker shows the next runs and warns when runs would wait for a free slot of the queue. See [Scheduling](/user-guide/jobs/scheduling).

### Retention

Automatically clean up old backups. Retention is configured **per destination** - each destination can have its own retention policy. See [Retention Policies](/user-guide/jobs/retention).

### Filename Pattern

The backup files of a job are named by a **Naming Template**, the default one unless the job picks another under **File names** in the **Advanced** part (see [Templates](#templates) below). The field shows a name the job will write, with the time zone of the scheduler. The pattern supports the following tokens:

| Token | Description | Example |
| :--- | :--- | :--- |
| `{job_name}` | Job name, every character but letters and digits turned into `_` | `Daily_MySQL_Backup` |
| `{db_name}` | The picked databases joined with `_`, or `all` | `mydb` |
| `{chain}` | Position in an incremental chain, left out for every other job | `full-000`, `inc-001` |
| `yyyy` | 4-digit year | `2026` |
| `MM` | 2-digit month (zero-padded) | `05` |
| `MMM` | Short month name | `May` |
| `MMMM` | Full month name | `January` |
| `dd` | 2-digit day | `03` |
| `HH` | 2-digit hour (24h) | `14` |
| `mm` | 2-digit minute | `30` |
| `ss` | 2-digit second | `00` |

The default template produces file names like `Daily_MySQL_Backup_2026-05-03_14-30-00.tar`.

::: warning Backups with the same name
A backup replaces a file of the same name at every destination, together with its metadata. When two runs of the schedule would get the same name, like two runs a day with a template that has only the date, **File names** warns and offers a template with the time. It does so for a paused job too, since its schedule is still set. A pattern without the time of day also lets a run started by hand replace the backup of that day, which the field notes. Incremental jobs are safe, since every file of a chain carries its position.
:::

### Notifications

A job reports its runs through [notification templates](/user-guide/features/templates#notification-templates). Each template names channels, and each channel hears about the runs picked for it: succeeded, partial or failed. The **Notifications** part shows the templates of the job with their channels and runs. **Add a template** picks another one from a list, **New** beside it makes one. A new job starts with the default template.

Below the templates, **Who hears about a run** lists every channel of the job with a column for succeeded, partial and failed runs. A channel in two templates gets two messages after the same run, and the table counts both and says so. The line under the table names how many channels hear about a failed run, or warns when nobody does.

A job made by the [Quick Setup](/user-guide/first-steps#quick-setup) or an older version names its channels directly instead, with one choice of runs for all of them. **Make a template of them** turns them into a template that takes their place. Once a template is on the job, those channels get no message, and **Remove them** clears them.

## Multi-Destination

A job can upload to **multiple storage destinations** simultaneously - ideal for implementing the 3-2-1 backup rule.

### Adding Destinations

1. Open the **Destinations** part of the job
2. Click **Add destination** and pick a storage connection
3. Repeat to add more. They are uploaded in the order they are numbered

The list of connections shows each one with its type, where it points and, when it is not online, its status. **New destination** at the foot of the list adds a connection with the same dialogs as the Connections page and picks it right away. The database of a job and the connections of its folders are picked the same way, with **New** beside the database field.

### Per-Destination Retention

Each destination row has its own **Retention Policy** picker. Its list says what each policy keeps, like "Keeps the last 14", and how many destinations follow it. **Edit** on a policy changes it for every destination that follows it, and **New policy** adds one and picks it. The policies that ship with DBackup cannot be edited. All policies are also managed under **Administration → Templates → Retention Policies**.

- Example: assign a "30-day daily" policy to local storage and a "12-month monthly" policy to S3
- **Default policy** follows the policy marked as the system default in Templates

### Upload Behavior

- The database dump runs **once** - the resulting file is uploaded to each destination sequentially
- Destinations are processed in priority order (top to bottom)
- If one destination fails, the others still continue
- The same storage adapter cannot be selected twice in one job

### Partial Success

If some destinations succeed and others fail, the execution is marked as **Partial** (see [Job Status](#job-status)).

## Job Actions

The button at the end of a row, a right click on the row and the details of a job offer the same actions:

| Action | What it does |
| :--- | :--- |
| **Run now** | Starts the job right away. It also sits on the row, shown when the pointer is over it |
| **Open the last run** | Opens the log of the newest run in History |
| **Backups on ...** | Opens the Storage Explorer at the backups of the job, one entry per destination |
| **Trigger by API** | Shows how to start the job from a script or a webhook |
| **Edit** | Opens the job form |
| **Clone** | Copies the job under a new name. The copy starts paused, so it cannot run before you checked it |
| **Pause** or **Resume** | A paused job does not run on its schedule, it can still be started by hand |
| **Delete** | Removes the job. Backups it stored stay where they are |

Tick several jobs in the table to pause, resume or delete them together. A right click on one of the ticked rows offers the same.

### Exclude from Restore

Database **sources** can be individually excluded from the Restore target dropdown. Open the source's edit form and turn off **Restore target** in its **Behavior** part. Backups can still be created from an excluded source - it is only hidden from the restore wizard target list.

To change several sources at once, tick them on the **Databases** tab of **Connections** and pick **Exclude from restore** or **Include in restore** under **More**.

## Job Status

The **Last run** of a job shows how its newest run went:

| Status | Description |
| :--- | :--- |
| **Done** | The run succeeded |
| **Running** | A run is going on right now, with its stage and progress |
| **Queued** | The run waits for a free slot or for the running run of the same job, see [Concurrent Execution](#concurrent-execution) |
| **Partial** | Some destinations got the backup, others failed |
| **Failed** | The run failed, the error of its log is shown with it |

A paused job keeps the status of its last run. The **Next run** column says Paused instead of a time.

## Execution Monitoring

### Live Progress

During execution, view:
- Current step (Initialize → Dump → Upload → Complete)
- File size progress
- Live log output

### Execution History

After completion:
1. Go to **History**
2. View all past executions
3. Check logs for details
4. See success/failure status

## Best Practices

### Naming Convention

Use descriptive names:
- `prod-mysql-daily` - Production MySQL, daily
- `staging-postgres-hourly` - Staging PostgreSQL, hourly
- `mongodb-weekly-archive` - MongoDB weekly archive

### One Source Per Job

For clarity, create separate jobs for:
- Different databases
- Different retention requirements
- Different schedules

### Test Before Scheduling

1. Create the job with **Runs on its schedule** turned off
2. Run it by hand with **Run now**
3. Verify backup in Storage Explorer
4. Test restore
5. Then enable schedule

### Resource Considerations

- Schedule during low-traffic periods
- Avoid overlapping large backups
- Monitor system resources during backup

## Concurrent Execution

By default, one backup runs at a time. Configure concurrency:

1. Go to **Settings** → **System**
2. Set **Max Concurrent Jobs**
3. Higher values = more parallel backups

Runs of the same job never overlap, whatever the setting. A run started by hand, by the API or by the schedule while the job is still running waits as **Queued** and starts right after. Two runs of one job at once would plan the same step of an incremental chain and could write the same file.

::: warning Resource Usage
More concurrent jobs = higher CPU/memory/disk usage
:::

### Stuck Job Timeout

A running job occupies one of those slots until it finishes. If a run stops making progress -
a source that stopped answering, a network path that went away without closing the connection -
it would hold its slot indefinitely and every job queued behind it would silently never start.

**Settings** → **System** → **Stuck Job Timeout** sets how long a run may go without reporting
progress before it is cancelled and marked failed. The default is 6 hours, and `Never (disabled)`
switches the check off.

The measure is progress, not age. A twelve-hour transfer that keeps reporting is left alone; a
five-minute one that went quiet is not. The watchdog runs every five minutes and can be disabled
per instance under **History** → **System Tasks**.

## Job Pipeline

When a job runs, it goes through these steps:

```
1. Initialize
   └── Fetch job config
   └── Decrypt credentials
   └── Validate source connection
   └── Resolve all destination adapters

2. Dump
   └── Execute database dump
   └── Apply compression (if enabled)
   └── Apply encryption (if enabled)

3. Upload (Fan-Out)
   └── For each destination (by priority):
       └── Transfer backup file
       └── Create metadata file
       └── Verify checksum (local storage)
   └── Evaluate results → Partial if mixed

4. Completion
   └── Cleanup temp files
   └── Record per-destination results
   └── Update execution status
   └── Send notifications

5. Retention (per destination)
   └── For each destination (successful uploads only):
       └── List existing backups
       └── Apply that destination's retention policy
       └── Delete expired backups
```

## Troubleshooting

### Job Stuck in "Running"

If a job shows running but isn't progressing:
1. Check **History** for the execution
2. View logs for errors
3. The server may have restarted mid-backup
4. Manually cancel if needed

### Backup Too Slow

1. Enable compression (smaller transfer)
2. Schedule during off-peak hours
3. Check network between DBackup and destination
4. Consider faster storage

### Out of Disk Space

Temp files are stored locally during processing:
1. Increase available disk space
2. Enable compression to reduce temp file size
3. Clean up old temp files: `/tmp/dbackup-*`

## Templates

The **Administration → Templates** page provides three reusable template types that keep job configuration consistent across your setup:

### Retention Policies

Named retention rules assignable per destination. Each policy defines Simple (keep N backups) or Smart (GFS - Grandfather-Father-Son rotation: daily, weekly, monthly, yearly buckets) behavior.

- One policy can be marked as the **system default** - it applies automatically to any destination without an explicit assignment
- Assign via the Retention Policy picker inside the job's destination row

### Naming Templates

Custom backup filename patterns saved as named templates. Supports all tokens listed in [Filename Pattern](#filename-pattern) above.

- One template can be set as the **system default**
- Override per job under **File names** in the **Advanced** part of the job, which warns when two runs would get the same name

### Schedule Presets

Named schedules that jobs follow. When a preset changes, every job that follows it runs on the new schedule without being edited.

- Pick **A schedule preset** under **When it runs** in the **Basics** part of the job
- **New preset** adds one from there, and **Edit** on a preset changes it for every job that follows it

## Next Steps

- [Scheduling](/user-guide/jobs/scheduling) - Configure when jobs run
- [Retention Policies](/user-guide/jobs/retention) - Automatic cleanup
- [Encryption](/user-guide/security/encryption) - Secure your backups
- [Templates](/user-guide/features/templates) - Retention Policies, Naming Templates, Schedule Presets
