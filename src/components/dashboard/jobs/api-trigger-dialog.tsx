"use client"

import { useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Check, Copy, Webhook } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"

interface ApiTriggerDialogProps {
    jobId: string
    jobName: string
    open: boolean
    onOpenChange: (open: boolean) => void
}

// Simple keyword-based syntax highlighting for code blocks
function highlightCode(code: string, language: string): React.ReactNode[] {
    const lines = code.split("\n")
    return lines.map((line, i) => (
        <span key={i}>
            {highlightLine(line, language)}
            {i < lines.length - 1 ? "\n" : ""}
        </span>
    ))
}

function highlightLine(line: string, language: string): React.ReactNode[] {
    const tokens: React.ReactNode[] = []
    let remaining = line

    // Comment detection
    const commentPrefixes: Record<string, string[]> = {
        bash: ["#"],
        yaml: ["#"],
        python: ["#"],
        typescript: ["//"],
        go: ["//"],
    }

    const prefixes = commentPrefixes[language] || ["#"]
    for (const prefix of prefixes) {
        if (remaining.trimStart().startsWith(prefix)) {
            const leadingWhitespace = remaining.match(/^(\s*)/)?.[0] || ""
            tokens.push(leadingWhitespace)
            tokens.push(
                <span key={`c-${remaining}`} className="text-emerald-400/70">
                    {remaining.trimStart()}
                </span>
            )
            return tokens
        }
    }

    // Keywords per language
    const patterns: { regex: RegExp; className: string }[] = getPatterns(language)

    let idx = 0
    while (remaining.length > 0) {
        let earliest: { match: RegExpExecArray; className: string } | null = null
        let earliestPos = remaining.length

        for (const p of patterns) {
            p.regex.lastIndex = 0
            const match = p.regex.exec(remaining)
            if (match && match.index < earliestPos) {
                earliestPos = match.index
                earliest = { match, className: p.className }
            }
        }

        if (earliest) {
            if (earliestPos > 0) {
                tokens.push(<span key={`t-${idx++}`}>{remaining.slice(0, earliestPos)}</span>)
            }
            tokens.push(
                <span key={`h-${idx++}`} className={earliest.className}>
                    {earliest.match[0]}
                </span>
            )
            remaining = remaining.slice(earliestPos + earliest.match[0].length)
        } else {
            tokens.push(<span key={`r-${idx++}`}>{remaining}</span>)
            remaining = ""
        }
    }

    return tokens
}

function getPatterns(language: string) {
    const stringClass = "text-amber-300"
    const keywordClass = "text-purple-400"
    const builtinClass = "text-sky-400"
    const numberClass = "text-orange-300"
    const variableClass = "text-sky-300"

    const common = [
        { regex: /"(?:[^"\\]|\\.)*"/g, className: stringClass },
        { regex: /'(?:[^'\\]|\\.)*'/g, className: stringClass },
        { regex: /\b\d+\b/g, className: numberClass },
    ]

    switch (language) {
        case "bash":
            return [
                ...common,
                { regex: /\$\{[^}]+\}/g, className: variableClass },
                { regex: /\$\w+/g, className: variableClass },
                { regex: /\b(if|then|else|fi|case|esac|do|done|while|for|in|echo|exit|set|curl|jq|export|local|readonly)\b/g, className: keywordClass },
            ]
        case "yaml":
            return [
                ...common,
                { regex: /\{\{[^}]+\}\}/g, className: variableClass },
                { regex: /\$\{\{[^}]+\}\}/g, className: variableClass },
                { regex: /^\s*[\w.-]+(?=:)/gm, className: builtinClass },
            ]
        case "python":
            return [
                ...common,
                { regex: /"""[\s\S]*?"""/g, className: stringClass },
                { regex: /f"(?:[^"\\]|\\.)*"/g, className: stringClass },
                { regex: /\b(import|from|def|class|if|elif|else|return|raise|try|except|finally|with|as|for|while|in|not|and|or|True|False|None|async|await)\b/g, className: keywordClass },
                { regex: /\b(print|len|range|str|int|dict|list|isinstance|requests|json|sys|time)\b/g, className: builtinClass },
            ]
        case "typescript":
            return [
                ...common,
                { regex: /`(?:[^`\\]|\\.)*`/g, className: stringClass },
                { regex: /\b(import|from|export|const|let|var|function|async|await|if|else|return|throw|new|try|catch|finally|class|interface|type|while|for|of|in)\b/g, className: keywordClass },
                { regex: /\b(console|fetch|JSON|process|Error|Response|Promise|setTimeout|clearInterval|setInterval)\b/g, className: builtinClass },
            ]
        case "go":
            return [
                ...common,
                { regex: /`(?:[^`\\]|\\.)*`/g, className: stringClass },
                { regex: /\b(package|import|func|var|const|if|else|return|for|range|defer|go|struct|type|interface|map|string|int|error|nil|bool|true|false)\b/g, className: keywordClass },
                { regex: /\b(fmt|http|json|os|time|log|io|bytes|strings|errors)\b/g, className: builtinClass },
            ]
        default:
            return common
    }
}

