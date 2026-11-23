# Generic Webhook

Send JSON payloads to any HTTP endpoint. Use for custom integrations with PagerDuty, Uptime Kuma, or any service that accepts HTTP requests.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Webhook** | `WEBHOOK` [credential profile](/user-guide/security/credential-profiles) holding the target URL and, optionally, the authorization header (e.g., `Bearer token`) | - | ✅ |
| **Method** | `POST`, `PUT`, or `PATCH` | `POST` | ❌ |
| **Content type** | Content-Type header value | `application/json` | ❌ |
| **Extra headers** | Additional headers (one per line, `Key: Value`), stored encrypted like a password | - | ❌ |
| **Payload template** | Custom JSON with `{{variable}}` placeholders | - | ❌ |

## Setup Guide

1. In DBackup: **Connections** → **Channels** → **New channel** → **Generic Webhook**
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

The template is JSON. Every variable but `{{fields}}` goes in as the text of a JSON string, with quotes, backslashes and line breaks escaped, so put it between quotes like the examples below. A name with a quote in it, of a job or a person, then stays text and never adds a key or breaks the payload. `{{fields}}` is a whole JSON array and goes in without quotes.

That holds for a Content-Type that ends in `json`, the default `application/json` among them. With `application/x-www-form-urlencoded` every variable is URL-encoded instead, `{{fields}}` included, so a name never adds a field. With a type that ends in `xml` every variable is escaped for XML, and with any other type, like `text/plain`, the variables go in as they are. A `Content-Type` line in the extra headers counts for this like the Content-Type field.

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
- **API Key:** Use Extra headers: `X-API-Key: your-key`. Once saved, the form shows them as set and keeps them while the field stays blank, type them again to change them
- **Basic Auth:** Set Authorization to `Basic <base64>` (generate with `echo -n "user:pass" | base64`)

## Troubleshooting

### 401 - Unauthorized

Verify the Authorization header value. Check that the token hasn't expired and has the required permissions.

### 400 - Bad Request

Verify your custom template is valid JSON. Check the target service's expected payload format. Ensure Content-Type matches what the service expects.

### Template Variables Not Replaced

Check for typos - variable names are case-sensitive. Only the documented variables above are supported.
