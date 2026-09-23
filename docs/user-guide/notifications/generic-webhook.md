# Generic Webhook

Send JSON payloads to any HTTP endpoint. Use for custom integrations with PagerDuty, Uptime Kuma, or any service that accepts HTTP requests.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Webhook** | `WEBHOOK` [credential profile](/user-guide/security/credential-profiles) holding the target URL and, optionally, the authorization header (e.g., `Bearer token`) | - | ✅ |
| **Method** | `POST`, `PUT`, or `PATCH` | `POST` | ❌ |
| **Content type** | Content-Type header value | `application/json` | ❌ |
| **Extra headers** | Additional headers (one per line, `Key: Value`) | - | ❌ |
| **Payload template** | Custom JSON with `{{variable}}` placeholders | - | ❌ |

## Setup Guide

1. In DBackup: **Connections** → **Notifications** → **Add New** → **Generic Webhook**
2. Under **Webhook**, pick or create a credential profile holding the target URL and, if needed, the authorization header
3. (Optional) Set the method in the **Connection** part, and extra headers and a payload template in the **Message** part
4. Click **Send test** → **Create channel**

## Default Payload

When no custom template is set, DBackup sends:

```json
{
  "title": "Backup Successful",
  "message": "Job 'Production MySQL' completed successfully",
  "success": true,
  "color": "#00ff00",
  "timestamp": "2026-02-20T14:30:00.000Z",
  "eventType": "backup_success",
  "fields": [
    { "name": "Job", "value": "Production MySQL", "inline": true }
  ]
}
```

## Custom Payload Templates

Use `{{variable}}` placeholders to create your own payload structure:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `{{title}}` | Event title | `Backup Successful` |
| `{{message}}` | Summary message | `Job 'Production' completed` |
| `{{success}}` | Boolean (as string) | `true` / `false` |
| `{{color}}` | Status hex color | `#00ff00` |
| `{{timestamp}}` | ISO 8601 timestamp | `2026-02-20T14:30:00.000Z` |
| `{{eventType}}` | Event type identifier | `backup_success` |
| `{{fields}}` | JSON array of fields | `[{"name":"Job","value":"Prod"}]` |

::: info
Variable names must match the pattern `[a-zA-Z0-9_]+` - no hyphens or special characters.
:::

<details>
<summary>Template examples (PagerDuty, Uptime Kuma, Simple Text)</summary>

**PagerDuty:**
```json
{
  "routing_key": "YOUR_ROUTING_KEY",
  "event_action": "trigger",
  "payload": {
    "summary": "{{title}}: {{message}}",
    "severity": "critical",
    "source": "dbackup"
  }
}
```

**Uptime Kuma (Push):** No template needed - use the push URL directly:
```
https://uptime.example.com/api/push/TOKEN?status=up&msg={{message}}
```

**Simple Text:**
```json
{ "text": "[{{title}}] {{message}}" }
```

</details>

## Authentication

- **Bearer Token:** Set Authorization to `Bearer your-token`
- **API Key:** Use Custom Headers: `X-API-Key: your-key`
- **Basic Auth:** Set Authorization to `Basic <base64>` (generate with `echo -n "user:pass" | base64`)

## Troubleshooting

### 401 - Unauthorized

Verify the Authorization header value. Check that the token hasn't expired and has the required permissions.

### 400 - Bad Request

Verify your custom template is valid JSON. Check the target service's expected payload format. Ensure Content-Type matches what the service expects.

### Template Variables Not Replaced

Check for typos - variable names are case-sensitive. Only the documented variables above are supported.
