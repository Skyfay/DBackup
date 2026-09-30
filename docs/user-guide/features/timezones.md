# Timezones

How DBackup handles timezones across scheduling, display, and backup filenames.

## Overview

DBackup separates timezone concerns into two independent roles:

| Role | Setting | Purpose |
| :--- | :--- | :--- |
| **Scheduler Timezone** | Settings - General - Time zone | Controls **when** cron jobs fire. `0 3 * * *` means "3:00 AM in this timezone." |
| **Display Timezone** | User Profile - Timezone | Controls **how** timestamps are shown to each user in the UI. |

These two settings are completely independent. You can schedule jobs to run at 3:00 AM Berlin time while one user views timestamps in UTC and another in Tokyo time - both are correct.

## Scheduler Timezone

The scheduler timezone defines the timezone in which cron expressions are interpreted. It applies to:

- All backup job schedules (e.g., `0 3 * * *` fires at 3 AM in this zone)
- System task schedules (retention cleanup, storage snapshots, etc.)
- The timestamp embedded in backup filenames

### How to configure

1. Open **Settings** in the sidebar.
2. Open **General**.
3. Pick your zone under **Time zone**. The line below it says what 03:00 there is in UTC.
4. Click **Save changes** in the bar at the foot.

After changing the scheduler timezone, the scheduler restarts automatically and all jobs are rescheduled with the new timezone.

### Schedule picker preview

When you create or edit a backup job, the schedule picker preview shows the time **in the scheduler timezone** with the timezone name appended:

```
Runs every day at 03:00 (Europe/Berlin)
```

This ensures you always know exactly when the job will fire, regardless of your profile timezone.

### Backup filename timestamps

Backup filenames that include time tokens (e.g., `{job_name}_yyyy-MM-dd_HH-mm-ss`) use the scheduler timezone for the timestamp. A job running at 3:00 AM Europe/Berlin produces a filename like `MyJob_2026-05-09_03-00-00` regardless of the server clock.

## Display Timezone (User Profile)

Each user can set their own timezone in their profile. This controls how all timestamps are displayed throughout the UI:

- Execution history "Started At" column
- Dashboard recent activity
- Notification logs
- Any other timestamp in the interface

### How to configure

1. Click your avatar or name in the bottom-left corner.
2. Open **Profile**.
3. Under **Timezone**, select your timezone - or choose **Auto (Browser Timezone)** to always follow your browser's local timezone.
4. Changes apply immediately without reloading.

::: tip Auto (Browser Timezone)
New users start with UTC. Switch to **Auto (Browser Timezone)** to have DBackup automatically use your browser's detected timezone. This is the recommended setting when users are in a single timezone or when each user works from their own device.
:::

### Multi-user scenarios

Because display timezones are per-user, two users in different countries can both use DBackup simultaneously and each see timestamps in their local time:

- User A (Europe/Berlin) sees "09 May 2026 03:00"
- User B (America/New_York) sees "08 May 2026 21:00"

Both are looking at the exact same backup execution.

## The `TZ` Environment Variable

The `TZ` environment variable sets the timezone of the Node.js process itself. It is **not required** for DBackup to work correctly - the scheduler timezone is managed through the UI setting described above.

`TZ` serves as a low-level process fallback for any system library that does not accept an explicit timezone parameter. It has no effect on how DBackup schedules jobs or displays timestamps.

```yaml
# docker-compose.yml - optional, not required for DBackup
services:
  dbackup:
    environment:
      - TZ=Europe/Berlin  # optional process fallback
```

## Dashboard Activity Chart

The Jobs Activity chart on the dashboard groups executions by day using the scheduler timezone. If your scheduler timezone is `Europe/Berlin`, a backup that runs at 23:30 UTC (01:30 Berlin) appears on the next day's bar in the chart.

## Troubleshooting

### Schedule picker shows wrong time

The preview in the schedule picker always reflects the **scheduler timezone** (shown in brackets). If the time looks unexpected, check:

1. Go to **Settings - General - Time zone** and confirm the correct timezone is set.
2. The preview updates after the page loads the setting from the server.

### Dashboard chart shows jobs on the wrong day

The activity chart groups by the scheduler timezone. If jobs appear on an unexpected day:

1. Verify the **Time zone** in Settings - General.
2. A backup running near midnight may fall on different days depending on the timezone.

### History timestamps look wrong

Each user's history table shows timestamps in their own **profile timezone**. If the times look off, check **Profile - Timezone**. Select **Auto (Browser Timezone)** to automatically use your browser's timezone.

### Changing the scheduler timezone mid-operation

Changing the scheduler timezone immediately reschedules all jobs. A job that was set to `0 3 * * *` will now fire at 3:00 AM in the new timezone. No cron expressions are rewritten in the database - only the timezone applied to them changes.

## Next Steps

- [Scheduling](../jobs/scheduling.md) - Cron expression format and common schedule examples
- [Profile Settings](./profile-settings.md) - How to change your display timezone, date format, and time format
- [System Tasks](../admin/settings.md#system-tasks) - Built-in scheduled maintenance tasks
