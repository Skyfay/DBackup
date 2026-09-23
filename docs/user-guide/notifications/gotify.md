# Gotify

Send push notifications to your self-hosted [Gotify](https://gotify.net/) server.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Server URL** | Gotify server URL (e.g., `https://gotify.example.com`) | - | ✅ |
| **App token** | `TOKEN` [credential profile](/user-guide/security/credential-profiles) holding the application token (from Gotify → Apps) | - | ✅ |
| **Priority** | Default message priority (0–10) | `5` | ❌ |

## Setup Guide

1. In your Gotify web UI: **Apps** → **Create Application** → copy the **App Token**
2. In DBackup: **Connections** → **Notifications** → **Add New** → **Gotify**
3. Enter the Server URL and pick or create the credential profile under **App token** → **Send test** → **Create channel**

<details>
<summary>Don't have Gotify yet? Quick Docker setup</summary>

```yaml
services:
  gotify:
    image: gotify/server
    ports:
      - "8070:80"
    volumes:
      - gotify-data:/app/data
```

See [Gotify Documentation](https://gotify.net/docs/) for full setup details.

</details>

## Priority Levels

DBackup maps events to Gotify priorities automatically:

| Event | Priority |
| :--- | :--- |
| Test notification | 1 (low) |
| Successful backup | Configured default (5) |
| Failed backup | 8 (high, auto-escalated) |

Priority range: 0 (silent) to 10 (highest). Priorities 8+ trigger high-urgency alerts on clients.

## Troubleshooting

### 401 - Unauthorized

Verify the App Token is correct. Ensure it belongs to an **Application** (not a Client token).

### Connection Refused

Ensure the Gotify server is running and reachable from DBackup. Check firewall rules and verify the URL includes the correct port.

### Notifications Not Appearing on Mobile

Check the Gotify Android app WebSocket connection is active. Some Android manufacturers kill background apps - add Gotify to battery optimization exceptions.
