# Microsoft Teams

Send Adaptive Card notifications to Microsoft Teams channels via Power Automate Workflows.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Webhook** | `WEBHOOK` [credential profile](/user-guide/security/credential-profiles) holding the Teams Workflow webhook URL | - | ✅ |

## Setup Guide

1. Open the target **Teams channel** → **⋯ (More options)** → **Workflows**
2. Search for **"Post to a channel when a webhook request is received"**
3. Follow the setup wizard - select team and channel → **Add workflow**
4. Copy the generated **Webhook URL**
5. In DBackup: **Connections** → **Notifications** → **Add New** → **Microsoft Teams**
6. Under **Webhook**, pick or create a credential profile holding the webhook URL → **Send test** → **Create channel**

::: warning URL Format
The URL should start with `https://prod-XX.westeurope.logic.azure.com:443/workflows/...` or `https://TENANT.webhook.office.com/webhookb2/...`. The legacy Office 365 Connector method is deprecated.
:::

## Message Format

Notifications use Adaptive Cards v1.4 with colored status indicators:

| Status | Adaptive Card Color |
| :--- | :--- |
| Success | `Good` (green) |
| Failure | `Attention` (red) |
| Warning | `Warning` (yellow) |
| Informational | `Accent` (blue) |

Each card includes title, summary, structured fields (FactSet), and timestamp.

## Troubleshooting

### 400 - Bad Request

Verify the URL is from a Power Automate Workflow (not a deprecated Office 365 Connector). Ensure the workflow is active and the channel still exists.

### 401/403 - Unauthorized

The workflow may have expired or the creator lost channel access. Recreate the workflow in Power Automate.

### Card Appears as Raw JSON

Ensure the workflow uses the **"Post to a channel when a webhook request is received"** template. Recreate the workflow if needed.
