# Gotify

Send push notifications to your self-hosted [Gotify](https://gotify.net/) server. Gotify is a lightweight, open-source push notification service — perfect for home lab and self-hosted setups.

## Overview

- 🏠 **Self-Hosted** — Full control over your notification infrastructure
- 📊 **Priority Levels** — Configurable priorities (0–10) with automatic escalation on failures
- 📝 **Markdown Support** — Rich message formatting with structured fields
- 📱 **Mobile Ready** — Android app with real-time push notifications

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Server URL** | Gotify server URL (e.g., `https://gotify.example.com`) | — | ✅ |
| **App Token** | Application token (from Gotify Apps) | — | ✅ |
| **Priority** | Default message priority (0–10) | `5` | ❌ |

## Setup Guide

### 1. Install Gotify

If you don't have Gotify yet, deploy it using Docker:

```yaml
# docker-compose.yml
services:
  gotify:
    image: gotify/server
    ports:
      - "8070:80"
    volumes:
      - gotify-data:/app/data
    environment:
      GOTIFY_DEFAULTUSER_NAME: admin
      GOTIFY_DEFAULTUSER_PASS: admin

volumes:
  gotify-data:
```

### 2. Create an Application Token

1. Open your Gotify web UI (e.g., `http://gotify.example.com`)
2. Go to **Apps** tab
3. Click **Create Application**
4. Set a name (e.g., "DBackup")
5. Copy the generated **App Token**

::: tip Token Security
The App Token is used to send messages only — it cannot read or manage other applications. Keep it secret, but it has limited scope.
:::

### 3. Configure in DBackup

1. Go to **Notifications** in the sidebar
2. Click **Add Notification**
3. Select **Gotify**
4. Enter the Server URL and App Token
5. (Optional) Adjust the default priority
6. Click **Test** to verify
7. Save

### 4. Test the Connection

Click **Test** to send a test notification. You should see a message appear in your Gotify dashboard and on any connected clients.

## Priority Levels

DBackup maps events to Gotify priorities automatically:

| Priority | Level | When Used |
| :--- | :--- | :--- |
| 0 | Min (silent) | — |
| 1–3 | Low | Test notifications |
| 4–7 | Normal | Successful backups (default: 5) |
| 8–10 | High | Failed backups (auto-escalated) |

::: info Priority Behavior
- **Successful** backups use the configured default priority
- **Failed** backups automatically escalate to priority **8** (high)
- **Test** notifications use priority **1** (low)
:::

## Message Format

Notifications are sent as Markdown with structured fields:

```
## ✅ Backup Completed

Backup of "Production MySQL" completed successfully.

**Job:** Production MySQL
**Duration:** 12s
**Size:** 24.5 MB
**Storage:** AWS S3
```

## Troubleshooting

### "401 Unauthorized"
- Verify the App Token is correct and hasn't been revoked
- Check that the token belongs to an **Application**, not a **Client**

### "Connection refused"
- Ensure the Gotify server is running and accessible from the DBackup host
- Check firewall rules and Docker network configuration
- Verify the URL includes the correct port (if not using a reverse proxy)

### Notifications not appearing on mobile
- Ensure the Gotify Android app is connected and the WebSocket connection is active
- Check that the priority is high enough for your client's notification settings
- Some Android manufacturers aggressively kill background apps — add Gotify to battery optimization exceptions

## Resources

- [Gotify Documentation](https://gotify.net/docs/)
- [Gotify GitHub](https://github.com/gotify/server)
- [Gotify Android App](https://github.com/gotify/android)