function CopyBlock({ code, language, label }: { code: string; language: string; label?: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = () => {
        navigator.clipboard.writeText(code)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className="relative group rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
            {label && (
                <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
                    <span className="text-xs font-medium text-zinc-400">{label}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                        onClick={handleCopy}
                    >
                        {copied ? (
                            <><Check className="h-3 w-3 mr-1 text-green-400" /> Copied</>
                        ) : (
                            <><Copy className="h-3 w-3 mr-1" /> Copy</>
                        )}
                    </Button>
                </div>
            )}
            <ScrollArea className="w-full" type="auto">
                <pre className="p-4 text-[13px] leading-relaxed text-zinc-200 font-mono">
                    <code>{highlightCode(code, language)}</code>
                </pre>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
            {!label && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-zinc-200"
                    onClick={handleCopy}
                >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
            )}
        </div>
    )
}

function OverviewItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = () => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors group"
            onClick={handleCopy}
            title="Click to copy"
        >
            <span className="text-xs text-muted-foreground shrink-0">{label}</span>
            <div className="flex items-center gap-1.5 min-w-0">
                <code className={`text-xs truncate ${mono ? "font-mono" : ""}`}>{value}</code>
                {copied ? (
                    <Check className="h-3 w-3 text-green-500 shrink-0" />
                ) : (
                    <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                )}
            </div>
        </div>
    )
}

