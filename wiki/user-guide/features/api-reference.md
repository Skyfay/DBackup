# API Reference

Complete reference for the DBackup REST API. Use these endpoints to automate backups, monitor executions, manage resources, and integrate with external systems.

## Base URL

```
https://your-dbackup-instance.com/api
```

## Authentication

DBackup supports two authentication methods:

### Session Authentication (Browser)

Used automatically when logged in via the web UI. Session cookies are sent with each request.

### API Key Authentication (Programmatic)

For scripts, CI/CD pipelines, and external integrations. Create an API key under **Access Management → API Keys**.

```
Authorization: Bearer dbackup_your_api_key
```

> **Note:** API keys do not inherit SuperAdmin privileges. Only explicitly assigned permissions are available.

### Error Responses

| Status | Description |
| :--- | :--- |
| `401 Unauthorized` | Missing, invalid, disabled, or expired credentials |
| `403 Forbidden` | Valid credentials but insufficient permissions |
| `404 Not Found` | Resource does not exist |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Unexpected server error |

**Standard error format:**
```json
{
  "error": "Human-readable error message"
}
```

## Rate Limits

| Request Type | Limit |
| :--- | :--- |
| Authentication (login, etc.) | 5/min per IP |
| GET requests | 100/min per IP |
| POST / PUT / DELETE | 20/min per IP |

## Endpoints

### Table of Contents

