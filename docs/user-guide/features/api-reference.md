# API Reference

Complete reference for the DBackup REST API. Use these endpoints to automate backups, monitor executions, manage resources, and integrate with external systems.

## Interactive API Documentation

DBackup ships with an interactive API reference powered by [Scalar](https://scalar.com):

- **In your instance**: Open `/docs/api` in your browser (e.g., `http://localhost:3000/docs/api`)
- **Online**: [api.dbackup.app](https://api.dbackup.app)

The interactive docs let you explore all endpoints, view request/response schemas, and generate code snippets for Shell, Python, Node.js, PHP, Ruby, and more.

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

Rate limits are configurable in **Settings → Rate Limits**.

## Endpoints

For the full endpoint documentation with request/response schemas, examples, and code snippets, use the interactive API reference:

- **In your instance**: [`/docs/api`](http://localhost:3000/docs/api)
- **Online**: [api.dbackup.app](https://api.dbackup.app)

### Endpoint Overview

| Section | Endpoints | Description |
| :--- | :--- | :--- |
| Jobs | `GET/POST/PUT/DELETE /api/jobs` | CRUD + trigger backups |
| Executions | `GET /api/executions/:id` | Poll execution status |
| History | `GET /api/history` | List execution history, paged with `page`, `pageSize`, `scope`, `type`, `status`, `trigger`, `search` and `facets` |
| Dashboard | `GET /api/dashboard/stats`, `GET /api/dashboard/calendar` | Overview statistics and calendar heatmap |
| Adapters | `GET/POST/PUT/DELETE /api/adapters` | Sources, destinations & notifications |
| Connection Testing | `POST /api/adapters/test-connection` | Test adapter connections |
| Storage Explorer | `GET/POST/DELETE /api/storage/:id/*` | Browse, download, delete, restore backups |
| Backups across destinations | `GET /api/storage/explorer`, `GET /api/storage/explorer/runs`, `GET /api/storage/explorer/destinations/:id`, `GET /api/storage/explorer/execution?path=` | Every job and destination with its backup counts, every backup with its copies at every destination, the backups of one destination with their job and their copies elsewhere, and the run that made a backup |
| Vault | `GET /api/vault/:id/recovery-kit` | Download encryption recovery kit |
| Settings | `GET/POST/PUT /api/settings/system-tasks` | System tasks configuration |
| Health | `GET /api/health` | Health check (public, no auth) |

## Permissions

Every API endpoint requires a specific permission. Permissions are assigned to API keys and user groups.

For the complete permission reference, see [Groups & Permissions](/user-guide/admin/permissions#permission-reference).

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
wget --content-disposition "$URL"
```

For a backup of a single database, this downloads the dump itself, decrypted and decompressed, named after the backup and the database. A backup of several databases needs the database named, see the next section.

### Download a Single Database

An API key with only `storage:download` is enough. Only the chosen database is read from the destination, however many databases the backup holds.

```bash
# 1. List the databases in a backup
curl -s -X POST "${BASE_URL}/api/storage/${STORAGE_ID}/analyze" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"file\": \"${BACKUP}\"}" | jq '.databaseDetails'

# 2a. Stream one dump straight to disk
curl -s -X POST "${BASE_URL}/api/storage/${STORAGE_ID}/restore-files" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"file\": \"${BACKUP}\", \"databases\": [\"customer_shop_prod\"], \"target\": {\"kind\": \"download\"}}" \
  -OJ

# 2b. Or get a single-use link for a server that has no API key
URL=$(curl -s -X POST "${BASE_URL}/api/storage/${STORAGE_ID}/download-url" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"file\": \"${BACKUP}\", \"database\": \"customer_shop_prod\"}" | jq -r '.url')
wget --content-disposition "$URL"
```

Naming several databases in `databases` returns them together as a `.tar.gz`. Backups written by earlier versions for database-only jobs are single files, so they can only be downloaded whole.

### Show Statistics on a Homepage Dashboard

Create an API key with only `dashboard:read` and point your dashboard widget at the stats endpoint:

```bash
curl -s "${BASE_URL}/api/dashboard/stats" \
  -H "Authorization: Bearer ${API_KEY}"
```

```json
{
  "success": true,
  "data": {
    "totalJobs": 8,
    "activeSchedules": 8,
    "totalSnapshots": 122,
    "totalStorageBytes": 55179592335,
    "successRate30d": 100,
    "success24h": 29,
    "failed24h": 0,
    "storageUpdatedAt": "2026-09-13T10:00:00.000Z"
  }
}
```

Any dashboard that can send an `Authorization` header works, for example the [Homepage Custom API widget](https://gethomepage.dev/widgets/services/customapi/). The figures are nested under `data`, so map the fields from there.

::: tip Storage figures
`totalSnapshots` and `totalStorageBytes` come from the storage statistics cache, which refreshes hourly by default and after every backup. Polling more often does not make them more current. A destination that cannot be listed during a refresh counts with the values of its last successful scan.
:::
