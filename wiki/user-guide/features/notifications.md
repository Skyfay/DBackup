# Notifications

Get alerts when backups complete, users log in, restores finish, and more.

## Overview

DBackup has **two notification layers** that work together:

| Layer | Configured In | Purpose |
| :--- | :--- | :--- |
| **Per-Job Notifications** | Job → Notifications tab | Alerts for an individual backup job (success/failure) |
| **System Notifications** | Settings → Notifications | Global alerts for system-wide events (login, restore, errors, etc.) |

Both layers share the same notification channels that you configure under **Notifications** in the main menu.

## Supported Channels

| Channel | Best For |
| :--- | :--- |
| [Discord](/user-guide/notifications/discord) | Team notifications via webhooks |
| [Slack](/user-guide/notifications/slack) | Workplace communication, DevOps teams |
| [Microsoft Teams](/user-guide/notifications/teams) | Enterprise environments, Microsoft 365 |
| [Gotify](/user-guide/notifications/gotify) | Self-hosted push notifications |
| [ntfy](/user-guide/notifications/ntfy) | Topic-based push (self-hosted or public) |
| [Generic Webhook](/user-guide/notifications/generic-webhook) | Custom integrations (PagerDuty, etc.) |
| [Telegram](/user-guide/notifications/telegram) | Instant push to chats, groups, and channels |
| [SMS (Twilio)](/user-guide/notifications/twilio-sms) | Critical alerts to any mobile phone |
| [Email (SMTP)](/user-guide/notifications/email) | Formal alerts, per-user notifications |

For detailed setup instructions for each channel, see the [Notification Channels](/user-guide/notifications/) section.

---

## Per-Job Notifications

Per-job notifications alert you when a specific backup job completes or fails.

### Assigning to a Job

1. Edit a backup job
2. Go to the **Notifications** section
3. Select a notification channel
4. Choose the trigger condition:
   - **Always** – Both success and failure
   - **On Success** – Only when the backup succeeds
   - **On Failure** – Only when the backup fails

### Multiple Channels

You can assign multiple notifications to one job — for example Discord for quick team awareness and Email for formal audit records.

### Notification Conditions

| Condition | When Triggered |
| :--- | :--- |
| **Always** | Every backup completion |
| **On Success** | Only successful backups |
| **On Failure** | Only failed backups |

::: tip Recommended Setup
| Use Case | Condition |
| :--- | :--- |
| Critical production | Always |
| Development | On Failure only |
| Compliance | Always |
| Team awareness | On Failure |
:::

---

## System Notifications

System notifications cover events beyond individual backup jobs: user activity, restores, configuration backups, and system errors.

### Setup

1. Go to **Settings** → **Notifications** tab
2. **Select global channels** – Choose which notification channels receive system alerts by default
3. **Enable events** – Toggle individual events on or off
4. Optionally override channels per event

### Available Events

#### Authentication Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **User Login** | A user logged into the application | Disabled |
| **User Created** | A new user account was created | Disabled |

#### Restore Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **Restore Completed** | A database restore completed successfully | Enabled |
| **Restore Failed** | A database restore failed | Enabled |

#### System Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **Configuration Backup** | System configuration backup was created | Disabled |
| **System Error** | A critical system error occurred | Enabled |

::: info Why no backup events?
Backup success/failure notifications are configured **per-job** (Job → Notifications tab) and are not duplicated in system notifications. This prevents double notifications.
:::

### Global vs. Per-Event Channels

- **Global Channels**: The default channels used for all events that don't have an explicit override.
- **Per-Event Override**: Click the channel button on an event to assign custom channels. A "Custom Channels" badge appears. Click "Reset to Global Channels" to undo.

### Notify User Directly

For **User Login** and **User Created** events, you can optionally send an email directly to the affected user (e.g., a login notification to the user who logged in, or a welcome email to the newly created user).

::: warning Email Channel Required
This feature only works with Email (SMTP) channels. At least one Email channel must be selected for the event.
:::

#### Modes

| Mode | Behavior |
| :--- | :--- |
| **Disabled** | Notification goes only to the configured admin channels |
| **Admin & User** | Notification goes to admin channels AND a direct email to the user |
| **User only** | Notification goes ONLY to the user's email (admin channels are skipped) |

#### How to Configure

1. Go to **Settings** → **Notifications**
2. Enable **User Login** or **User Created**
3. Ensure at least one Email channel is selected
4. A **"Notify user directly"** dropdown appears below the channel selector
5. Choose the desired mode

The user's email address is taken from their account profile — no additional configuration needed.

### Test Notifications

Each event has a **Test** button that sends a sample notification through all selected channels using dummy data. Use this to verify your setup before relying on it.

---

## Troubleshooting

For channel-specific troubleshooting, see the individual channel pages:

- [Discord Troubleshooting](/user-guide/notifications/discord#troubleshooting)
- [Slack Troubleshooting](/user-guide/notifications/slack#troubleshooting)
- [Microsoft Teams Troubleshooting](/user-guide/notifications/teams#troubleshooting)
- [Generic Webhook Troubleshooting](/user-guide/notifications/generic-webhook#troubleshooting)
- [Telegram Troubleshooting](/user-guide/notifications/telegram#troubleshooting)
- [SMS (Twilio) Troubleshooting](/user-guide/notifications/twilio-sms#troubleshooting)
- [Email Troubleshooting](/user-guide/notifications/email#troubleshooting)

---

## Best Practices

### Notification Strategy

1. **Always notify on failure** — Critical for reliability
2. **Consider noise** — Too many success notifications get ignored
3. **Use channels appropriately**:
   - Discord / Slack: Team visibility
   - Teams: Enterprise communication
   - Gotify / ntfy: Self-hosted push alerts, mobile notifications
   - Telegram: Instant push to any Telegram client
   - SMS (Twilio): Critical failure alerts to mobile phones
   - Generic Webhook: Automation and monitoring tools
   - Email: Audit trail, per-user alerts
4. **Test regularly** — Ensure notifications work

### Security

1. **Don't log credentials** — Use environment variables
2. **Secure webhooks** — Don't share webhook URLs publicly
3. **Review recipients** — Only needed parties
4. **SMTP over TLS** — Encrypt email transport

## Next Steps

- [Notification Channels](/user-guide/notifications/) — Detailed setup per channel
- [Creating Jobs](/user-guide/jobs/) — Assign per-job notifications
- [Scheduling](/user-guide/jobs/scheduling) — Automate backups
- [Storage Explorer](/user-guide/features/storage-explorer) — Review backups
