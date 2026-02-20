# Telegram

Send backup notifications directly to Telegram chats, groups, or channels using a Telegram Bot.

- **Instant push notifications** to any Telegram client (mobile, desktop, web)
- **HTML formatting** with bold text, structured fields, and status emoji
- **Groups & Channels** — Send to private chats, groups, or channels
- **Silent mode** — Optional silent delivery (no notification sound)
- **No server required** — Uses the Telegram Bot API directly

## Configuration

| Field | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| Bot Token | ✅ | — | Telegram Bot API token from [@BotFather](https://t.me/BotFather) |
| Chat ID | ✅ | — | Target chat, group, or channel ID |
| Parse Mode | ❌ | `HTML` | Message format: HTML, MarkdownV2, or Markdown |
| Disable Notification | ❌ | `false` | Send silently (no notification sound) |

## Setup Guide

### 1. Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow the prompts
3. Choose a name and username for your bot
4. BotFather will give you a **Bot Token** — copy it

### 2. Get Your Chat ID

**For private chats:**
1. Send any message to your new bot
2. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser
3. Look for `"chat": { "id": 123456789 }` — that's your Chat ID

**For groups:**
1. Add the bot to your group
2. Send a message in the group
3. Check `/getUpdates` — the chat ID will be negative (e.g., `-1001234567890`)

**For channels:**
1. Add the bot as an **administrator** to your channel
2. The Chat ID is `@your_channel_username` or the numeric ID from `/getUpdates`

### 3. Configure in DBackup

1. Go to **Notifications** → **Add Notification**
2. Select **Telegram**
3. Enter your **Bot Token** and **Chat ID**
4. Click **Test** to verify
5. Save

## Message Format

Success notifications include a ✅ emoji, failure notifications include ❌:

```
✅
Backup Successful

Backup completed successfully

Job: Daily MySQL
Duration: 12s
Size: 45.2 MB
```

## Troubleshooting

| Error | Solution |
| :--- | :--- |
| `401: Unauthorized` | Bot Token is invalid — regenerate via @BotFather |
| `400: Bad Request: chat not found` | Chat ID is wrong, or bot hasn't been messaged yet |
| `403: Forbidden: bot was blocked` | User blocked the bot — unblock it in Telegram |
| `403: bot is not a member` | Add the bot to the group/channel first |
| Messages not appearing | Ensure the bot is an admin in channels |
