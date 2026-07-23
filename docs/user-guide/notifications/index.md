# Notification Channels

DBackup supports multiple notification channels to keep you informed about backup status, system events, and user activity.

## Supported Channels

| Channel | Type | Best For |
| :--- | :--- | :--- |
| [Discord](/user-guide/notifications/discord) | Webhook | Dev teams, small organizations |
| [Slack](/user-guide/notifications/slack) | Webhook | DevOps teams, workplace communication |
| [Microsoft Teams](/user-guide/notifications/teams) | Webhook | Enterprise, Microsoft 365 environments |
| [Email (SMTP)](/user-guide/notifications/email) | SMTP | Formal alerts, per-user notifications |
| [Telegram](/user-guide/notifications/telegram) | Bot API | Mobile push notifications, small teams |
| [Gotify](/user-guide/notifications/gotify) | REST API | Self-hosted setups, home labs |
| [ntfy](/user-guide/notifications/ntfy) | HTTP/Topic | Push notifications, self-hosted or public |
| [SMS (Twilio)](/user-guide/notifications/twilio-sms) | SMS | Critical failure alerts, on-call escalation |
| [Generic Webhook](/user-guide/notifications/generic-webhook) | HTTP | Custom integrations (PagerDuty, etc.) |

## Adding a Notification Channel

1. Navigate to **Connections** in the sidebar, then the **Notifications** tab
2. Click **Add Notification** → select the channel type
3. Fill in the configuration details
4. Click **Test** to send a test notification
5. Save

## Two Notification Layers

DBackup has two independent notification systems that share the same configured channels:

| Layer | Configured In | Purpose |
| :--- | :--- | :--- |
| **Per-Job Notifications** | Job → Notifications tab | Alerts for individual backup jobs (success, failure, warning) |
| **System Notifications** | Settings → Notifications | System-wide events (login, restore, errors) |

See [Notifications Feature Guide](/user-guide/features/notifications) for details on per-job and system notification configuration.
