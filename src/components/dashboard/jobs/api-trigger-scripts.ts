/**
 * The scripts of the API trigger dialog. Each one starts the job, asks for its run every few
 * seconds until it is done and ends with 0 after Success, 2 after Partial and 1 after Failed or
 * Cancelled, so whatever runs it can tell them apart.
 */
import { curlStatus, curlTrigger, type TriggerExample, type TriggerTarget } from "./api-trigger-examples";

const bash = ({ baseUrl, jobId, apiKey }: TriggerTarget) => `#!/bin/bash
# Starts the backup job and waits until its run is done.
# Ends with 0 after Success, 2 after Partial and 1 after Failed or Cancelled.
set -euo pipefail

API_KEY="${apiKey}"
BASE_URL="${baseUrl}"
JOB_ID="${jobId}"

echo "Starting the backup job..."
RESPONSE=$(curl -s -X POST "\${BASE_URL}/api/jobs/\${JOB_ID}/run" \\
  -H "Authorization: Bearer \${API_KEY}")

EXECUTION_ID=$(echo "\${RESPONSE}" | jq -r '.executionId')
if [ "\${EXECUTION_ID}" = "null" ] || [ -z "\${EXECUTION_ID}" ]; then
  echo "Could not start the job: \${RESPONSE}"
  exit 1
fi
echo "Run started: \${EXECUTION_ID}"

while true; do
  STATUS_RESPONSE=$(curl -s "\${BASE_URL}/api/executions/\${EXECUTION_ID}" \\
    -H "Authorization: Bearer \${API_KEY}")

  # A missing permission or an expired key answers without data.
  if [ "$(echo "\${STATUS_RESPONSE}" | jq -r '.success')" != "true" ]; then
    echo "API error: $(echo "\${STATUS_RESPONSE}" | jq -r '.error // "Unknown API error"')"
    exit 1
  fi

  STATUS=$(echo "\${STATUS_RESPONSE}" | jq -r '.data.status')
  STAGE=$(echo "\${STATUS_RESPONSE}" | jq -r '.data.stage // ""')
  echo "Status: \${STATUS} \${STAGE}"

  case "\${STATUS}" in
    "Success")
      echo "Backup completed."
      exit 0
      ;;
    "Partial")
      echo "Backup completed, but part of it failed. See the run in DBackup."
      exit 2
      ;;
    "Failed"|"Cancelled")
      echo "Backup \${STATUS}: $(echo "\${STATUS_RESPONSE}" | jq -r '.data.error // "no error given"')"
      exit 1
      ;;
    "Pending"|"Running")
      sleep 5
      ;;
    *)
      echo "Unknown status: \${STATUS}"
      exit 1
      ;;
  esac
done`;

const python = ({ baseUrl, jobId, apiKey }: TriggerTarget) => `import sys
import time

import requests

API_KEY = "${apiKey}"
BASE_URL = "${baseUrl}"
JOB_ID = "${jobId}"
headers = {"Authorization": f"Bearer {API_KEY}"}

# Start the job
run = requests.post(f"{BASE_URL}/api/jobs/{JOB_ID}/run", headers=headers)
run.raise_for_status()
execution_id = run.json()["executionId"]
print(f"Run started: {execution_id}")

# Ask every 5 seconds until the run is done
while True:
    poll = requests.get(f"{BASE_URL}/api/executions/{execution_id}", headers=headers)
    poll.raise_for_status()
    data = poll.json()["data"]
    print(f"Status: {data['status']} {data.get('stage') or ''}")

    if data["status"] == "Success":
        sys.exit(0)
    if data["status"] == "Partial":
        print("Backup completed, but part of it failed. See the run in DBackup.")
        sys.exit(2)
    if data["status"] in ("Failed", "Cancelled"):
        print(f"Backup {data['status']}: {data.get('error') or 'no error given'}")
        sys.exit(1)

    time.sleep(5)`;

