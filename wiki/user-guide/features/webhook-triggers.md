# Webhook Triggers (API Automation)

Trigger backup jobs programmatically via the REST API. Perfect for CI/CD pipelines, cron jobs, Ansible playbooks, and custom automation scripts.

## Overview

DBackup exposes a simple REST API that allows you to:

1. **Trigger** backup jobs on demand
2. **Poll** execution status until completion
3. **Retrieve** execution logs and results

All API calls require an [API Key](/user-guide/features/api-keys) with appropriate permissions.

## Quick Start

### 1. Create an API Key

Navigate to **Access Management → API Keys** and create a key with at least these permissions:

- `jobs:execute` — Trigger backup jobs
- `history:read` — Poll execution status

### 2. Trigger a Backup

```bash
curl -X POST "https://your-instance.com/api/jobs/JOB_ID/run" \
  -H "Authorization: Bearer dbackup_your_api_key"
```

**Response:**
```json
{
  "success": true,
  "executionId": "clx1abc..."
}
```

### 3. Poll Execution Status

```bash
curl "https://your-instance.com/api/executions/EXECUTION_ID" \
  -H "Authorization: Bearer dbackup_your_api_key"
```

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
    "error": null
  }
}
```

### Execution Status Values

| Status | Description |
| :--- | :--- |
| `Pending` | Job is queued, waiting for an execution slot |
| `Running` | Job is actively running |
| `Success` | Job completed successfully |
| `Failed` | Job failed — check `error` field for details |

### Include Execution Logs

Add `?includeLogs=true` to get full log entries:

```bash
curl "https://your-instance.com/api/executions/EXECUTION_ID?includeLogs=true" \
  -H "Authorization: Bearer dbackup_your_api_key"
```

## Finding the Job ID

You can find a job's ID in two ways:

1. **In the UI**: Go to **Jobs**, click the **API Trigger** button (webhook icon) on the job row — it shows pre-filled curl commands with the correct job ID
2. **Via API**: List all jobs with a `GET /api/jobs` request:

```bash
curl "https://your-instance.com/api/jobs" \
  -H "Authorization: Bearer dbackup_your_api_key"
```

## Integration Examples

### Bash Script (Trigger + Wait)

A complete script that triggers a backup and polls until completion:

```bash
#!/bin/bash
set -euo pipefail

API_KEY="dbackup_your_api_key"
BASE_URL="https://your-instance.com"
JOB_ID="your-job-id"

# Trigger the backup
echo "Starting backup job..."
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/jobs/${JOB_ID}/run" \
  -H "Authorization: Bearer ${API_KEY}")

EXECUTION_ID=$(echo "${RESPONSE}" | jq -r '.executionId')
if [ "${EXECUTION_ID}" = "null" ] || [ -z "${EXECUTION_ID}" ]; then
  echo "Failed to start job: ${RESPONSE}"
  exit 1
fi

echo "Execution started: ${EXECUTION_ID}"

# Poll until completion
while true; do
  STATUS_RESPONSE=$(curl -s "${BASE_URL}/api/executions/${EXECUTION_ID}" \
    -H "Authorization: Bearer ${API_KEY}")

  STATUS=$(echo "${STATUS_RESPONSE}" | jq -r '.data.status')
  PROGRESS=$(echo "${STATUS_RESPONSE}" | jq -r '.data.progress // "N/A"')
  STAGE=$(echo "${STATUS_RESPONSE}" | jq -r '.data.stage // "N/A"')

  echo "Status: ${STATUS} | Progress: ${PROGRESS} | Stage: ${STAGE}"

  case "${STATUS}" in
    "Success")
      echo "Backup completed successfully!"
      exit 0
      ;;
    "Failed")
      ERROR=$(echo "${STATUS_RESPONSE}" | jq -r '.data.error // "Unknown error"')
      echo "Backup failed: ${ERROR}"
      exit 1
      ;;
    "Pending"|"Running")
      sleep 5
      ;;
    *)
      echo "Unknown status: ${STATUS}"
      exit 1
      ;;
  esac
done
```

**Requirements:** `curl`, `jq`

### Ansible Playbook

```yaml
- name: Trigger DBackup job
  hosts: localhost
  vars:
    dbackup_url: "https://your-instance.com"
    dbackup_api_key: "dbackup_your_api_key"
    job_id: "your-job-id"

  tasks:
    - name: Trigger backup
      ansible.builtin.uri:
        url: "{{ dbackup_url }}/api/jobs/{{ job_id }}/run"
        method: POST
        headers:
          Authorization: "Bearer {{ dbackup_api_key }}"
        status_code: 200
      register: trigger_result

    - name: Wait for completion
      ansible.builtin.uri:
        url: "{{ dbackup_url }}/api/executions/{{ trigger_result.json.executionId }}"
        headers:
          Authorization: "Bearer {{ dbackup_api_key }}"
      register: poll_result
      until: poll_result.json.data.status in ['Success', 'Failed']
      retries: 60
      delay: 10

    - name: Check result
      ansible.builtin.fail:
        msg: "Backup failed: {{ poll_result.json.data.error }}"
      when: poll_result.json.data.status == 'Failed'
