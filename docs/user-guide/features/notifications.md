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

System notifications cover events beyond individual backup jobs: sign-ins, restores, storage, health, updates, and the configuration backup.

### Setup

1. Go to **Settings** → **Notifications**
2. Use **Change** in the **Default channels** strip on top to pick where every event goes unless it has channels of its own
3. Turn events on or off with the switch in their row
4. Click an event to open its **Edit** dialog for its channels, the email to the user, and the reminder

Each row shows where the event goes: the logos and names of its channels marked **default** or **own**, **Off**, or **Nowhere yet** in amber for an event that is on without a channel to go to. The **Notifications** entry in the list of parts shows how many events are on, or in amber how many go nowhere.

**New channel** in the head of the part adds a notification channel without leaving Settings.

### Available Events

#### Sign-in Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **Someone signs in** | A user signed in to DBackup | Off |
| **A user is created** | A new account was made | Off |

#### Restore Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **A restore finished** | A database came back from a backup | On |
| **A restore failed** | A restore stopped with an error | On |

#### System Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **The configuration was backed up** | A configuration backup was made | Off |
| **A system task failed** | A system task stopped with an error, like the configuration backup. Reported once, then again only after the task ran through in between | On |

::: info Why no backup events?
Backup success/failure notifications are configured **per-job** (Job → Notifications tab) and are not duplicated in system notifications. This prevents double notifications.
:::

#### Storage Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **Storage grows fast** | The size of a destination changed a lot between two measurements | On, reminds every day |
| **Storage nearly full** | A destination nears the size limit of its alert | On, reminds every day |
| **A backup is missing** | A destination got nothing new within the time of its alert | On, reminds every day |

These events are configured per destination on the **Backups** page: open the **Destinations** tab, pick the destination and use **Edit alerts**.

#### Update Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **A new version is out** | DBackup found a newer version | On, reminds every 7 days |

#### Health Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **A connection is offline** | A source or destination stopped answering its health checks | On, reminds every day |
| **A connection is back** | An offline source or destination answers again | On |
| **A database version changed** | A server reports another version than at its last check | On |

Health checks run every minute. A connection is only reported offline after repeated failures, so a short blip stays quiet.

To silence the offline and back alerts for one connection, turn off **Health alerts** in the **Behavior** part of its edit form. The health checks keep running. Several databases can be switched at once: tick them on the **Databases** tab of **Connections** and pick **Turn off notifications** under **More**.

#### Integrity Events

| Event | Description | Default |
| :--- | :--- | :--- |
| **An integrity check failed** | A backup no longer matches the checksum saved with it | On |

### Default and Own Channels

- **The default channels**: every event goes here unless it has its own. Change them with **Change** in the strip on top of the list. With none picked, only events with channels of their own send anything.
- **Its own channels**: **Send it to** in the **Edit** dialog of an event picks between the default channels and channels of its own. An event with its own channels needs at least one of them ticked, and its row says **own**.

### Change Several Events at Once

Tick events in the list, and the bar that appears offers:

| Action | What it does |
| :--- | :--- |
| **Send to** | Sends every ticked event to the default channels, or to the same own channels |
| **Switch on** | Turns every ticked event on |
| **Switch off** | Turns every ticked event off |

The filter above the list shows **All**, **On**, **Off**, and **Own channels**, and **Nowhere** while an event is on without a channel to go to.

### Tell the User Too

**Someone signs in** and **A user is created** can also email the user themselves, like a sign-in notice to the person who signed in or a welcome email to a new account. **Tell the user too** in the **Edit** dialog offers:

| Choice | Behavior |
| :--- | :--- |
| **Only the channels** | The notification goes only to the channels of the event |
| **The channels and the user** | The channels get it, and the user gets an email too |
| **Only the user** | Only the user gets an email, the channels are skipped |

::: warning Email Channel Required
The email to the user goes out through the Email (SMTP) channels among the channels of the event. Without one, the user gets nothing.
:::

The address comes from the account of the user.

### Reminders

Some events last, like a connection that stays offline. While they last, they send once more after a set time, and they stop once the problem is over. **Remind while it lasts** in the **Edit** dialog picks the default of the event, off, or every 6 hours up to every 7 days. The **Reminder** column shows what each event does.

| Event | Default reminder |
| :--- | :--- |
| Storage events, **A connection is offline** | Every day |
| **A new version is out** | Every 7 days |

### Send a Test

**Send a test** in the row of an event, in its menu, or in its **Edit** dialog sends a sample notification with made-up data to the channels of the event. It also works while the event is off. The message says how many channels took it, and a test that reached nobody counts as failed.

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
- [Backups](/user-guide/features/backups) - Review backups
