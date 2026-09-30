# Settings

The Settings page holds what applies to the whole instance: its name and clock, the system tasks, the notifications, the records DBackup keeps of itself, the configuration backup and how people sign in. Looking at it needs `settings:read`, changing anything needs `settings:write`.

## The Page

The parts sit on the left in three groups, **System**, **Data** and **Security**. Beside each name stands its state when it has one, like how many notification events are on, the size of the database, a configuration backup that is **Off** or the days a certificate has left. A state in amber or red needs a look.

The search above the parts finds a setting by the start of its words, so `backup` finds **Include the logins** of the configuration backup but not every mention of DBackup. The parts without a hit are dimmed, and a click on a hit opens its part and marks the setting for a moment. A system task opens its Edit dialog right away.

Changes wait in a bar at the foot of the part, which names each change with its value before and after. **Save changes** saves the whole part, **Discard** goes back to what is saved. Leaving a part with changes that are not saved asks first.

On a phone the parts are a list with their state, and a part opens as a page of its own with an arrow back to the list.

Someone who may only read the settings sees every value and a line on top that says why nothing can be changed.

## General

| Setting | What it does | Default |
| :--- | :--- | :--- |
| **Name** | Shown in the browser tab as `DBackup \| Name`. Empty shows DBackup alone. | Empty |
| **Time zone** | The clock of every schedule, of the file names and of the retention. The line below it says what 03:00 there is in UTC. | UTC |
| **Runs at the same time** | How many backups run at once. A running restore or integrity check takes a run too. | 1 |
| **Fail a run that stops reporting after** | Fails a backup or restore that reports no progress for this long, so it gives its run back. **Never** turns it off. | 6 hours |
| **Look for new versions** | Asks GitHub for the newest release, shows a new version in the sidebar and reports it once a day. Off, DBackup never asks. | On |
| **Show Quick Setup in the sidebar** | Keeps Quick Setup in the sidebar. It shows by itself while no database is set up. | Off |

See [Timezones](/user-guide/features/timezones) for how the time zone of the scheduler and the one of your profile work together.

## System Tasks

What DBackup does by itself, each on its own schedule in the time zone of General.

| Task | Schedule | On by default | Follows |
| :--- | :--- | :--- | :--- |
| **Health checks** | Every minute | Yes | |
| **Stuck run watchdog** | Every 5 minutes | Yes | **Fail a run that stops reporting after** under General |
| **Database versions** | Every hour | Yes | |
| **Storage statistics** | Every hour | Yes | |
| **Backups page cache** | Every hour | Yes | |
| **Clean old data** | Every day at 00:00 | Yes | |
| **Check for updates** | Every day at 00:00 | Yes | **Look for new versions** under General |
| **SuperAdmin permissions** | Every day at 00:00 | Yes | |
| **Configuration backup** | Every day at 03:00 | No | **Back up the configuration** under Configuration backup |
| **Integrity check** | Sundays at 04:00 | No | |

A task that follows a setting has one switch, the one of that setting. Switching the task off sets it off there too, and the other way round. Switching the stuck run watchdog on again brings back the timeout of 6 hours.

The list shows each schedule in words with the next run, and the last run with how long it took or what it did, like `2,418 removed` or `v3.4.0 is current`. A run that needs a look shows in amber, and **A problem** above the list shows only those tasks. The switch of a row turns a task on and off at once.

A click on a task opens its Edit dialog:

- **Run on the schedule** and **Run when DBackup starts**. A task set to run at start runs once, ten seconds after DBackup started, and only while it is on.
- **Schedule**, picked like the schedule of a job: hourly, daily, weekly, monthly or a cron expression, with the next runs below it.
- For the integrity check, **What it checks** (the backups of jobs or every file of every destination), **Skip backups that passed**, **Only backups newer than** and **Skip files larger than**. See [Backup Verification](/user-guide/features/backup-verification).

**Run now** starts a task at once and does not wait for it. The row shows it running and its outcome when it ends. A run of the integrity check opens in History.

## Notifications

Which events DBackup reports and to which channels. See [Notifications](/user-guide/features/notifications).

## Data

**Data retention** and **Database** are described in [Data Retention & Database](/user-guide/admin/data-retention), **Configuration backup** in [System Backup](/user-guide/features/system-backup).

## Sign-in

| Setting | What it does | Default |
| :--- | :--- | :--- |
| **Sessions last** | How long someone stays signed in. A new length applies from their next sign-in. | 7 days |
| **Sign in with a passkey** | The passkey button on the login page. A passkey as second factor keeps working either way. | On |

`DISABLE_EMAIL_LOGIN=true` on the container turns the password sign-in off, and the part shows whether it is. While it is off and no sign-in provider is on, a passkey is the only way in, so its button cannot be turned off. The sign-in providers are set up under Users & Groups, see [SSO / OIDC](/user-guide/admin/sso).

## HTTPS

The certificate DBackup answers with, from `/data/certs`: who it is issued to and by, until when it is valid, its SHA-256 fingerprint and the names it is valid for. From 30 days before its end the part warns.

- **Upload certificate** takes a certificate and its private key in PEM format. RSA, EC and Ed25519 keys are checked against the certificate before anything is replaced.
- **Make a new self-signed one** makes a certificate for a year. The old one stays when that fails.

A new certificate applies after a restart of DBackup. `DISABLE_HTTPS=true` on the container turns HTTPS off, for example behind a proxy that encrypts the way to it.

## Rate Limits

How many requests one address may make in a time window. See [Rate Limits](/user-guide/features/rate-limits).

## Privacy

**Name who started a backup in its metadata** writes the name of the person or the API key that started a backup into the `.meta.json` beside it. That file is not encrypted, so anyone who reads the destination reads it. Off, the file only says whether a schedule, a person or an API key started the backup. On by default.

## Who May Change What

- `settings:read` shows the page, `settings:write` changes it, starts the system tasks and optimizes the database.
- Only a SuperAdmin restores a configuration backup and downloads the database, see [Groups & Permissions](/user-guide/admin/permissions).
- Every change writes an entry to the [Audit Log](/user-guide/admin/audit-log) with the values before and after.
