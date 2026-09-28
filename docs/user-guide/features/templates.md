# Templates

Reusable retention policies, file names, schedule presets, notification templates and exclude patterns, each with what uses it.

## Overview

The **Templates** page (Administration → Templates) holds the building blocks jobs share. Instead of setting retention, file names, schedules, notifications and exclude patterns on every job, you define them once here and pick them in the jobs.

Each kind is a tab with its numbers on top and a table below: a search, filters, the quick filters **All**, **In use** and **Unused**, and a row per template with the jobs, destinations or folders that use it. A click on a row opens its details in a side panel, a right click opens its actions, and ticked rows can be deleted together. A phone gets cards instead of the table.

Everyone with the **View Templates** permission sees the page. Adding, changing, duplicating and deleting templates needs **Manage Templates**, without it the page shows no buttons for them.

**Duplicate** in the menu of a template makes a copy under a new name. No job uses the copy until one picks it.

## Retention Policies

A retention policy decides which backups a destination keeps. Every destination of a job picks one, or follows the default policy.

| What it keeps | Description |
| :--- | :--- |
| **Everything** | Never removes a backup |
| **The last few** | Keeps the newest ones, however old they are |
| **Smart rotation** | Keeps the newest backup of each hour, day, week, month and year, as many as each tier says |

The tiers of a smart rotation add up: each keeps that many backups on top of what the finer tiers already cover. GFS bucketing uses the Scheduler Timezone. Locked backups always stay. See [Retention Policies](/user-guide/jobs/retention) for the details.

### What a change removes

Editing a policy that destinations use shows them beside the form, each with the backups it holds and what the next run of its job removes under the change. The numbers follow every change of the form, and nothing is removed on save. A destination the listing has not reached yet is named, since its backups are not counted.

### Default Policy

A destination without a policy of its own follows the default policy. **Make default** on another policy asks first and lists those destinations with what their next run removes under it, since a new default can remove backups elsewhere. Destinations that picked a policy keep theirs.

::: warning The default always stays
The default policy cannot be deleted or unset, only replaced by making another policy the default. Without a default, every destination that followed it would keep every backup.
:::

### Deleting a Policy

The built-in policies can be edited but not deleted. A policy that destinations of jobs picked, or that a destination connection starts new jobs with, cannot be deleted either: its delete dialog lists them with a link to each. Pick another policy there first.

## File Names

A file name template names the backup files of a job. The default template names the backups of every job without one of its own. The table shows the pattern with its tokens marked and the next file of the first job that uses it.

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

Token chips in the template dialog insert at the cursor. The preview shows a name as a backup gets it, ending in `.tar`, with the time of the scheduler's time zone. A pattern without the time of day gets a warning, since two backups of a job on one day would share a name and the later one would replace the earlier.

Literal text works without escaping, for example `prod_{db_name}-yyyy-MM-dd`. The letter pairs of the date tokens are replaced wherever they appear, though, so a word like `summary` turns into `su30ary`.

The details of a template list the next file of each of its jobs, and **Names repeat** counts the jobs whose runs would get a name an earlier run already has.

### Default and Deleting

There is always a default template. **Make default** on another one lists the jobs that follow the default with the name their next file gets. The built-in **Standard** template cannot be changed or deleted, and a template jobs picked cannot be deleted until they pick another one.

To use a template, pick it under **File names** in the **Advanced** part of a job, or add one with **New** beside the field. The field warns when two runs of the job's schedule would get the same name, see [Creating Jobs](/user-guide/jobs/#filename-pattern).

## Schedule Presets

A schedule preset is a named schedule jobs can follow. Its dialog uses the same schedule picker as the job form, see [Scheduling](/user-guide/jobs/scheduling). The table shows when each preset runs next and the jobs that follow it, the details list its next runs.

A job follows its preset: when the preset changes, every job that follows it runs on the new schedule without being edited. To use one, pick **A schedule preset** under **When it runs** in the **Basics** part of a job.

Deleting a preset hands its schedule to the jobs that followed it. They keep running at the same time on their own, and a later change of a preset no longer reaches them.

## Notification Templates

A notification template names [notification channels](/user-guide/notifications/) and after which runs each one hears about a job: succeeded, partial or failed. The table shows every channel with its runs, the details a table of who hears about which run.

**Default for new jobs** makes a new job start with the template, and **Stop as default** in its menu ends that. Jobs that exist keep their templates either way. A template jobs use cannot be deleted until they drop it.

To use one, pick it under **Add a template** in the **Notifications** part of a job. The job follows the template, so a change reaches every job that uses it. See [Creating Jobs](/user-guide/jobs/#notifications) for the table of who hears about a run.

## Exclude Patterns

An exclude preset names what the backup of a folder skips. It follows groups of DBackup, like macOS clutter or Development artifacts, and adds patterns of its own, one a line. A group is referenced, not copied, so a group extended in a later release reaches every preset that follows it. A click on a pattern of a group leaves it out of the preset.

A group writes a folder as `**/node_modules/**` and skips it at any depth. A pattern of your own with a slash matches from the top of the folder, so write the `**/` in front for the same, see [exclude patterns](/user-guide/features/file-backups#exclude-patterns-and-why-they-are-worth-setting).

Beside the form the dialog lists every pattern the preset skips. **Check a path** takes a path inside the folder and says whether the backup skips it and which pattern does.

**Default for new folders** makes a new folder of a job start with the preset. Several presets can be the default at once, and their patterns add up.

Deleting a preset takes its patterns from the folders that use it. Its delete dialog lists them, and from their next run they back up what it skipped. The built-in preset can be edited but not deleted.

## Next Steps

- [Creating Jobs](/user-guide/jobs/) - Apply templates when configuring jobs
- [Retention Policies](/user-guide/jobs/retention) - Detailed explanation of simple and GFS retention
- [Scheduling](/user-guide/jobs/scheduling) - Cron syntax reference