```

### CI/CD (GitHub Actions)

```yaml
name: Post-Deploy Backup
on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger backup
        id: trigger
        run: |
          RESPONSE=$(curl -s -X POST "${{ secrets.DBACKUP_URL }}/api/jobs/${{ secrets.DBACKUP_JOB_ID }}/run" \
            -H "Authorization: Bearer ${{ secrets.DBACKUP_API_KEY }}")
          EXECUTION_ID=$(echo "$RESPONSE" | jq -r '.executionId')
          echo "execution_id=$EXECUTION_ID" >> "$GITHUB_OUTPUT"

      - name: Wait for backup
        run: |
          for i in $(seq 1 60); do
            RESPONSE=$(curl -s "${{ secrets.DBACKUP_URL }}/api/executions/${{ steps.trigger.outputs.execution_id }}" \
              -H "Authorization: Bearer ${{ secrets.DBACKUP_API_KEY }}")
            STATUS=$(echo "$RESPONSE" | jq -r '.data.status')
            echo "Attempt $i: Status=$STATUS"
            if [ "$STATUS" = "Success" ]; then exit 0; fi
            if [ "$STATUS" = "Failed" ]; then
              echo "::error::Backup failed: $(echo "$RESPONSE" | jq -r '.data.error')"
              exit 1
            fi
            sleep 10
          done
          echo "::error::Backup timed out"
          exit 1
```

### Docker Compose Healthcheck Integration

Trigger a backup before deploying a new database version:

```bash
#!/bin/bash
# pre-deploy-backup.sh
set -euo pipefail

echo "Creating pre-deploy backup..."
RESPONSE=$(curl -sf -X POST "${DBACKUP_URL}/api/jobs/${BACKUP_JOB_ID}/run" \
  -H "Authorization: Bearer ${DBACKUP_API_KEY}")

EXECUTION_ID=$(echo "$RESPONSE" | jq -r '.executionId')

# Quick wait (max 5 minutes)
for i in $(seq 1 30); do
  STATUS=$(curl -sf "${DBACKUP_URL}/api/executions/${EXECUTION_ID}" \
    -H "Authorization: Bearer ${DBACKUP_API_KEY}" | jq -r '.data.status')

  if [ "$STATUS" = "Success" ]; then
    echo "Backup complete — safe to deploy"
    exit 0
  elif [ "$STATUS" = "Failed" ]; then
    echo "Backup failed — aborting deploy!"
    exit 1
  fi
  sleep 10
done

echo "Backup timed out — aborting deploy!"
exit 1
```

## API Reference

### POST /api/jobs/:id/run

Trigger a backup job execution.

**Required permission:** `jobs:execute`

**Headers:**
```
Authorization: Bearer dbackup_your_api_key
```

**Response (200):**
```json
{
  "success": true,
  "executionId": "clx1abc..."
}
```

**Error Responses:**
| Status | Body | Cause |
| :--- | :--- | :--- |
| 401 | `{ "error": "..." }` | Invalid/disabled/expired API key |
| 403 | `{ "error": "..." }` | Missing `jobs:execute` permission |
| 404 | `{ "error": "Job not found" }` | Invalid job ID |

### GET /api/executions/:id

Poll execution status and progress.

**Required permission:** `history:read`

**Query Parameters:**
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `includeLogs` | boolean | `false` | Include full execution log entries |

**Headers:**
```
Authorization: Bearer dbackup_your_api_key
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "jobId": "string",
    "jobName": "string",
    "type": "Backup | Restore",
    "status": "Pending | Running | Success | Failed",
    "progress": "number | null",
    "stage": "string | null",
    "startedAt": "ISO 8601 | null",
    "endedAt": "ISO 8601 | null",
    "duration": "number (ms) | null",
    "size": "number (bytes) | null",
    "path": "string | null",
    "error": "string | null",
    "logs": "[...] (only with includeLogs=true)"
  }
}
```

## Rate Limits

API requests are subject to the same rate limits as the web interface:

| Type | Limit |
| :--- | :--- |
| GET requests | 100/min per IP |
| POST/PUT/DELETE | 20/min per IP |

## Troubleshooting

### 401 Unauthorized
- Verify the API key is correct and starts with `dbackup_`
- Check if the key is **enabled** (not disabled)
- Check if the key has **expired**

### 403 Forbidden
- The key is valid but lacks the required permission
- Add the missing permission under **Access Management → API Keys**

### Job not starting (Pending)
- The job may be queued due to the **max concurrent jobs** setting
- Check under **Settings → System** for the concurrency limit
