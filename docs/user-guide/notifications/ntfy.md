# ntfy

Send push notifications via [ntfy](https://ntfy.sh/) - a simple, topic-based notification service. Use the public `ntfy.sh` instance or self-host your own server.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Server URL** | ntfy server URL | `https://ntfy.sh` | ❌ |
| **Topic** | Notification topic name | - | ✅ |
| **Access token** | `TOKEN` [credential profile](/user-guide/security/credential-profiles) holding the bearer token (for protected topics) | - | ❌ |
| **Priority** | Default message priority (1–5) | `3` | ❌ |

## Setup Guide

1. Choose a **unique topic name** (e.g., `dbackup-a8f3k2m9x`)
2. Subscribe to the topic on your device ([Android](https://f-droid.org/packages/io.heckel.ntfy/), [iOS](https://apps.apple.com/app/ntfy/id1625396347), or [Web](https://ntfy.sh/))
3. In DBackup: **Connections** → **Notifications** → **Add New** → **ntfy**
4. Enter Server URL and Topic → **Send test** → **Create channel**

::: warning Public Topics
Anyone who knows your topic name can subscribe to it. Use a long, random name or self-host ntfy with access tokens.
:::

<details>
<summary>Self-hosting ntfy with Docker</summary>

```yaml
services:
  ntfy:
    image: binwiederhier/ntfy
    command: serve
    ports:
      - "8090:80"
    volumes:
      - ntfy-cache:/var/cache/ntfy
    environment:
      NTFY_BASE_URL: https://ntfy.example.com
```

For access control, generate a token: `ntfy token add --user=dbackup` and paste it into the **Access Token** field.

</details>

## Priority Levels

DBackup maps events to ntfy priorities automatically:

| Event | Priority |
| :--- | :--- |
| Test notification | 2 (low) |
| Successful backup | Configured default (3) |
| Failed backup | 5 (max, auto-escalated) |

## Troubleshooting

### 401/403 - Unauthorized

Verify the access token is correct and has **write** permission to the topic. Topic names are case-sensitive.

### Connection Refused

Ensure the ntfy server is reachable from DBackup. Check firewall rules and verify the URL includes the correct port.

### Notifications Not Appearing on Mobile

Verify the ntfy app is subscribed to the exact same topic name and server URL. For self-hosted: ensure WebSocket support is enabled in your reverse proxy.
