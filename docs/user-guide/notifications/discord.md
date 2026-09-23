# Discord

Send rich embed notifications to Discord channels via webhooks.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Webhook** | `WEBHOOK` [credential profile](/user-guide/security/credential-profiles) holding the Discord webhook URL | - | ✅ |
| **Display name** | Bot display name in Discord | `Backup Manager` | ❌ |
| **Avatar URL** | Bot avatar image URL | Discord default | ❌ |

## Setup Guide

1. In Discord: **Server Settings** → **Integrations** → **Webhooks** → **New Webhook**
2. Choose the target channel → **Copy Webhook URL**
3. In DBackup: **Connections** → **Notifications** → **Add New** → **Discord Webhook**
4. Under **Webhook**, pick or create a credential profile holding the webhook URL
5. Click **Send test** → verify the message appears in Discord → **Create channel**

::: tip
Create a dedicated `#backups` channel to keep notifications separate from general chat.
:::

## Message Format

Notifications use rich embeds with colored sidebars:

| Color | Meaning |
| :--- | :--- |
| 🟢 Green | Success (backup complete, restore finished) |
| 🔴 Red | Failure (backup/restore failed, system error) |
| 🔵 Blue | Informational (user login) |
| 🟣 Purple | System (config backup) |

Each embed includes title, description, structured fields (job name, duration, size), and timestamp.

## Troubleshooting

### 401 - Invalid Webhook Token

Verify the webhook URL is complete. Check the webhook hasn't been deleted in Discord → Server Settings → Integrations.

### 429 - Rate Limited

Too many messages in a short period. Reduce notification frequency - avoid "Always" on high-frequency jobs.

### 404 - Unknown Webhook

The webhook or channel was deleted. Create a new webhook and update the configuration.
