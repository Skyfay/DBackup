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
  local body="${3:-}"
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

  if [ -n "${body}" ]; then
    curl_args+=(-H "Content-Type: application/json" --data "${body}")
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

TRIGGER_BODY=""
if [ "${DBACKUP_AUTO_LOCK:-0}" = "1" ]; then
  echo "Auto-lock enabled: backup will be locked after creation" >&2
  TRIGGER_BODY='{"lock":true}'
fi

RESPONSE=$(api_request "POST" "${DBACKUP_URL}/api/jobs/${JOB_ID}/run" "${TRIGGER_BODY}") || exit 1

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
