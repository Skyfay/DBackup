# Telegram

Send notifications to Telegram chats, groups, or channels using a Telegram Bot.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Bot token** | `TOKEN` [credential profile](/user-guide/security/credential-profiles) holding the Telegram Bot API token from [@BotFather](https://t.me/BotFather) | - | ✅ |
| **Chat ID** | Target chat, group, or channel ID | - | ✅ |
| **Thread ID** | Topic/Thread ID for Telegram forum supergroups (leave empty for main chat) | - | ❌ |
| **Parse mode** | Message format: `HTML`, `Markdown` | `HTML` | ❌ |
| **Send silently** | No notification sound | `false` | ❌ |

## Setup Guide

1. Open Telegram → search **@BotFather** → send `/newbot` → copy the **Bot Token**
2. Get your **Chat ID**:
   - **Private chat:** Message your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` → find `"chat": { "id": ... }`
   - **Group:** Add bot to group, send a message, check `/getUpdates` (ID is negative, e.g. `-1001234567890`)
   - **Channel:** Add bot as **admin**, use `@channel_username` or numeric ID from `/getUpdates`
3. In DBackup: **Connections** → **Notifications** → **Add New** → **Telegram**
4. Pick or create the credential profile under **Bot token** and enter the Chat ID → **Send test** → **Create channel**

## Troubleshooting

| Error | Solution |
| :--- | :--- |
| `401: Unauthorized` | Bot Token is invalid - regenerate via @BotFather |
| `400: chat not found` | Chat ID is wrong, or bot hasn't been messaged yet |
| `403: bot was blocked` | User blocked the bot - unblock it in Telegram |
| `403: bot is not a member` | Add the bot to the group/channel first |