| Section | Endpoints |
| :--- | :--- |
| [Jobs](#jobs) | CRUD + trigger backups |
| [Executions](#executions) | Poll execution status |
| [History](#history) | List execution history |
| [Sources & Destinations](#sources--destinations) | Manage database and storage adapters |
| [Connection Testing](#connection-testing) | Test adapter connections |
| [Storage Explorer](#storage-explorer) | Browse, download, delete, restore backups |
| [Vault](#vault) | Encryption profiles & recovery kits |
| [Settings](#settings) | System tasks configuration |
| [Health](#health) | Health check (public) |

## Jobs

### List Jobs

```
GET /api/jobs
```

**Permission:** `jobs:read`

**Response:**
```json
[
  {
    "id": "clx1abc...",
    "name": "Daily MySQL Backup",
    "schedule": "0 2 * * *",
    "enabled": true,
    "sourceId": "...",
    "destinationId": "...",
    "compression": "GZIP",
    "encryptionProfileId": "...",
    "retention": { ... },
    "source": { "name": "Production DB", "type": "database" },
    "destination": { "name": "S3 Bucket", "type": "storage" },
    "encryptionProfile": { "name": "Default Key" },
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

### Create Job

```
POST /api/jobs
```

**Permission:** `jobs:write`

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | string | Yes | Display name for the job |
| `schedule` | string | Yes | Cron expression (e.g., `0 2 * * *`) |
| `sourceId` | string | Yes | Database source adapter ID |
| `destinationId` | string | Yes | Storage destination adapter ID |
| `enabled` | boolean | No | Whether job is active (default: `true`) |
| `compression` | string | No | `"NONE"`, `"GZIP"`, or `"ZSTD"` |
| `encryptionProfileId` | string | No | Vault encryption profile ID |
| `notificationIds` | string[] | No | Notification channel IDs |
| `notificationEvents` | object | No | Which events trigger notifications |
| `retention` | object | No | Retention policy (GFS) configuration |
| `databases` | string[] | No | Specific databases to back up |

**Response:** `201 Created`
```json
{
  "id": "clx1abc...",
  "name": "Daily MySQL Backup",
  ...
}
```

### Update Job

```
PUT /api/jobs/:id
```

**Permission:** `jobs:write`

**Path Parameters:**

| Parameter | Description |
| :--- | :--- |
| `id` | Job ID |

**Request Body:** Same fields as Create Job (all optional for partial update).

**Response:** Updated job object.

### Delete Job

```
DELETE /api/jobs/:id
```

**Permission:** `jobs:write`

**Response:**
```json
{ "success": true }
```

### Trigger Job

Manually trigger a backup job execution.

```
POST /api/jobs/:id/run
```

**Permission:** `jobs:execute`

**Response:**
```json
{
  "success": true,
  "executionId": "clx1abc...",
  "message": "Job queued successfully"
}
```

**Notes:**
- The job is added to the execution queue. If the max concurrent jobs limit is reached, it will remain in `Pending` status until a slot is available.
- Use the `executionId` to [poll execution status](#get-execution).
- When triggered via API key, the audit log records `trigger: "api"` and the API key ID.

**Example:**
```bash
curl -X POST "https://your-instance.com/api/jobs/JOB_ID/run" \
  -H "Authorization: Bearer dbackup_your_api_key"
```

## Executions

### Get Execution

Poll the status of a running or completed execution.

```
GET /api/executions/:id
```

**Permission:** `history:read`

**Path Parameters:**

| Parameter | Description |
| :--- | :--- |
| `id` | Execution ID |

**Query Parameters:**

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `includeLogs` | boolean | `false` | Include full execution log entries |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clx1abc...",
    "jobId": "clx0xyz...",
    "jobName": "Daily MySQL Backup",
    "type": "Backup",
    "status": "Running",
    "progress": 45,
    "stage": "Uploading",
    "startedAt": "2025-01-15T10:30:00.000Z",
    "endedAt": null,
    "duration": null,
    "size": null,
    "path": null,
    "error": null,
    "logs": []
  }
}
```

**Execution Status Values:**

| Status | Description |
| :--- | :--- |
| `Pending` | Queued, waiting for an execution slot |
| `Running` | Currently executing |
| `Success` | Completed successfully |
| `Failed` | Execution failed (see `error` field) |

**Example (polling loop):**
```bash
curl "https://your-instance.com/api/executions/EXECUTION_ID" \
  -H "Authorization: Bearer dbackup_your_api_key"
```

## History

### List Execution History

```
GET /api/history
```

**Permission:** `history:read`

**Response:** Array of the last 100 executions (newest first), including job name.

```json
[
  {
    "id": "...",
    "jobId": "...",
    "type": "Backup",
    "status": "Success",
    "startedAt": "2025-01-15T02:00:00.000Z",
    "endedAt": "2025-01-15T02:03:45.000Z",
    "job": { "name": "Daily MySQL Backup" }
  }
]
```

## Sources & Destinations

Sources (databases), destinations (storage), and notification channels are all managed through the unified **Adapters** API.

### List Adapters

```
GET /api/adapters?type={type}
```

**Query Parameters:**

| Parameter | Values | Permission |
| :--- | :--- | :--- |
| `type=database` | MySQL, PostgreSQL, MongoDB, etc. | `sources:read` |
| `type=storage` | Local, S3, SFTP, Google Drive, etc. | `destinations:read` |
| `type=notification` | Email, Discord, etc. | `notifications:read` |

**Response:**
```json
[
  {
    "id": "clx1abc...",
    "name": "Production MySQL",
    "type": "database",
    "adapterId": "mysql",
    "config": {
      "host": "db.example.com",
      "port": 3306,
      "username": "backup_user",
      "password": "decrypted_value"
    },
    "metadata": { "version": "8.0.35", "status": "healthy" }
  }
]
```

> Config fields are automatically decrypted in the response.

### Create Adapter

```
POST /api/adapters
```

**Permission:** Depends on `type`:
- `database` → `sources:write`
- `storage` → `destinations:write`
- `notification` → `notifications:write`

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | string | Yes | Display name |
| `type` | string | Yes | `"database"`, `"storage"`, or `"notification"` |
| `adapterId` | string | Yes | Adapter type (see table below) |
| `config` | object | Yes | Adapter-specific configuration |

**Available Adapter IDs:**

| Type | Adapter IDs |
| :--- | :--- |
| Database | `mysql`, `postgres`, `mongodb`, `mssql` |
| Storage | `local-fs`, `s3`, `sftp`, `google-drive`, `onedrive`, `dropbox` |
| Notification | `email`, `discord` |

**Response:** `201 Created` — Created adapter config.

> Sensitive config fields (passwords, keys) are automatically encrypted before storage.

### Update Adapter

```
PUT /api/adapters/:id
```

**Permission:** Same dynamic rules as Create.

**Request Body:**

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | string | Updated display name |
| `config` | object | Updated configuration (merged with existing) |

**Response:** Updated adapter config.

### Delete Adapter

```
DELETE /api/adapters/:id
```

**Permission:** Same dynamic rules as Create.

**Response:**
```json
{ "success": true }
```

**Error:** Returns `400` if the adapter is still referenced by active jobs.

### Health Check History

```
GET /api/adapters/:id/health-history
```

**Permission:** `sources:read`

**Query Parameters:**

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `limit` | number | 100 | Max entries to return |
| `from` | string (ISO 8601) | — | Filter from this date |

**Response:**
```json
{
  "history": [
    {
      "id": "...",
      "status": "healthy",
      "latencyMs": 45,
      "createdAt": "2025-01-15T10:00:00.000Z",
      "error": null
    }
  ],
  "stats": {
    "uptime": 99.5,
    "avgLatency": 42,
    "totalChecks": 1440
  }
}
```

## Connection Testing

### Test Connection

```
POST /api/adapters/test-connection
```

**Permission:** Depends on adapter type (`sources:read`, `destinations:read`, or `notifications:read`).

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `adapterId` | string | Yes | Adapter type (e.g., `mysql`) |
| `config` | object | Yes | Connection configuration |
| `configId` | string | No | Existing adapter ID (updates metadata on success) |

**Response:**
```json
{ "success": true, "message": "Connection successful", "version": "8.0.35" }
```

### List Databases

```
POST /api/adapters/access-check
```

**Permission:** Same as test-connection.

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `adapterId` | string | Yes | Database adapter type |
| `config` | object | Yes | Connection configuration |

**Response:**
```json
{ "success": true, "databases": ["mydb", "app_production", "analytics"] }
```

### Database Statistics

```
POST /api/adapters/database-stats
```

**Permission:** `sources:read`

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `adapterId` | string | Conditional | Adapter type (required if no `sourceId`) |
| `config` | object | Conditional | Connection config (required if no `sourceId`) |
| `sourceId` | string | Conditional | Existing source adapter ID (alternative) |

**Response:**
```json
{
  "success": true,
  "databases": [
    { "name": "mydb", "sizeBytes": 1073741824, "tableCount": 42 },
    { "name": "analytics", "sizeBytes": 5368709120, "tableCount": 15 }
  ]
}
```

## Storage Explorer

### List Backup Files

```
GET /api/storage/:id/files
```

**Permission:** `storage:read`

**Path Parameters:**

| Parameter | Description |
| :--- | :--- |
| `id` | Storage destination adapter ID |

**Query Parameters:**

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `typeFilter` | string | Filter by file type |

**Response:** Array of backup files with metadata (size, timestamps, encryption info).

### Delete Backup File

```
DELETE /api/storage/:id/files
```

**Permission:** `storage:delete`

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `path` | string | Yes | File path to delete |

**Response:**
```json
{ "success": true }
```

### Download Backup

```
GET /api/storage/:id/download?file={path}
```

**Permission:** `storage:download`

**Query Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `file` | string | Yes | Backup file path |
| `decrypt` | boolean | No | Auto-decrypt the file (default: `true`) |

**Response:** Binary file stream with `Content-Disposition: attachment` header.

### Generate Download URL

Create a temporary, single-use download link (works without authentication).

```
POST /api/storage/:id/download-url
```

**Permission:** `storage:download`

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `file` | string | Yes | Backup file path |
| `decrypt` | boolean | No | Auto-decrypt (default: `true`) |

**Response:**
```json
{
  "success": true,
  "url": "https://your-instance.com/api/storage/public-download?token=...",
  "expiresIn": "5 minutes",
  "singleUse": true
}
```

**Example (download via curl/wget):**
```bash
# Step 1: Generate URL
URL=$(curl -s -X POST "https://your-instance.com/api/storage/STORAGE_ID/download-url" \
  -H "Authorization: Bearer dbackup_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"file": "backups/mydb_2025-01-15.sql.gz.enc"}' \
  | jq -r '.url')

# Step 2: Download (no auth needed)
wget -O backup.sql.gz "$URL"
```

### Public Download

```
GET /api/storage/public-download?token={token}
```

**Permission:** None (token-validated)

**Query Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `token` | string | Yes | Single-use download token from `/download-url` |

**Response:** Binary file stream. Token is consumed on use.

### Restore Backup

Start an asynchronous restore process.

```
POST /api/storage/:id/restore
```

**Permission:** `storage:restore`

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `file` | string | Yes | Backup file path |
| `targetSourceId` | string | Yes | Target database adapter ID |
| `targetDatabaseName` | string | No | Override target DB name (single-DB backups) |
| `databaseMapping` | object | No | Rename mapping for multi-DB backups (`{ "old_name": "new_name" }`) |
| `privilegedAuth` | object | No | Elevated credentials (`{ "user": "...", "password": "..." }`) |

**Response:** `202 Accepted`
```json
{
  "success": true,
  "executionId": "clx1abc...",
  "message": "Restore started"
}
```

**Notes:**
- Restore runs as a background process. Poll the `executionId` via [Get Execution](#get-execution).
- `privilegedAuth` provides elevated credentials for `CREATE DATABASE` permissions.
- Version guard prevents restoring newer dump formats to older database servers.

### Analyze Backup

Extract database names from a backup file (for restore UI).

```
POST /api/storage/:id/analyze
```

**Permission:** `storage:restore`

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `file` | string | Yes | Backup file path |
| `type` | string | No | Database type hint (e.g., `mysql`) |

**Response:**
```json
{ "databases": ["mydb", "app_production"] }
```

### Storage Usage History

```
GET /api/storage/:id/history
```

**Permission:** `storage:read`

**Query Parameters:**

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `days` | number | 30 | Number of days (max: 365) |

**Response:**
```json
{
  "success": true,
  "data": [
    { "totalSize": 1073741824, "fileCount": 42, "createdAt": "2025-01-15T00:00:00.000Z" }
  ]
}
```

## Vault

### Download Recovery Kit

Download a ZIP file containing the master encryption key and helper scripts for offline decryption.

```
GET /api/vault/:id/recovery-kit
```

**Permission:** `vault:write`

**Response:** `application/zip` binary download containing:
- `master.key` — Hex-encoded encryption key
- `decrypt_backup.js` — Node.js decryption script
- `decrypt_drag_drop_windows.bat` — Windows drag & drop helper
- `decrypt_linux_mac.sh` — Linux/macOS helper script
- `README.txt` — Usage instructions

> This is a sensitive operation. An audit log entry is created.

## Settings

### List System Tasks

```
GET /api/settings/system-tasks
```

**Permission:** `settings:read`

**Response:**
```json
[
  {
    "id": "health-check",
    "label": "Health Check",
    "description": "Periodically check database connections",
    "schedule": "*/5 * * * *",
    "runOnStartup": true,
    "enabled": true
  }
]
```

### Update System Task

```
POST /api/settings/system-tasks
```

**Permission:** `settings:write`

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `taskId` | string | Yes | System task ID |
| `schedule` | string | No | Updated cron expression |
| `runOnStartup` | boolean | No | Run on server start |
| `enabled` | boolean | No | Enable/disable the task |

**Response:**
```json
{ "success": true }
```

### Run System Task Now

```
PUT /api/settings/system-tasks
```

**Permission:** `settings:write`

**Request Body:**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `taskId` | string | Yes | System task ID to execute |

**Response:**
```json
{ "success": true, "message": "Task started" }
```

## Health

### Health Check

Public endpoint for monitoring and Docker `HEALTHCHECK`.

```
GET /api/health
```

**Permission:** None (public)

**Response:**
```json
{
  "status": "healthy",
  "uptime": 86400,
  "timestamp": "2025-01-15T10:00:00.000Z",
  "database": "connected",
  "memory": {
    "rss": 128.5,
    "heapUsed": 64.2,
    "heapTotal": 96.0
  },
  "responseTime": 2
}
```

**Status Values:**

| Status | Description |
| :--- | :--- |
| `healthy` | Application + database are operational |
| `unhealthy` | Database connection failed |

**Docker Usage:**
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## Permissions Reference

Complete list of permissions that can be assigned to API keys and user groups.

| Category | Permission | Description |
| :--- | :--- | :--- |
| **Users** | `users:read` | View users |
| | `users:write` | Create, edit, delete users |
| **Groups** | `groups:read` | View groups |
| | `groups:write` | Create, edit, delete groups |
| **Sources** | `sources:read` | View database sources |
| | `sources:write` | Create, edit, delete sources |
| **Destinations** | `destinations:read` | View storage destinations |
| | `destinations:write` | Create, edit, delete destinations |
| **Jobs** | `jobs:read` | View backup jobs |
| | `jobs:write` | Create, edit, delete jobs |
| | `jobs:execute` | Trigger backup jobs |
| **Storage** | `storage:read` | Browse stored backups |
| | `storage:download` | Download backup files |
| | `storage:delete` | Delete backup files |
| | `storage:restore` | Restore backups to databases |
| **History** | `history:read` | View execution history |
| **Audit** | `audit:read` | View audit logs |
| **Notifications** | `notifications:read` | View notification channels |
| | `notifications:write` | Create, edit, delete channels |
| **Vault** | `vault:read` | View encryption profiles |
| | `vault:write` | Create, delete profiles, download recovery kits |
| **Settings** | `settings:read` | View system settings |
| | `settings:write` | Change settings, manage system tasks |
| **API Keys** | `api-keys:read` | View API keys |
| | `api-keys:write` | Create, delete, rotate API keys |

## Common Patterns

### Trigger a Backup and Wait for Completion

```bash
#!/bin/bash
API_KEY="dbackup_your_api_key"
BASE_URL="https://your-instance.com"

# 1. Trigger
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/jobs/${JOB_ID}/run" \
  -H "Authorization: Bearer ${API_KEY}")
EXECUTION_ID=$(echo "$RESPONSE" | jq -r '.executionId')

# 2. Poll
while true; do
  STATUS=$(curl -s "${BASE_URL}/api/executions/${EXECUTION_ID}" \
    -H "Authorization: Bearer ${API_KEY}" | jq -r '.data.status')

  case "$STATUS" in
    "Success") echo "Done!"; exit 0 ;;
    "Failed")  echo "Failed!"; exit 1 ;;
    *) sleep 5 ;;
  esac
done
```

### Download Latest Backup

```bash
# 1. List files
FILES=$(curl -s "${BASE_URL}/api/storage/${STORAGE_ID}/files" \
  -H "Authorization: Bearer ${API_KEY}")

# 2. Get latest file path
LATEST=$(echo "$FILES" | jq -r '.[0].path')

# 3. Generate download URL
URL=$(curl -s -X POST "${BASE_URL}/api/storage/${STORAGE_ID}/download-url" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"file\": \"${LATEST}\"}" | jq -r '.url')

# 4. Download
wget -O latest_backup.sql.gz "$URL"
```
