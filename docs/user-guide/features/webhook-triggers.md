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

- `jobs:execute` - Trigger backup jobs
- `history:read` - Poll execution status

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

To **auto-lock** the created backup so it is excluded from all retention policies, pass `lock: true` in a JSON body:

```bash
curl -X POST "https://your-instance.com/api/jobs/JOB_ID/run" \
  -H "Authorization: Bearer dbackup_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"lock":true}'
```

> Locked backups are skipped by the retention policy and must be unlocked manually in the Storage Explorer before they can be deleted.

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
| `Failed` | Job failed - check `error` field for details |

### Include Execution Logs

Add `?includeLogs=true` to get full log entries:

```bash
curl "https://your-instance.com/api/executions/EXECUTION_ID?includeLogs=true" \
  -H "Authorization: Bearer dbackup_your_api_key"
```

## Finding the Job ID

You can find a job's ID in two ways:

1. **In the UI**: Go to **Jobs**, click the **API Trigger** button (webhook icon) on the job row - it shows pre-filled curl commands with the correct job ID
2. **Via API**: List all jobs with a `GET /api/jobs` request:

```bash
curl "https://your-instance.com/api/jobs" \
  -H "Authorization: Bearer dbackup_your_api_key"
```

## Integration Examples

### Bash Script (Trigger + Wait)

This is the same script used inside the `skyfay/dbackup:ci` container. It triggers a backup job and polls until completion, with retry logic and optional TLS skip support.

**Environment variables:**

| Variable | Required | Description |
| :--- | :--- | :--- |
| `DBACKUP_URL` | Yes | Base URL of your DBackup instance (no trailing slash) |
| `JOB_ID` | Yes | ID of the backup job to trigger |
| `DBACKUP_API_KEY` | Yes | API key with `jobs:execute` and `history:read` permissions |
| `DBACKUP_SKIP_TLS_VERIFY` | No | Set to `1` to skip TLS certificate verification (self-signed certs) |
| `DBACKUP_AUTO_LOCK` | No | Set to `1` to lock the backup immediately after creation, excluding it from retention policies |

```bash
#!/usr/bin/env bash

set -o pipefail

require_env() {
  local name="$1"
  if [ -z "${!name}" ]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

api_request() {
  local method="$1"
  local url="$2"
  local response_file
  local http_code
  local curl_exit
  local curl_args=()

  response_file="$(mktemp)"

  echo "Request: ${method} ${url}" >&2

  if [ "${DBACKUP_SKIP_TLS_VERIFY:-0}" = "1" ]; then
    echo "TLS certificate verification: disabled" >&2
    curl_args+=(--insecure)
  fi

  http_code=$(curl "${curl_args[@]}" \
    --connect-timeout 10 \
    --max-time 60 \
    --retry 3 \
    --retry-delay 2 \
    --retry-all-errors \
    -sS -o "${response_file}" -w "%{http_code}" -X "${method}" "${url}" \
    -H "Authorization: Bearer ${DBACKUP_API_KEY}")
  curl_exit=$?

  echo "Response HTTP status: ${http_code}" >&2

  if [ "${curl_exit}" -ne 0 ]; then
    echo "curl failed with exit code ${curl_exit}" >&2
    echo "Response body:" >&2
    cat "${response_file}" >&2
    rm -f "${response_file}"
    return "${curl_exit}"
  fi

  if [ "${http_code}" -lt 200 ] || [ "${http_code}" -ge 300 ]; then
    echo "Request failed with HTTP status ${http_code}" >&2
    echo "Response body:" >&2
    cat "${response_file}" >&2
    rm -f "${response_file}"
    return 1
  fi

  cat "${response_file}"
  rm -f "${response_file}"
}

json_value() {
  local response="$1"
  local filter="$2"
  local description="$3"
  local value

  if ! value=$(echo "${response}" | jq -er "${filter}"); then
    echo "Could not read ${description} from response JSON" >&2
    echo "Response body:" >&2
    echo "${response}" >&2
    return 1
  fi

  echo "${value}"
}

require_env "DBACKUP_URL"
require_env "JOB_ID"
require_env "DBACKUP_API_KEY"

RESPONSE=$(api_request "POST" "${DBACKUP_URL}/api/jobs/${JOB_ID}/run") || exit 1

EXECUTION_ID=$(json_value "${RESPONSE}" '.executionId' "execution id") || exit 1
echo "Execution started: $EXECUTION_ID"

for i in $(seq 1 60); do
  RESPONSE=$(api_request "GET" "${DBACKUP_URL}/api/executions/${EXECUTION_ID}") || exit 1

  STATUS=$(json_value "${RESPONSE}" '.data.status' "execution status") || exit 1
  echo "Attempt $i: Status=$STATUS"

  case "$STATUS" in
    "Success")
      echo "Backup completed!"
      exit 0
      ;;
    "Failed")
      ERROR=$(echo "$RESPONSE" | jq -r '.data.error // "Unknown"')
      echo "Backup failed: $ERROR"
      echo "Response body:"
      echo "$RESPONSE"
      exit 1
      ;;
    *)
      sleep 10
      ;;
  esac
done

echo "Backup timed out"
exit 1
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

### CI/CD Pipelines

DBackup provides a lightweight helper container image - `skyfay/dbackup:ci` - that bundles everything needed to trigger a job and wait for its completion. No manual curl/jq scripting required in your pipeline.

The image is available on Docker Hub and GHCR:
- `skyfay/dbackup:ci`
- `ghcr.io/skyfay/dbackup:ci`

**Environment variables:**

| Variable | Required | Description |
| :--- | :--- | :--- |
| `DBACKUP_URL` | Yes | Base URL of your DBackup instance (no trailing slash) |
| `JOB_ID` | Yes | ID of the backup job to trigger |
| `DBACKUP_API_KEY` | Yes | API key with `jobs:execute` and `history:read` permissions |
| `DBACKUP_SKIP_TLS_VERIFY` | No | Set to `1` to skip TLS certificate verification (self-signed certs) |
| `DBACKUP_AUTO_LOCK` | No | Set to `1` to lock the backup immediately after creation, excluding it from retention policies |

---

#### GitHub Actions

Add `DBACKUP_URL` and `DBACKUP_API_KEY` as repository secrets under **Settings → Secrets and variables → Actions**. Add `DBACKUP_JOB_ID` as a repository variable.

```yaml
# .github/workflows/backup.yml
name: Trigger Database Backup

