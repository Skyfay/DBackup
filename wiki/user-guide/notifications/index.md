# Notification Channels

DBackup supports multiple notification channels to keep you informed about backup status, system events, and user activity. Choose based on your team's communication platform and requirements.

## Supported Channels

| Channel | Type | Best For |
| :--- | :--- | :--- |
| [Discord](/user-guide/notifications/discord) | Webhook | Team chat, gaming communities, dev teams |
| [Slack](/user-guide/notifications/slack) | Webhook | Workplace communication, DevOps teams |
| [Microsoft Teams](/user-guide/notifications/teams) | Webhook | Enterprise environments, Microsoft 365 |
| [Gotify](/user-guide/notifications/gotify) | REST API | Self-hosted setups, home labs |
| [ntfy](/user-guide/notifications/ntfy) | HTTP/Topic | Self-hosted or public push notifications |
| [Generic Webhook](/user-guide/notifications/generic-webhook) | HTTP | Custom integrations (PagerDuty, etc.) |
| [Email (SMTP)](/user-guide/notifications/email) | SMTP | Formal alerts, per-user notifications, audit trail |

## Choosing a Channel

### Discord

**Pros:**
- Quick setup (just a webhook URL)
- Rich embeds with colors and structured fields
- Great for small teams and dev communities

**Cons:**
- Not suitable for formal/enterprise notifications
- Webhook URLs can be leaked if not handled carefully

**Best for:** Development teams, home lab admins, small organizations.

### Slack

**Pros:**
- Industry-standard workplace messaging
- Block Kit for rich, interactive formatting
- Channel override for routing notifications

**Cons:**
- Requires Slack workspace access
- Webhook URLs tied to specific channels

**Best for:** DevOps teams, engineering organizations, startups.

### Microsoft Teams

**Pros:**
- Native Microsoft 365 integration
- Adaptive Cards for structured content
- Enterprise-grade compliance

**Cons:**
- Webhook setup requires Power Automate / Workflows
- More complex setup than Discord or Slack

**Best for:** Enterprise environments, Microsoft 365 organizations.

### Gotify

**Pros:**
- Self-hosted — full control over notification infrastructure
- Priority levels with automatic escalation on failures
- Markdown formatting
- Android app with real-time push

**Cons:**
- Requires running a Gotify server
- No native iOS app (web client only)

**Best for:** Self-hosted enthusiasts, home lab admins, privacy-conscious users.

### ntfy

**Pros:**
- Works without any server setup (public ntfy.sh)
- Topic-based — subscribe from any device instantly
- Android, iOS, and web clients
- Can also be self-hosted

**Cons:**
- Public topics are not private (use random topic names or self-host)
- Simpler formatting than rich embed platforms

**Best for:** Quick setup, mobile push notifications, self-hosted or public usage.

### Generic Webhook

**Pros:**
- Works with any HTTP endpoint
- Customizable payload templates
- Supports authentication headers

**Cons:**
- Requires endpoint setup on the receiving end
- No rich formatting (plain JSON)

**Best for:** Self-hosted notification services (Gotify, ntfy), monitoring tools (PagerDuty, Uptime Kuma), custom integrations.

### Email (SMTP)

**Pros:**
- Universal — everyone has email
- HTML formatting with status colors
- Per-user delivery for login/account events
- Audit trail

**Cons:**
- Requires SMTP server access
- May land in spam if not configured properly

**Best for:** Formal alerts, compliance requirements, per-user notifications.

## Adding a Notification Channel

1. Navigate to **Notifications** in the sidebar
2. Click **Add Notification**
3. Select the channel type from the adapter picker
4. Fill in the configuration details
5. Click **Test** to send a test notification
6. Save the configuration

## Two Notification Layers

DBackup has two independent notification systems that share the same channels:

| Layer | Configured In | Purpose |
| :--- | :--- | :--- |
| **Per-Job Notifications** | Job → Notifications tab | Alerts for individual backup jobs |
| **System Notifications** | Settings → Notifications | System-wide events (login, restore, errors) |

See [Notifications Feature Guide](/user-guide/features/notifications) for detailed configuration of per-job and system notifications.

## Next Steps

Choose your notification channel for detailed setup instructions:

- [Discord](/user-guide/notifications/discord) — Webhook-based rich embeds
- [Slack](/user-guide/notifications/slack) — Block Kit formatted messages
- [Microsoft Teams](/user-guide/notifications/teams) — Adaptive Card notifications
- [Gotify](/user-guide/notifications/gotify) — Self-hosted push notifications
- [ntfy](/user-guide/notifications/ntfy) — Topic-based push notifications
- [Generic Webhook](/user-guide/notifications/generic-webhook) — Custom JSON payloads
- [Email (SMTP)](/user-guide/notifications/email) — HTML email via SMTP
