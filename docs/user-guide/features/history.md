# History

Every run of DBackup and every notification it sent. A run opens as a page of its own with its steps, a summary of what each step did, its log and what to look at.

## Runs

The **Runs** tab lists backups, restores and the system tasks, the newest first:

- What the run did, like the databases a backup held or the server a restore went to
- How it ended, with what went wrong in a few words or how far a live run is
- When it started, how long it took and how long a run of its job usually takes
- What it wrote and how many of its copies a destination took
- Who started it: the schedule, a person, or an API key

The numbers above the list cover the last 30 days: how many runs there were, how many succeeded, the failed and the partial ones with the last of each, and what runs or waits right now.

### Filters

The filters sit beside the search like in every table, the quick filters after them:

| Filter | What it keeps |
| :--- | :--- |
| **Type** | Backups and restores under **Jobs**, the integrity checks, verifications and configuration restores under **System tasks** |
| **Job** | The runs of the jobs you pick |
| **Started by** | The schedule, a person or an API key |
| **Failed**, **Partial**, **Running** | The runs that ended so, or that run or wait right now |

Each filter counts what the other filters leave. The list asks DBackup a page at a time, with the rows per page of your [profile](/user-guide/features/profile-settings#tables), and follows live runs every two seconds.

A phone shows the runs as cards.

## The Page of a Run

A click on a run opens it as a page of its own. Every link to a run in DBackup leads there, from the Overview, the Jobs page, the Backups page, the Database Explorer, and after **Run now** or a restore.

The button in the top left names the page the run was opened from, like **Overview**, and leads back there like the Back of the browser, to the same spot. A run opened from outside, like from a link in a notification, leads to History. The field beside the name opens another run of the same job, and the arrows step to the run before and after it.

- **Steps**: every step with its time next to its usual time, every copy under **Uploading** and every channel under **Sending Notifications**. A step the job has no use for, like **Dumping Databases** in a backup of folders only, is left out.
- **Summary** and **Log**: the two tabs in the middle, described below.
- **To look at**: each problem told once, in plain words, with the message of the server, where and when it came up, how often it was tried and what to do about it.

**Copy** and **Download** save the log as text, without passwords or keys.

### Summary

The **Summary** tells each step in a sentence or two, with a row for every database it dumped, every folder it collected, every destination it stored a copy at and every channel it notified. A click on a step on the left scrolls to it.

- A row says how many lines it holds, and one click opens it in place. A database shows the whole command it was dumped with, the lines of its tool, like **mongodump**, and its warnings grouped by what they say. A destination shows the lines it wrote.
- A long output shows its newest lines, **Show all** the rest.
- The database dumped now and the copy uploaded now fill a row marked **now**, with how far they are and how long they still take, and are open with their newest lines.

How far a dump is comes from the tool where it counts. MongoDB counts the documents of each collection and SQL Server reports its progress in steps of ten percent. The other tools tell nothing, so DBackup compares what is written with the dump of the same database in the last backup of the job and says **about**. The first backup of a database shows only what is written and how fast.

### Log

The **Log** tab shows every line under the step it belongs to, with a search, a field to show the lines of one step and a switch to show only the lines of problems. A click on a step on the left picks it there.

- The tool, destination or source that wrote a line stands in front of it, like **mongodump** or **NAS Backups**.
- A command stands under its line on one row with how many options it has. A click opens it with every option on a row of its own, **Copy** copies it whole.
- Commands, paths and raw errors are in a monospace font.

### Problems

A problem is told once, however often it came up. A destination that refused a backup three times is one problem with three tries, and a warning that only repeats a problem is left out.

DBackup knows common messages, like a full destination, a server it could not reach, a login it was refused or a channel that blocked it. It names them in plain words and offers the connection or job to fix. A message it does not know keeps its raw line and a title that names the step.

The lines of a problem are marked together in the log, and **Show in log** or the arrows beside **Problems** jump from one to the next.

### A Live Run

While a run is live, its page follows it:

- How long it still takes, against the usual time of its job
- Every copy with its progress, and the speed of the upload since the page is open
- The runs that wait for it
- The log, which follows the newest line until you scroll up, and then counts the new lines

The progress of an upload fills one line instead of writing a new one every few seconds. **Cancel run** stops it.

On a phone the page is one column: what to look at or the live state first, then the steps and the log.

### Integrity Checks and Verifications

An integrity check and a verification show every copy they checked instead of a summary: the backup, its destination, its size, how it was checked and what came out. The copy checked now comes first, then the ones that differ or were skipped, then the rest, the newest first. A verification checks the copies of one backup, which it names on the right.

The left side lists every destination with how many of its copies are checked, the matching ones green, the ones that differ red, and whether it checks a copy by a checksum it keeps or downloads it to hash it. An integrity check from before this page shows like any other run, with its copies in its log.

## Notifications

The **Notifications** tab lists every message DBackup sent, with its event, its channel and whether the channel took it. The filters **Channel** and **Event** sit beside the search, **Failed** after them.

A click opens the message in a side panel:

- What was sent, as the channel shows it
- Why the channel did not take it, with the answer of the channel
- The run it was sent for, which **Open run** opens
- The other channels that got the same message

## Required Permissions

| Permission | What it grants |
| :--- | :--- |
| `history:read` | The page, the runs, their logs and the notifications |
| `jobs:execute` | **Run again** and **Cancel run** |
| `jobs:read` | **Open job** |
| `storage:read` | **Open backups** |

## Troubleshooting

### A run shows no log

Data retention removes the step log of finished runs after a while, 90 days by default. The run stays with its status, size and times, and its page says when the log was removed. See [Data Retention](/user-guide/admin/data-retention).

### A problem has no plain words

DBackup names only the messages it knows. The raw line is always there, and its step and time show where to look.

## Next Steps

- [Jobs](/user-guide/jobs/) - Run a job again or change it
- [Backups](/user-guide/features/backups) - The backups every run made
- [Notifications](/user-guide/features/notifications) - The channels behind the Notifications tab