export function ApiTriggerDialog({ jobId, jobName, open, onOpenChange }: ApiTriggerDialogProps) {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://your-dbackup-instance.com"
    const apiEndpoint = `${baseUrl}/api/jobs/${jobId}/run`
    const pollEndpoint = `${baseUrl}/api/executions/{executionId}`

    // ── cURL ──
    const triggerCurl = `curl -X POST "${apiEndpoint}" \\
  -H "Authorization: Bearer dbackup_YOUR_API_KEY"`

    const pollCurl = `curl "${baseUrl}/api/executions/EXECUTION_ID" \\
  -H "Authorization: Bearer dbackup_YOUR_API_KEY"`

    const pollWithLogsCurl = `curl "${baseUrl}/api/executions/EXECUTION_ID?includeLogs=true" \\
  -H "Authorization: Bearer dbackup_YOUR_API_KEY"`

    // ── Bash ──
    const bashScript = `#!/bin/bash
# Trigger backup and wait for completion
set -euo pipefail

API_KEY="dbackup_YOUR_API_KEY"
BASE_URL="${baseUrl}"
JOB_ID="${jobId}"

# Trigger the backup
echo "Starting backup job..."
RESPONSE=$(curl -s -X POST "\${BASE_URL}/api/jobs/\${JOB_ID}/run" \\
  -H "Authorization: Bearer \${API_KEY}")

EXECUTION_ID=$(echo "\${RESPONSE}" | jq -r '.executionId')
if [ "\${EXECUTION_ID}" = "null" ] || [ -z "\${EXECUTION_ID}" ]; then
  echo "Failed to start job: \${RESPONSE}"
  exit 1
fi

echo "Execution started: \${EXECUTION_ID}"

# Poll until completion
while true; do
  STATUS_RESPONSE=$(curl -s "\${BASE_URL}/api/executions/\${EXECUTION_ID}" \\
    -H "Authorization: Bearer \${API_KEY}")

  STATUS=$(echo "\${STATUS_RESPONSE}" | jq -r '.data.status')
  PROGRESS=$(echo "\${STATUS_RESPONSE}" | jq -r '.data.progress // "N/A"')
  STAGE=$(echo "\${STATUS_RESPONSE}" | jq -r '.data.stage // "N/A"')

  echo "Status: \${STATUS} | Progress: \${PROGRESS} | Stage: \${STAGE}"

  case "\${STATUS}" in
    "Success")
      echo "Backup completed successfully!"
      exit 0
      ;;
    "Failed")
      ERROR=$(echo "\${STATUS_RESPONSE}" | jq -r '.data.error // "Unknown error"')
      echo "Backup failed: \${ERROR}"
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
done`

    // ── Python ──
    const pythonScript = `import requests
import time
import sys

API_KEY = "dbackup_YOUR_API_KEY"
BASE_URL = "${baseUrl}"
JOB_ID = "${jobId}"

headers = {"Authorization": f"Bearer {API_KEY}"}

# Trigger the backup
response = requests.post(f"{BASE_URL}/api/jobs/{JOB_ID}/run", headers=headers)
response.raise_for_status()
execution_id = response.json()["executionId"]
print(f"Execution started: {execution_id}")

# Poll until completion
while True:
    poll = requests.get(f"{BASE_URL}/api/executions/{execution_id}", headers=headers)
    data = poll.json()["data"]
    status = data["status"]
    print(f"Status: {status} | Progress: {data.get('progress', 'N/A')}")

    if status == "Success":
        print("Backup completed successfully!")
        sys.exit(0)
    elif status == "Failed":
        print(f"Backup failed: {data.get('error', 'Unknown')}")
        sys.exit(1)

    time.sleep(5)`

    // ── TypeScript / Node.js ──
    const typescriptScript = `const API_KEY = "dbackup_YOUR_API_KEY";
const BASE_URL = "${baseUrl}";
const JOB_ID = "${jobId}";

const headers = { Authorization: \`Bearer \${API_KEY}\` };

// Trigger the backup
const triggerRes = await fetch(\`\${BASE_URL}/api/jobs/\${JOB_ID}/run\`, {
  method: "POST",
  headers,
});
const { executionId } = await triggerRes.json();
console.log(\`Execution started: \${executionId}\`);

// Poll until completion
while (true) {
  const pollRes = await fetch(
    \`\${BASE_URL}/api/executions/\${executionId}\`,
    { headers }
  );
  const { data } = await pollRes.json();
  console.log(\`Status: \${data.status} | Progress: \${data.progress ?? "N/A"}\`);

  if (data.status === "Success") {
    console.log("Backup completed successfully!");
    break;
  }
  if (data.status === "Failed") {
    throw new Error(\`Backup failed: \${data.error}\`);
  }

  await new Promise((r) => setTimeout(r, 5000));
}`

    // ── Go ──
    const goScript = `package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

const (
	apiKey  = "dbackup_YOUR_API_KEY"
	baseURL = "${baseUrl}"
	jobID   = "${jobId}"
)

func main() {
	// Trigger the backup
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/jobs/%s/run", baseURL, jobID), nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	var trigger struct{ ExecutionId string }
	json.NewDecoder(resp.Body).Decode(&trigger)
	fmt.Printf("Execution started: %s\\n", trigger.ExecutionId)

	// Poll until completion
	for {
		pollURL := fmt.Sprintf("%s/api/executions/%s", baseURL, trigger.ExecutionId)
		req, _ := http.NewRequest("GET", pollURL, nil)
		req.Header.Set("Authorization", "Bearer "+apiKey)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			log.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var result struct {
			Data struct {
				Status   string
				Progress string
				Error    string
			}
		}
		json.Unmarshal(body, &result)
		fmt.Printf("Status: %s | Progress: %s\\n", result.Data.Status, result.Data.Progress)

		switch result.Data.Status {
		case "Success":
			fmt.Println("Backup completed successfully!")
			return
		case "Failed":
			log.Fatalf("Backup failed: %s", result.Data.Error)
		}
		time.Sleep(5 * time.Second)
	}
}`

    // ── GitHub Actions ──
    const githubActionsWorkflow = `# .github/workflows/backup.yml
name: Trigger Database Backup

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2:00 AM UTC
  workflow_dispatch:       # Allow manual trigger

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger backup
        id: trigger
        run: |
          RESPONSE=$(curl -s -f -X POST "\${DBACKUP_URL}/api/jobs/\${JOB_ID}/run" \\
            -H "Authorization: Bearer \${API_KEY}")
          EXECUTION_ID=$(echo "\$RESPONSE" | jq -r '.executionId')
          echo "execution_id=\$EXECUTION_ID" >> "\$GITHUB_OUTPUT"
          echo "Execution started: \$EXECUTION_ID"
        env:
          DBACKUP_URL: \${{ secrets.DBACKUP_URL }}
          API_KEY: \${{ secrets.DBACKUP_API_KEY }}
          JOB_ID: "${jobId}"

      - name: Wait for completion
        run: |
          EXECUTION_ID="\${{ steps.trigger.outputs.execution_id }}"
          for i in $(seq 1 60); do
            RESPONSE=$(curl -s "\${DBACKUP_URL}/api/executions/\${EXECUTION_ID}" \\
              -H "Authorization: Bearer \${API_KEY}")
            STATUS=$(echo "\$RESPONSE" | jq -r '.data.status')
            echo "Attempt \$i: Status=\$STATUS"
            case "\$STATUS" in
              "Success") echo "Backup completed!"; exit 0 ;;
              "Failed")
                ERROR=$(echo "\$RESPONSE" | jq -r '.data.error // "Unknown"')
                echo "::error::Backup failed: \$ERROR"; exit 1 ;;
              *) sleep 10 ;;
            esac
          done
          echo "::error::Backup timed out"; exit 1
        env:
          DBACKUP_URL: \${{ secrets.DBACKUP_URL }}
          API_KEY: \${{ secrets.DBACKUP_API_KEY }}`

    // ── GitLab CI ──
    const gitlabCiPipeline = `# .gitlab-ci.yml
stages:
  - backup

trigger_backup:
  stage: backup
  image: curlimages/curl:latest
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"  # Triggered by GitLab schedule
    - if: $CI_PIPELINE_SOURCE == "web"       # Allow manual trigger
  variables:
    DBACKUP_URL: \${DBACKUP_URL}             # Set in CI/CD Settings → Variables
    DBACKUP_API_KEY: \${DBACKUP_API_KEY}     # Set as masked variable
    JOB_ID: "${jobId}"
  before_script:
    - apk add --no-cache jq
  script:
    - |
      # Trigger the backup
      RESPONSE=$(curl -s -f -X POST "\${DBACKUP_URL}/api/jobs/\${JOB_ID}/run" \\
        -H "Authorization: Bearer \${DBACKUP_API_KEY}")
      EXECUTION_ID=$(echo "\$RESPONSE" | jq -r '.executionId')
      echo "Execution started: \$EXECUTION_ID"

      # Poll until completion
      for i in $(seq 1 60); do
        RESPONSE=$(curl -s "\${DBACKUP_URL}/api/executions/\${EXECUTION_ID}" \\
          -H "Authorization: Bearer \${DBACKUP_API_KEY}")
        STATUS=$(echo "\$RESPONSE" | jq -r '.data.status')
        echo "Attempt \$i: Status=\$STATUS"
        case "\$STATUS" in
          "Success") echo "Backup completed!"; exit 0 ;;
          "Failed")
            ERROR=$(echo "\$RESPONSE" | jq -r '.data.error // "Unknown"')
            echo "Backup failed: \$ERROR"; exit 1 ;;
          *) sleep 10 ;;
        esac
      done
      echo "Backup timed out"; exit 1`

    // ── Ansible ──
    const ansiblePlaybook = `# Ansible playbook example
- name: Trigger DBackup job
  hosts: localhost
  vars:
    dbackup_url: "${baseUrl}"
    dbackup_api_key: "dbackup_YOUR_API_KEY"
    job_id: "${jobId}"

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
      when: poll_result.json.data.status == 'Failed'`

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl max-h-[85vh] grid-rows-[auto_1fr] overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Webhook className="h-5 w-5" />
                        API Trigger
                    </DialogTitle>
                    <DialogDescription>
                        Trigger <span className="font-medium">{jobName}</span> via API. Create an API key under Access Management → API Keys with the <code className="text-xs bg-muted px-1 rounded">jobs:execute</code> permission.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="overflow-hidden">
                <div className="pr-4">
                <Tabs defaultValue="overview" className="mt-1">
                    <TabsList className="w-full flex-wrap h-auto gap-1 p-1">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <Separator orientation="vertical" className="h-4" />
                        <TabsTrigger value="curl">cURL</TabsTrigger>
                        <TabsTrigger value="bash">Bash</TabsTrigger>
                        <TabsTrigger value="python">Python</TabsTrigger>
                        <TabsTrigger value="typescript">TypeScript</TabsTrigger>
                        <TabsTrigger value="go">Go</TabsTrigger>
                        <Separator orientation="vertical" className="h-4" />
                        <TabsTrigger value="github">GitHub Actions</TabsTrigger>
                        <TabsTrigger value="gitlab">GitLab CI</TabsTrigger>
                        <TabsTrigger value="ansible">Ansible</TabsTrigger>
                    </TabsList>

                    {/* ── Overview ── */}
                    <TabsContent value="overview" className="mt-4 space-y-4">
                        <div className="space-y-3">
                            <div>
                                <h4 className="text-sm font-medium mb-2">Connection Details</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <OverviewItem label="Trigger URL" value={apiEndpoint} mono />
                                    <OverviewItem label="Poll URL" value={pollEndpoint} mono />
                                    <OverviewItem label="Job ID" value={jobId} mono />
                                    <OverviewItem label="Method" value="POST" />
                                </div>
                            </div>

                            <Separator />

                            <div>
                                <h4 className="text-sm font-medium mb-2">Authentication</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <OverviewItem label="Header" value="Authorization: Bearer dbackup_..." />
                                    <OverviewItem label="Permission" value="jobs:execute" />
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                    Create an API key under <span className="font-medium">Access Management → API Keys</span> with the <code className="bg-muted px-1 rounded">jobs:execute</code> permission.
                                </p>
                            </div>

                            <Separator />

                            <div>
                                <h4 className="text-sm font-medium mb-2">Response Format</h4>
                                <CopyBlock
                                    code={`// Trigger response\n{ "executionId": "exec_abc123" }\n\n// Poll response\n{\n  "data": {\n    "status": "Running",\n    "progress": 45,\n    "stage": "Uploading"\n  }\n}`}
                                    language="typescript"
                                    label="JSON"
                                />
                            </div>

                            <div>
                                <h4 className="text-sm font-medium mb-2">Status Values</h4>
                                <div className="flex flex-wrap gap-2">
                                    <Badge variant="secondary">Pending</Badge>
                                    <Badge variant="secondary">Running</Badge>
                                    <Badge variant="default" className="bg-green-600 hover:bg-green-700">Success</Badge>
                                    <Badge variant="destructive">Failed</Badge>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    {/* ── cURL ── */}
                    <TabsContent value="curl" className="space-y-4 mt-4">
                        <div>
                            <h4 className="text-sm font-medium mb-2">Trigger Backup</h4>
                            <CopyBlock code={triggerCurl} language="bash" label="bash" />
                            <p className="text-xs text-muted-foreground mt-1.5">
                                Returns <code className="bg-muted px-1 rounded">{"{ executionId }"}</code> on success.
                            </p>
                        </div>
                        <div>
                            <h4 className="text-sm font-medium mb-2">Poll Execution Status</h4>
                            <CopyBlock code={pollCurl} language="bash" label="bash" />
                            <p className="text-xs text-muted-foreground mt-1.5">
                                Returns status (<code className="bg-muted px-1 rounded">Pending</code>, <code className="bg-muted px-1 rounded">Running</code>, <code className="bg-muted px-1 rounded">Success</code>, <code className="bg-muted px-1 rounded">Failed</code>), progress, and stage.
                            </p>
                        </div>
                        <div>
                            <h4 className="text-sm font-medium mb-2">Poll with Logs</h4>
                            <CopyBlock code={pollWithLogsCurl} language="bash" label="bash" />
                            <p className="text-xs text-muted-foreground mt-1.5">
                                Add <code className="bg-muted px-1 rounded">?includeLogs=true</code> to include execution log entries.
                            </p>
                        </div>
                    </TabsContent>

                    {/* ── Bash ── */}
                    <TabsContent value="bash" className="space-y-3 mt-4">
                        <p className="text-sm text-muted-foreground">
                            Complete script that triggers the backup and polls until completion. Requires <code className="bg-muted px-1 rounded">jq</code> and <code className="bg-muted px-1 rounded">curl</code>.
                        </p>
                        <CopyBlock code={bashScript} language="bash" label="backup.sh" />
                    </TabsContent>

                    {/* ── Python ── */}
                    <TabsContent value="python" className="space-y-3 mt-4">
                        <p className="text-sm text-muted-foreground">
                            Python script using the <code className="bg-muted px-1 rounded">requests</code> library. Install with <code className="bg-muted px-1 rounded">pip install requests</code>.
                        </p>
                        <CopyBlock code={pythonScript} language="python" label="backup.py" />
                    </TabsContent>

                    {/* ── TypeScript ── */}
                    <TabsContent value="typescript" className="space-y-3 mt-4">
                        <p className="text-sm text-muted-foreground">
                            TypeScript/Node.js example using the built-in <code className="bg-muted px-1 rounded">fetch</code> API (Node 18+). Can also be used with Deno or Bun.
                        </p>
                        <CopyBlock code={typescriptScript} language="typescript" label="backup.ts" />
                    </TabsContent>

                    {/* ── Go ── */}
                    <TabsContent value="go" className="space-y-3 mt-4">
                        <p className="text-sm text-muted-foreground">
                            Go example using the standard library. No external dependencies required.
                        </p>
                        <CopyBlock code={goScript} language="go" label="main.go" />
                    </TabsContent>

                    {/* ── GitHub Actions ── */}
                    <TabsContent value="github" className="space-y-3 mt-4">
                        <p className="text-sm text-muted-foreground">
                            GitHub Actions workflow with schedule and manual trigger. Add <code className="bg-muted px-1 rounded">DBACKUP_URL</code> and <code className="bg-muted px-1 rounded">DBACKUP_API_KEY</code> as repository secrets under Settings → Secrets and variables → Actions.
                        </p>
                        <CopyBlock code={githubActionsWorkflow} language="yaml" label=".github/workflows/backup.yml" />
                    </TabsContent>

                    {/* ── GitLab CI ── */}
                    <TabsContent value="gitlab" className="space-y-3 mt-4">
                        <p className="text-sm text-muted-foreground">
                            GitLab CI pipeline with schedule and manual trigger. Add <code className="bg-muted px-1 rounded">DBACKUP_URL</code> and <code className="bg-muted px-1 rounded">DBACKUP_API_KEY</code> as CI/CD variables under Settings → CI/CD → Variables (mark as masked).
                        </p>
                        <CopyBlock code={gitlabCiPipeline} language="yaml" label=".gitlab-ci.yml" />
                    </TabsContent>

                    {/* ── Ansible ── */}
                    <TabsContent value="ansible" className="space-y-3 mt-4">
                        <p className="text-sm text-muted-foreground">
                            Ansible playbook that triggers a backup and waits for completion with retry logic.
                        </p>
                        <CopyBlock code={ansiblePlaybook} language="yaml" label="backup-playbook.yml" />
                    </TabsContent>
                </Tabs>
                </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}
