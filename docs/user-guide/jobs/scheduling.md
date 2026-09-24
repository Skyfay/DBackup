# Scheduling

Automate your backups with cron-based scheduling.

## Overview

DBackup uses standard cron expressions for scheduling. When a schedule is set, the job runs automatically at the specified times. You rarely have to write one yourself: the schedule picker builds it.

## Picking a Schedule

The job form and the schedule preset dialog use the same picker. Choose how often a job runs:

| Choice | What you set | Written as |
| :--- | :--- | :--- |
| **Hourly** | Every 1, 2, 3, 4, 6, 8 or 12 hours, at a minute past the hour | `15 */6 * * *` |
| **Daily** | One or more times a day, a second one with **Add time** | `0 3,15 * * *` |
| **Weekly** | The days, with **Weekdays** and **Weekend** as shortcuts, and the times | `30 22 * * 1-5` |
| **Monthly** | A day from 1 to 31 or **Last day**, and the times | `0 4 L * *` |
| **Cron** | Any cron expression, for everything else | `*/30 9-17 * * 1-5` |

Times are typed like `03:00` and are those of the scheduler time zone. All times of one schedule share their minute, because a cron expression has a single minute field for all of them. Under the picker the schedule is said in words, with the time zone and the next three runs. A cron expression the scheduler cannot read is marked at once and cannot be saved.

### When Runs Would Wait

The queue runs as many jobs at once as **Max Concurrent Jobs** in **Settings - General** allows. When the slots are taken at the time a job starts, the picker shows a small warning with the jobs ahead of it in the queue and about how long it waits for them, together with a nearby time that has room, like **Use 03:15**. The queue runs one job after the other, so with one slot a job waits until every job ahead of it is done: two jobs of 5 and 8 minutes make it wait 13 minutes. As long as the slots are enough nothing is shown, so three jobs at 03:00 are fine with three slots.

How long a job usually takes comes from its recent runs, the same estimate the timeline of the next hours on the Overview uses. For a schedule preset the warning also counts the jobs that follow it, since they all start together.

## Cron Expression Format

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

## Common Schedules

### Daily Backups

```bash
# Every day at 2:00 AM
0 2 * * *

# Every day at midnight
0 0 * * *

# Every day at 6:00 PM
0 18 * * *
```

### Multiple Times Per Day

```bash
# Every 6 hours
0 */6 * * *

# Every 4 hours
0 */4 * * *

# Every hour
0 * * * *

# Twice a day (6 AM and 6 PM)
0 6,18 * * *
```

### Weekly Backups

```bash
# Every Sunday at 3:00 AM
0 3 * * 0

# Every Saturday at midnight
0 0 * * 6

# Monday, Wednesday, Friday at 2:00 AM
0 2 * * 1,3,5
```

### Monthly Backups

```bash
# First day of month at 4:00 AM
0 4 1 * *

# Last day of month at midnight
0 0 L * *

# 15th of every month
0 0 15 * *
```

### Specific Schedules

```bash
# Weekdays at 1:00 AM
0 1 * * 1-5

# Weekends at 6:00 AM
0 6 * * 0,6

# Every 30 minutes during business hours
*/30 9-17 * * 1-5
```

## Schedule Examples by Use Case

### Production Database (Critical)

Multiple backups per day:
```bash
# Every 4 hours
0 */4 * * *
```

Combined with Smart retention for long-term keeping.

### Development Database

Daily is usually sufficient:
```bash
# Daily at 3:00 AM
0 3 * * *
```

### Large Database (Time-Sensitive)

Schedule during maintenance window:
```bash
# Sunday 2:00 AM (low traffic)
0 2 * * 0
```

### Compliance (Financial)

End of business day:
```bash
# Weekdays at 11:00 PM
0 23 * * 1-5
```

## Time Zone

DBackup interprets all cron expressions in the **Scheduler Timezone** configured in **Settings - General**. For example, `0 3 * * *` means "3:00 AM in the configured scheduler timezone."

To change the scheduler timezone:

1. Open **Settings** in the sidebar.
2. Go to the **General** tab.
3. Select your timezone under **Scheduler Timezone**.

The schedule picker shows its times in the scheduler timezone and names it beside the schedule in words, so you know exactly when a job will fire.

> For a full explanation of all timezone settings (scheduler timezone, per-user display timezone, and the optional `TZ` environment variable), see the [Timezones guide](../features/timezones.md).

## Scheduler Behavior

### Startup

When DBackup starts:
1. Loads all active jobs
2. Calculates next run times
3. Registers with scheduler

### Execution

When scheduled time arrives:
1. Job is queued
2. Respects concurrency limit
3. Executes when slot available

### Missed Schedules

If DBackup was down during scheduled time:
- Missed runs are **not** automatically triggered
- Next run occurs at next scheduled time
- Consider running manually after downtime

## Best Practices

### Stagger Schedules

Don't run all jobs at same time:

```bash
# Job 1: 2:00 AM
0 2 * * *

# Job 2: 2:30 AM
30 2 * * *

# Job 3: 3:00 AM
0 3 * * *
```

### Off-Peak Hours

Run during low-traffic periods:
- Night time (1-5 AM)
- Weekends for large backups
- After business hours

### Match Retention Policy

Align schedule with retention:
- Daily backups → Keep 7-30 daily
- Weekly backups → Keep 4-12 weekly
- Monthly backups → Keep 12-24 monthly

### Consider Database Load

- Production: Multiple times per day
- Staging: Daily
- Development: Daily or weekly

## Monitoring Schedules

### View Next Run

In the Jobs list, see "Next Run" column showing when each job will execute.

### Execution History

Check **History** to verify:
- Jobs ran at expected times
- No missed executions
- Duration is consistent

### Notifications

Set up notifications to alert on:
- Failures (always recommended)
- Successful completions (optional)

## Troubleshooting

### Job Not Running on Schedule

1. Verify job is **Enabled**
2. Check cron expression syntax
3. Confirm time zone is correct
4. Check DBackup logs for errors
5. Verify scheduler is running

### Runs at Wrong Time

1. Check server time zone
2. Set TZ environment variable
3. Restart DBackup after TZ change

### Overlapping Executions

If backups overlap:
1. Increase time between schedules, the schedule picker warns about overlaps and suggests a free time
2. Reduce backup duration (compression)
3. Increase max concurrent jobs

## Cron Expression Generator

Use online tools to generate complex expressions:
- [crontab.guru](https://crontab.guru)
- [cronmaker.com](https://www.cronmaker.com)

## Examples

### Enterprise Backup Strategy

```bash
# Hourly incremental (if supported)
0 * * * *

# Daily full backup at 2 AM
0 2 * * *

# Weekly full to archive at 3 AM Sunday
0 3 * * 0

# Monthly to cold storage
0 4 1 * *
```

### Small Business

```bash
# Daily backup at 1 AM
0 1 * * *

# Weekly comprehensive at 2 AM Sunday
0 2 * * 0
```

### Development Team

```bash
# Before daily standup (9 AM)
0 9 * * 1-5

# End of week archive
0 18 * * 5
```

## Next Steps

- [Retention Policies](/user-guide/jobs/retention) - Automatic cleanup
- [Notifications](/user-guide/features/notifications) - Get alerts
- [Creating Jobs](/user-guide/jobs/) - Job configuration
