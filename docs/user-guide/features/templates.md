# Templates

Manage reusable Retention Policies, Naming Templates, and Schedule Presets from a single place.

## Overview

The **Templates** page (Administration → Templates) provides three types of reusable building blocks for backup jobs. Instead of configuring retention, filenames, and schedules inline on every job, you define them once here and reference them across all jobs.

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

A Naming Template defines the filename pattern for backup files. The system-level pattern is set in **Settings → General → Backup Filename Pattern**. Naming Templates let you override it per job.

### Supported Tokens

| Token | Description | Example |
| :--- | :--- | :--- |
| `{job_name}` | Job name | `Daily MySQL Backup` |
| `{name}` | Job name (legacy alias) | `Daily MySQL Backup` |
| `{db_name}` | Database name | `mydb` |
| `yyyy` | 4-digit year | `2026` |
| `MM` | 2-digit month (zero-padded) | `05` |
| `MMM` | Short month name | `May` |
| `MMMM` | Full month name | `January` |
| `dd` | 2-digit day | `03` |
| `HH` | 2-digit hour (24h) | `14` |
| `mm` | 2-digit minute | `30` |
| `ss` | 2-digit second | `00` |

Token chips in the template editor are grouped by category (Job Info, Date, Time) and insert at the current cursor position. A live preview updates as you type.

Arbitrary literal text works without escaping - for example `prod_{db_name}-yyyy-MM-dd` is valid.

### Default Naming Template

Mark one template as the **system default**. It is used for all jobs that have no per-job template assigned.

### Assigning a Naming Template to a Job

1. Open a job (create or edit)
2. In **Basic Settings**, use the **Filename Template** picker
3. Select a template from the list

## Schedule Presets

A Schedule Preset is a named cron expression that can be shared across jobs.

### Using a Preset

1. Open a job (create or edit)
2. In the **Basics** part, pick **A schedule preset** under **When it runs**
3. Pick a preset from the list, or add one with **New** beside the field

The list shows when each preset runs and how many jobs follow it, and the field names the time zone of the scheduler the times are in. The job follows the preset: when the preset changes, every job that follows it runs on the new schedule without being edited. **Edit** on a preset in the list changes it from the job form. To stop following, pick **Its own schedule**, which starts from the preset's expression.

## Next Steps

- [Creating Jobs](/user-guide/jobs/) - Apply templates when configuring jobs
- [Retention Policies](/user-guide/jobs/retention) - Detailed explanation of Simple and GFS retention
- [Scheduling](/user-guide/jobs/scheduling) - Cron syntax reference
