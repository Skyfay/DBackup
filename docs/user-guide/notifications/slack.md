# Slack

Send formatted notifications to Slack channels using Incoming Webhooks with Block Kit formatting.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Webhook** | `WEBHOOK` [credential profile](/user-guide/security/credential-profiles) holding the Slack Incoming Webhook URL | - | ✅ |
| **Channel** | Override channel (e.g., `#backups`) | Webhook default | ❌ |
| **Display name** | Bot display name | `DBackup` | ❌ |
| **Icon emoji** | Bot icon emoji (e.g., `:shield:`) | Default | ❌ |

## Setup Guide

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. In the left sidebar → **Incoming Webhooks** → toggle **On**
3. Click **Add New Webhook to Workspace** → select the target channel → **Allow**
4. Copy the **Webhook URL** (starts with `https://hooks.slack.com/services/...`)
5. In DBackup: **Connections** → **Notifications** → **Add New** → **Slack Webhook**
6. Under **Webhook**, pick or create a credential profile holding the webhook URL → **Send test** → **Create channel**

## Message Format

Notifications use Block Kit with color-coded attachments:

| Color | Meaning |
| :--- | :--- |
| 🟢 Green (`#00ff00`) | Success |
| 🔴 Red (`#ff0000`) | Failure |
| 🔵 Blue (`#3b82f6`) | Informational |

Each message includes header, summary, structured fields (job name, duration, size), and timestamp.

## Channel Override

The **Channel** field overrides the default channel configured in the webhook (e.g., `#production-alerts` or `@username` for DMs).

::: warning
Channel override only works if the Slack app has the `chat:write` scope. Standard Incoming Webhooks without this scope always send to the configured channel only.
:::

## Troubleshooting

### 403 - invalid_token

Verify the webhook URL is complete. Check the Slack app hasn't been uninstalled, or regenerate the webhook.

### 404 - channel_not_found

The channel override target doesn't exist or is archived. Verify the name with `#` prefix. For private channels, invite the bot first.

### 403 - team_disabled

The Slack app was removed. Reinstall it in your workspace settings.
