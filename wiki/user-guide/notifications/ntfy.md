# ntfy

Send push notifications via [ntfy](https://ntfy.sh/) — a simple, topic-based notification service. Use the public ntfy.sh instance or self-host your own server.

## Overview

- 🌐 **Public or Self-Hosted** — Use `ntfy.sh` for free or run your own server
- 📬 **Topic-Based** — Subscribe to any topic from any device
- 🏷️ **Tags & Priorities** — Automatic emoji tags and priority levels based on event type
- 📱 **Multi-Platform** — Android, iOS, and web clients with push notifications

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Server URL** | ntfy server URL | `https://ntfy.sh` | ✅ |
| **Topic** | Notification topic name | — | ✅ |
| **Access Token** | Bearer token (for protected topics) | — | ❌ |
| **Priority** | Default message priority (1–5) | `3` | ❌ |

## Setup Guide

### Option A: Use ntfy.sh (Public)

The quickest way — no server setup needed:

1. Choose a unique topic name (e.g., `dbackup-myserver-alerts`)
2. Subscribe to the topic on your device:
   - **Android**: Install [ntfy from F-Droid](https://f-droid.org/packages/io.heckel.ntfy/) or Play Store → Add topic
   - **iOS**: Install [ntfy from App Store](https://apps.apple.com/app/ntfy/id1625396347) → Add topic
   - **Web**: Open `https://ntfy.sh/your-topic-name`

::: warning Public Topics
Anyone who knows your topic name can subscribe to it. Use a long, random topic name (e.g., `dbackup-a8f3k2m9x`) or use access tokens on a self-hosted instance.
:::

### Option B: Self-Host ntfy

Deploy ntfy using Docker:

```yaml
# docker-compose.yml
services:
  ntfy:
    image: binwiederhier/ntfy
    command: serve
    ports:
      - "8090:80"
    volumes:
      - ntfy-cache:/var/cache/ntfy
      - ntfy-etc:/etc/ntfy
    environment:
      NTFY_BASE_URL: https://ntfy.example.com

volumes:
  ntfy-cache:
  ntfy-etc:
```

### Configure in DBackup

1. Go to **Notifications** in the sidebar
2. Click **Add Notification**
3. Select **ntfy**
4. Enter the Server URL (default: `https://ntfy.sh`)
5. Enter the Topic name
6. (Optional) Add an access token for protected topics
7. (Optional) Adjust the default priority
8. Click **Test** to verify
9. Save

### Test the Connection

Click **Test** to send a test notification. You should see a message appear on all subscribed devices.

## Priority Levels

DBackup maps events to ntfy priorities automatically:

| Priority | Level | When Used |
| :--- | :--- | :--- |
| 1 | Min | — |
| 2 | Low | Test notifications |
| 3 | Default | Successful backups (default) |
| 4 | High | — |
| 5 | Max/Urgent | Failed backups (auto-escalated) |

::: info Priority Behavior
- **Successful** backups use the configured default priority
- **Failed** backups automatically escalate to priority **5** (max)
- **Test** notifications use priority **2** (low)
:::

## Tags & Emoji

DBackup automatically adds emoji tags based on the event:

| Event | Tags | Emoji |
| :--- | :--- | :--- |
| Backup Success | `white_check_mark`, `backup` | ✅ |
| Backup Failure | `x`, `warning`, `backup` | ❌ ⚠️ |
| Other Events | `backup` | — |

These tags are used by ntfy clients to display emoji icons alongside notifications.

## Message Format

Notifications are sent as plain text with Markdown support:

```
Backup of "Production MySQL" completed successfully.

Job: Production MySQL
Duration: 12s
Size: 24.5 MB
Storage: AWS S3
```

## Authentication

### Public ntfy.sh
No authentication needed — just choose a unique topic name.

### Self-Hosted with Access Control

If you've configured [ntfy access control](https://docs.ntfy.sh/config/#access-control), generate an access token:

```bash
ntfy token add --user=dbackup
```

Then paste the token into the **Access Token** field in DBackup.

## Troubleshooting

### "401 Unauthorized" or "403 Forbidden"
- Verify the access token is correct
- Check that the token has **write** permission to the topic
- Ensure the topic name matches exactly (case-sensitive)

### "Connection refused"
- Ensure the ntfy server is running and accessible from the DBackup host
- Check firewall rules and Docker network configuration
- Verify the URL includes the correct port

### Notifications not appearing on mobile
- Ensure the ntfy app is subscribed to the correct topic with the right server URL
- For self-hosted: verify the server's base URL is correctly configured
- Check that the topic name matches exactly (case-sensitive)

### Using ntfy behind a reverse proxy
- Ensure WebSocket support is enabled in your reverse proxy
- Set the `NTFY_BASE_URL` environment variable to match your public URL

## Resources

- [ntfy Documentation](https://docs.ntfy.sh/)
- [ntfy GitHub](https://github.com/binwiederhier/ntfy)
- [ntfy Android App](https://f-droid.org/packages/io.heckel.ntfy/)
- [ntfy iOS App](https://apps.apple.com/app/ntfy/id1625396347)
