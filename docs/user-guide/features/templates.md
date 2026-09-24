# Templates

Manage reusable Retention Policies, Naming Templates, Schedule Presets and Notification Templates from a single place.

## Overview

The **Templates** page (Administration → Templates) provides reusable building blocks for backup jobs. Instead of configuring retention, filenames, schedules and notifications inline on every job, you define them once here and reference them across all jobs.

## Retention Policies

A Retention Policy defines how many backups to keep on a storage destination. Policies are assigned per destination inside the job form.

### Policy Modes

**Simple** - keep the N most recent backups:

| Field | Description |
| :--- | :--- |
| **Keep** | Number of most recent backups to retain |

**Smart (GFS)** - Grandfather-Father-Son rotation:

| Field | Description |
| :--- | :--- |
| **Daily** | Number of daily backups to keep |
| **Weekly** | Number of weekly backups to keep |
| **Monthly** | Number of monthly backups to keep |
| **Yearly** | Number of yearly backups to keep |

GFS bucketing uses the configured Scheduler Timezone.

### Default Policy

Mark one policy as the **system default** using the star icon. The default policy is applied automatically to any destination that has no explicit policy assigned.

### Assigning a Policy to a Job

1. Open a job (create or edit)
2. Expand a destination row
3. Click the **Retention Policy** picker
4. Select a policy from the list

Changing a policy in Templates takes effect on the next retention run for all jobs using it.

## Naming Templates

A Naming Template defines the file name pattern for backup files. The template marked as the default names the backups of every job without one of its own.

### Supported Tokens

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

Token chips in the template dialog are grouped by category and insert at the current cursor position. The preview shows a name as a backup gets it, ending in `.tar`, with the time of the scheduler's time zone. A pattern without the time of day gets a warning, since two backups of a job on one day would then share a name and the later one would replace the earlier.

Literal text works without escaping, for example `prod_{db_name}-yyyy-MM-dd`. The letter pairs of the date tokens are replaced wherever they appear, though, so a word like `summary` turns into `su30ary`.

### Default Naming Template

Mark one template as the **system default**. It is used for all jobs that have no per-job template assigned.

### Assigning a Naming Template to a Job

1. Open a job (create or edit)
2. In the **Advanced** part, pick a template under **File names**, or add one with **New** beside the field
3. Save the job

**Default template** at the top of the list follows whichever template is marked as the default. The field warns when two runs of the job's schedule would get the same name, see [Creating Jobs](/user-guide/jobs/#filename-pattern).

## Schedule Presets

A Schedule Preset is a named cron expression that can be shared across jobs. Its dialog uses the same schedule picker as the job form, see [Scheduling](/user-guide/jobs/scheduling).

### Using a Preset

1. Open a job (create or edit)
2. In the **Basics** part, pick **A schedule preset** under **When it runs**
3. Pick a preset from the list, or add one with **New** beside the field

The list shows when each preset runs and how many jobs follow it, and the field names the time zone of the scheduler the times are in. The job follows the preset: when the preset changes, every job that follows it runs on the new schedule without being edited. **Edit** on a preset in the list changes it from the job form. To stop following, pick **Its own schedule**, which starts from the preset's expression.

## Notification Templates

A Notification Template names [notification channels](/user-guide/notifications/) and after which runs each one hears about a job: succeeded, partial or failed. Its dialog lists the channels as rows. Each row picks its channel from a searchable list, which can also add a new channel, and has a button for every run.

Mark a template as the default with the star in the list, and a new job starts with it.

### Using a Notification Template

1. Open a job (create or edit)
2. In the **Notifications** part, pick a template under **Add a template**, or add one with **New** beside the field
3. Save the job

The job follows the template: when the template changes, every job that uses it sends the new way without being edited. **Edit** on a template in the job form changes it for all of them. See [Creating Jobs](/user-guide/jobs/#notifications) for the table of who hears about a run.

## Next Steps

- [Creating Jobs](/user-guide/jobs/) - Apply templates when configuring jobs
- [Retention Policies](/user-guide/jobs/retention) - Detailed explanation of Simple and GFS retention
- [Scheduling](/user-guide/jobs/scheduling) - Cron syntax reference
