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

A job notifies through [notification templates](/user-guide/features/templates#notification-templates):

1. Edit a backup job and open its **Notifications** part
2. Pick a template under **Add a template**, or make one with **New**
3. Save

The part shows each template with its channels, and **Who hears about a run** below it lists every channel of the job with the runs it hears about. See [Creating Jobs](/user-guide/jobs/#notifications).

### Multiple Channels

A template can name several channels, and a job can use several templates, for example Discord for quick team awareness and Email for formal audit records. A channel that is in two templates of the same job gets two messages after a run, which the job form points out.

### Runs

Every channel of a template hears about the runs picked for it:

| Run | When Triggered |
| :--- | :--- |
| **Succeeded** | The backup reached every destination |
| **Partial** | The backup reached some destinations, others failed |
| **Failed** | The backup failed |

::: tip Recommended Setup
| Use Case | Runs |
| :--- | :--- |
| Critical production | Succeeded, Partial and Failed |
| Development | Partial and Failed |
| Compliance | Succeeded, Partial and Failed |
| Team awareness | Partial and Failed |
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

#### Storage Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **Storage Usage Spike** | Storage size changed significantly between snapshots | Enabled |
| **Storage Limit Warning** | Storage usage is approaching the configured size limit | Enabled |
| **Missing Backup Alert** | No new backup was created within the expected time window | Enabled |

These events are configured per destination in the **Storage Explorer**: open the **Destinations** tab, pick the destination and use **Edit alerts**.

#### Update Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **Update Available** | A new version of DBackup is available | Enabled |

Supports **reminder** notifications — resend at a configured interval while the update remains uninstalled.

#### Health & Connectivity Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **Connection Offline** | A source or destination became unreachable after repeated health checks | Enabled |
| **Connection Recovered** | A previously offline source or destination is reachable again | Enabled |
| **Database Version Changed** | A database engine version changed between two health check intervals | Enabled |

Connection Offline supports **reminder** notifications. Health checks run every minute — notifications fire after repeated failures to avoid alerting on transient blips.

To silence these two alerts for one connection, turn off **Health alerts** in the **Behavior** part of its edit form. The health checks keep running. Several databases can be switched at once: tick them on the **Databases** tab of **Connections** and pick **Turn off notifications** under **More**.

#### Integrity Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **Integrity Check Failed** | A scheduled or manual integrity check found one or more checksum mismatches | Enabled |

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

The user's email address is taken from their account profile - no additional configuration needed.

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

1. **Always notify on failure** - Critical for reliability
2. **Consider noise** - Too many success notifications get ignored
3. **Use channels appropriately**:
   - Discord / Slack: Team visibility
   - Teams: Enterprise communication
   - Gotify / ntfy: Self-hosted push alerts, mobile notifications
   - Telegram: Instant push to any Telegram client
   - SMS (Twilio): Critical failure alerts to mobile phones
   - Generic Webhook: Automation and monitoring tools
   - Email: Audit trail, per-user alerts
4. **Test regularly** - Ensure notifications work

### Security

1. **Don't log credentials** - Use environment variables
2. **Secure webhooks** - Don't share webhook URLs publicly
3. **Review recipients** - Only needed parties
4. **SMTP over TLS** - Encrypt email transport

## Next Steps

- [Notification Channels](/user-guide/notifications/) - Detailed setup per channel
- [Creating Jobs](/user-guide/jobs/) - Assign per-job notifications
- [Scheduling](/user-guide/jobs/scheduling) - Automate backups
- [Storage Explorer](/user-guide/features/storage-explorer) - Review backups
