# History

Every run of DBackup and every notification it sent. A run opens as a page of its own with its steps, its log and what to look at.

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

- **Steps**: every step with its time next to its usual time, every copy under **Uploading** and every channel under **Sending Notifications**. A click on a step shows only its lines.
- **Log**: every line under the step it belongs to, with a search and a switch to show only the lines of problems. Commands, paths and raw errors are in a monospace font.
- **To look at**: each problem told once, in plain words, with the message of the server, where and when it came up, how often it was tried and what to do about it.

**Copy** and **Download** save the log as text, without passwords or keys.

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