on:
  schedule:
    - cron: "0 2 * * *" # Daily at 2:00 AM UTC
  workflow_dispatch: # Allow manual trigger

jobs:
  backup:
    runs-on: ubuntu-latest
    container: skyfay/dbackup:ci
    steps:
      - name: Trigger and wait for backup
        run: /backup/execute.sh
        env:
          DBACKUP_URL: ${{ secrets.DBACKUP_URL }}
          JOB_ID: ${{ vars.DBACKUP_JOB_ID }}
          DBACKUP_API_KEY: ${{ secrets.DBACKUP_API_KEY }}
          # DBACKUP_SKIP_TLS_VERIFY: "1" # Uncomment if using self-signed certificates
```

---

#### GitLab CI

Add `DBACKUP_URL` and `DBACKUP_API_KEY` as CI/CD variables under **Settings → CI/CD → Variables** (mark `DBACKUP_API_KEY` as masked).

```yaml
# .gitlab-ci.yml
trigger-backup:
  image: skyfay/dbackup:ci
  script:
    - /backup/execute.sh
  variables:
    DBACKUP_URL: $DBACKUP_URL
    JOB_ID: $DBACKUP_JOB_ID
    DBACKUP_API_KEY: $DBACKUP_API_KEY
    # DBACKUP_SKIP_TLS_VERIFY: "1" # Uncomment if using self-signed certificates
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
    - if: $CI_PIPELINE_SOURCE == "web" # Allow manual trigger from GitLab UI
```

---

#### Azure DevOps

Add `DBACKUP_URL` and `DBACKUP_API_KEY` as pipeline variables under **Pipelines → Edit → Variables** (mark `DBACKUP_API_KEY` as secret). Requires a self-hosted agent pool with Docker support.

```yaml
# azure-pipelines.yml
trigger: none

schedules:
  - cron: "0 2 * * *" # Daily at 2:00 AM UTC
    displayName: Daily backup
    branches:
      include:
        - main
    always: true

stages:
  - stage: Backup
    jobs:
      - job: TriggerBackup
        displayName: Trigger dbackup job
        container: skyfay/dbackup:ci
        steps:
          - script: /backup/execute.sh
            displayName: Trigger and wait for backup
            env:
              DBACKUP_URL: $(DBACKUP_URL)
              JOB_ID: $(DBACKUP_JOB_ID)
              DBACKUP_API_KEY: $(DBACKUP_API_KEY)
              # DBACKUP_SKIP_TLS_VERIFY: "1" # Uncomment if using self-signed certificates
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
    echo "Backup complete - safe to deploy"
    exit 0
  elif [ "$STATUS" = "Failed" ]; then
    echo "Backup failed - aborting deploy!"
    exit 1
  fi
  sleep 10
done

echo "Backup timed out - aborting deploy!"
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