const typescript = ({ baseUrl, jobId, apiKey }: TriggerTarget) => `const API_KEY = "${apiKey}";
const BASE_URL = "${baseUrl}";
const JOB_ID = "${jobId}";
const headers = { Authorization: \`Bearer \${API_KEY}\` };

// Start the job
const run = await fetch(\`\${BASE_URL}/api/jobs/\${JOB_ID}/run\`, { method: "POST", headers });
if (!run.ok) throw new Error(\`Could not start the job: \${run.status} \${await run.text()}\`);
const { executionId } = await run.json();
console.log(\`Run started: \${executionId}\`);

// Ask every 5 seconds until the run is done
while (true) {
  const poll = await fetch(\`\${BASE_URL}/api/executions/\${executionId}\`, { headers });
  if (!poll.ok) throw new Error(\`Could not read the run: \${poll.status}\`);
  const { data } = await poll.json();
  console.log(\`Status: \${data.status} \${data.stage ?? ""}\`);

  if (data.status === "Success") process.exit(0);
  if (data.status === "Partial") {
    console.error("Backup completed, but part of it failed. See the run in DBackup.");
    process.exit(2);
  }
  if (data.status === "Failed" || data.status === "Cancelled") {
    console.error(\`Backup \${data.status}: \${data.error ?? "no error given"}\`);
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));
}`;

const go = ({ baseUrl, jobId, apiKey }: TriggerTarget) => `package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

const (
	apiKey  = "${apiKey}"
	baseURL = "${baseUrl}"
	jobID   = "${jobId}"
)

// call sends a request with the key and reads its JSON answer into out.
func call(method, url string, out any) {
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		log.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		log.Fatalf("%s %s: %s", method, url, resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		log.Fatal(err)
	}
}

func main() {
	// Start the job
	var run struct{ ExecutionId string }
	call("POST", fmt.Sprintf("%s/api/jobs/%s/run", baseURL, jobID), &run)
	fmt.Println("Run started:", run.ExecutionId)

	// Ask every 5 seconds until the run is done
	for {
		var poll struct {
			Data struct{ Status, Stage, Error string }
		}
		call("GET", fmt.Sprintf("%s/api/executions/%s", baseURL, run.ExecutionId), &poll)
		fmt.Println("Status:", poll.Data.Status, poll.Data.Stage)

		switch poll.Data.Status {
		case "Success":
			os.Exit(0)
		case "Partial":
			fmt.Println("Backup completed, but part of it failed. See the run in DBackup.")
			os.Exit(2)
		case "Failed", "Cancelled":
			log.Fatalf("Backup %s: %s", poll.Data.Status, poll.Data.Error)
		}
		time.Sleep(5 * time.Second)
	}
}`;

export const SCRIPT_EXAMPLES: TriggerExample[] = [
    {
        id: "curl",
        group: "script",
        label: "cURL",
        description: "One request at a time, to try the API or to build your own script around it.",
        files: [
            { title: "Start a run", name: "curl", language: "bash", code: curlTrigger, note: "Answers with the executionId of the run." },
            {
                title: "Ask for its status",
                name: "curl",
                language: "bash",
                code: (target) => curlStatus(target),
                note: "Swap EXECUTION_ID for the executionId. The run is Pending or Running until it ends as Success, Partial, Failed or Cancelled.",
            },
            {
                title: "With its log",
                name: "curl",
                language: "bash",
                code: (target) => curlStatus(target, "?includeLogs=true"),
                note: "The same answer with every log line of the run.",
            },
        ],
    },
    {
        id: "bash",
        group: "script",
        label: "Bash",
        description: "Starts the job and waits until its run is done. Needs curl and jq.",
        files: [{ name: "backup.sh", language: "bash", code: bash }],
    },
    {
        id: "python",
        group: "script",
        label: "Python",
        description: "Starts the job and waits until its run is done. Needs requests, install it with pip install requests.",
        files: [{ name: "backup.py", language: "python", code: python }],
    },
    {
        id: "typescript",
        group: "script",
        label: "TypeScript",
        description: "Starts the job and waits until its run is done. Runs with Bun, Deno or tsx on Node 18 and later.",
        files: [{ name: "backup.ts", language: "typescript", code: typescript }],
    },
    {
        id: "go",
        group: "script",
        label: "Go",
        description: "Starts the job and waits until its run is done, with the standard library only.",
        files: [{ name: "main.go", language: "go", code: go }],
    },
];
