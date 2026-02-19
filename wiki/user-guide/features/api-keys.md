# API Keys

Manage API keys to authenticate external tools, scripts, and CI/CD pipelines with the DBackup API.

## Overview

API keys provide a secure alternative to session-based authentication for programmatic access. Each key:

- Has a unique prefix (`dbackup_`) for easy identification
- Is scoped to specific **permissions** (same RBAC model as groups)
- Can optionally have an **expiration date**
- Can be **enabled/disabled** without deletion
- Supports **rotation** for key cycling

> **Security**: API keys are stored as SHA-256 hashes. The raw key is only shown once — immediately after creation or rotation.

## Creating an API Key

1. Navigate to **Access Management → API Keys** tab
2. Click **Create API Key**
3. Fill in the form:

| Field | Required | Description |
| :--- | :--- | :--- |
| **Name** | Yes | Descriptive label (e.g., "CI/CD Pipeline", "Monitoring Script") |
| **Expiration Date** | No | Optional expiry date. Leave empty for a key that never expires. |
| **Permissions** | Yes | Select at least one permission the key should have. |

4. Click **Create Key**
5. **Copy the key immediately** — it won't be shown again

### Recommended Permission Sets

| Use Case | Permissions |
| :--- | :--- |
| Trigger backups only | `jobs:execute` |
| Trigger + monitor | `jobs:execute`, `history:read` |
| Full automation | `jobs:read`, `jobs:execute`, `history:read`, `storage:read` |
| Read-only monitoring | `jobs:read`, `history:read` |

## Managing API Keys

### Enable / Disable

Temporarily disable a key without deleting it:
- Open the **actions menu** (⋯) on the key row
- Select **Disable** or **Enable**

Disabled keys will receive a `401 Unauthorized` response.

### Rotate Key

Generate a new secret while keeping the same name, permissions, and settings:
1. Open the **actions menu** (⋯) on the key row
2. Select **Rotate Key**
3. Copy the new key immediately

The old key becomes invalid immediately.

### Delete Key

Permanently remove a key:
1. Open the **actions menu** (⋯) on the key row
2. Select **Delete**
3. Confirm the deletion

## Authentication

Include the API key in the `Authorization` header:

```
Authorization: Bearer dbackup_your_api_key_here
```

### Example Request

```bash
curl -X POST "https://your-instance.com/api/jobs/JOB_ID/run" \
  -H "Authorization: Bearer dbackup_abc123..."
```

### Error Responses

| Status | Reason |
| :--- | :--- |
| `401 Unauthorized` | Invalid, disabled, or expired key |
| `403 Forbidden` | Key lacks required permission |

## Permissions Reference

API keys use the same permission system as user groups. The key can only perform actions allowed by its assigned permissions:

| Permission | Description |
| :--- | :--- |
| `jobs:read` | List and view backup jobs |
| `jobs:write` | Create, edit, delete jobs |
| `jobs:execute` | Trigger backup jobs |
| `history:read` | View execution history and poll status |
| `sources:read` | List database sources |
| `destinations:read` | List storage destinations |
| `storage:read` | Browse stored backups |
| `storage:write` | Delete stored backups |
| `notifications:read` | List notification channels |
| `vault:read` | List encryption profiles |

> **Note**: Unlike user sessions, API keys do **not** inherit SuperAdmin privileges. They can only use explicitly assigned permissions.

## Audit Trail

All API key operations are logged in the **Audit Log**:

- Key creation, deletion, rotation
- Enable/disable toggles
- Permission changes
- API requests made with the key (logged as `trigger: "api"`)

The audit log records which API key was used for each request, enabling full traceability.

## Best Practices

1. **Least privilege**: Only assign permissions the key actually needs
2. **Set expiration dates** for temporary or CI/CD keys
3. **Use descriptive names** to identify the key's purpose
4. **Rotate keys regularly** — especially after team changes
5. **Monitor the audit log** for unexpected API key usage
6. **Disable before deleting** if you want to test the impact first
