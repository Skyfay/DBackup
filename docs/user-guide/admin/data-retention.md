# Data Retention & Database

DBackup keeps its configuration, users and history in its own SQLite database. This page covers how long that history is kept, how to give the space of removed records back to the disk, and how to download a copy of the database.

::: info Backup files are not affected
Everything on this page is about DBackup's own records. Backup files on your destinations follow the [retention policy](/user-guide/jobs/retention) of each job.
:::

## Data Retention

Go to **Settings → General → Data Retention**. Each setting shows how many records are currently stored and saves as soon as you pick a value. Cleanup runs with the **Clean Old Data** system task, daily at midnight and when DBackup starts. Run it by hand under **Settings → System Tasks** to apply a change right away.

| Setting | What is removed | Default | Options |
| :--- | :--- | :--- | :--- |
| **Execution Logs** | The step log of finished backup, restore and system task runs. The run stays in History with its status, size and timestamps. | 90 days | 7 days to 2 years, Never |
| **Execution History** | Finished runs, including their entry in History. | Never | 30 days to 5 years, Never |
| **Audit Log** | Records of user actions such as sign-ins and configuration changes. | 90 days | 30 days to 5 years |
| **Notification History** | Notifications sent by DBackup, including their rendered content. | 90 days | 7 days to 5 years |
| **Storage Usage History** | Hourly size measurements behind the storage charts and usage alerts. | 90 days | 7 days to 5 years |
| **Health Check History** | Connection checks against sources and destinations, recorded every minute. | 2 days | 1 to 30 days |

The step log is by far the largest part of a run. Keeping the History entries while removing old logs frees most of the space without losing statistics.

### What Execution History cleanup always keeps

- Runs that are still queued or running.
- The newest 10 runs of every job, however old they are. Runs without a job, such as restores and integrity checks, keep their newest 10 per type.
- Every run of the incremental chain a job is currently extending, since the next incremental backup builds on it.

### Effects on the rest of DBackup

- The dashboard statistics and the backup calendar only count runs that are still in History. The calendar shows up to a year, as many weeks as the screen fits, so with a shorter **Execution History** its oldest weeks stay empty.
- A run whose log was removed shows a notice in its History dialog, and **Copy** and **Download .log** are disabled.
- The `error` field of `GET /api/executions/{id}` is read from the log, so it is empty for a failed run whose log was removed.
- Notification History entries that belonged to a deleted run stay until their own retention period removes them.

## Database

Go to **Settings → General → Database**.

| Figure | Meaning |
| :--- | :--- |
| **Size** | The database file plus its WAL file. |
| **Reclaimable** | About how much space **Optimize Database** gives back. |
| **Free disk space** | Free space on the volume that holds the database. |
| **Journal mode** | `WAL` or `DELETE`, see `SQLITE_WAL_MODE` in the [environment reference](/developer-guide/reference/environment). |

The path of the database file is shown below the figures.

### Optimize Database

SQLite never shrinks its file on its own. Space from removed records is reused for new data, but the file stays as large as it ever was. **Optimize Database** runs `VACUUM` to rebuild the file without that space and then truncates the WAL file.

- Needs the `settings:write` permission and is recorded in the audit log.
- Is refused while a backup, restore or integrity check is running. Jobs that become due while it runs wait in the queue and start once it has finished.
- Needs free space on the database volume for the data in use.
- DBackup may not respond for a moment while it runs on a large database.

::: tip
After lowering a retention period, run **Clean Old Data** first and then optimize the database. Removing records alone does not make the file smaller.
:::

### Download Database

**Download Database** hands you a copy of the whole SQLite file. DBackup writes the copy with `VACUUM INTO` to its temp directory (`TMPDIR`), so it is consistent, compacted and a single `.db` file with nothing left in a WAL file.

- Only members of the **SuperAdmin** group see the button. API keys cannot download the database.
- Is refused while a backup, restore or integrity check is running.
- Needs free space in the temp directory for the data in use.
- The temp copy is deleted once the download finishes or is cancelled, and a few minutes later if it was never collected.
- Every download is recorded in the audit log.

::: danger Treat the file like a password
The file holds every user with their password hash, active session tokens, API key hashes and all stored credentials. Credentials stay encrypted and can only be read with this instance's `ENCRYPTION_KEY`, but a session token can be used as it is. Store the file safely and delete it when you no longer need it.
:::

To move the configuration to another instance without the execution history, use the [system backup](/user-guide/features/system-backup) instead.

### Restoring a downloaded copy

1. Stop the DBackup container.
2. In the `db` folder of the `/data` volume, replace `dbackup.db` with the downloaded file, renamed to `dbackup.db`.
3. Delete `dbackup.db-wal` and `dbackup.db-shm` if they exist. They belong to the old file.
4. Start the container with the same `ENCRYPTION_KEY` and the same or a newer DBackup version. Pending migrations are applied on startup.
