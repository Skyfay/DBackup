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
import { Check, Copy, Webhook } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface ApiTriggerDialogProps {
    jobId: string
    jobName: string
    open: boolean
    onOpenChange: (open: boolean) => void
}

function CopyBlock({ code, language }: { code: string; language: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = () => {
        navigator.clipboard.writeText(code)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className="relative group">
            <pre className="bg-muted rounded-md p-4 text-sm overflow-x-auto whitespace-pre-wrap break-all">
                <code className={`language-${language}`}>{code}</code>
            </pre>
            <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleCopy}
            >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
        </div>
    )
}

export function ApiTriggerDialog({ jobId, jobName, open, onOpenChange }: ApiTriggerDialogProps) {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://your-dbackup-instance.com"

    const triggerCurl = `curl -X POST "${baseUrl}/api/jobs/${jobId}/run" \\
  -H "Authorization: Bearer dbackup_YOUR_API_KEY"`

    const pollCurl = `curl "${baseUrl}/api/executions/EXECUTION_ID" \
  -H "Authorization: Bearer dbackup_YOUR_API_KEY"`

    const pollWithLogsCurl = `curl "${baseUrl}/api/executions/EXECUTION_ID?includeLogs=true" \
  -H "Authorization: Bearer dbackup_YOUR_API_KEY"`

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
            <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Webhook className="h-5 w-5" />
                        API Trigger
                    </DialogTitle>
                    <DialogDescription>
                        Trigger <span className="font-medium">{jobName}</span> via API. Create an API key under Access Management → API Keys with the <code className="text-xs bg-muted px-1 rounded">jobs:execute</code> permission.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="curl" className="mt-2">
                    <TabsList className="w-full">
                        <TabsTrigger value="curl" className="flex-1">cURL</TabsTrigger>
                        <TabsTrigger value="bash" className="flex-1">Bash Script</TabsTrigger>
                        <TabsTrigger value="ansible" className="flex-1">Ansible</TabsTrigger>
                    </TabsList>

                    <TabsContent value="curl" className="space-y-4 mt-4">
                        <div>
                            <h4 className="text-sm font-medium mb-2">Trigger Backup</h4>
                            <CopyBlock code={triggerCurl} language="bash" />
                            <p className="text-xs text-muted-foreground mt-1.5">
                                Returns <code className="bg-muted px-1 rounded">{"{ executionId }"}</code> on success.
                            </p>
                        </div>

                        <div>
                            <h4 className="text-sm font-medium mb-2">Poll Execution Status</h4>
                            <CopyBlock code={pollCurl} language="bash" />
                            <p className="text-xs text-muted-foreground mt-1.5">
                                Returns status (<code className="bg-muted px-1 rounded">Pending</code>, <code className="bg-muted px-1 rounded">Running</code>, <code className="bg-muted px-1 rounded">Success</code>, <code className="bg-muted px-1 rounded">Failed</code>), progress, and stage.
                            </p>
                        </div>

                        <div>
                            <h4 className="text-sm font-medium mb-2">Poll with Logs</h4>
                            <CopyBlock code={pollWithLogsCurl} language="bash" />
                            <p className="text-xs text-muted-foreground mt-1.5">
                                Add <code className="bg-muted px-1 rounded">?includeLogs=true</code> to include execution log entries.
                            </p>
                        </div>
                    </TabsContent>

                    <TabsContent value="bash" className="space-y-4 mt-4">
                        <p className="text-sm text-muted-foreground">
                            Complete script that triggers the backup and polls until completion. Requires <code className="bg-muted px-1 rounded">jq</code> and <code className="bg-muted px-1 rounded">curl</code>.
                        </p>
                        <CopyBlock code={bashScript} language="bash" />
                    </TabsContent>

                    <TabsContent value="ansible" className="space-y-4 mt-4">
                        <p className="text-sm text-muted-foreground">
                            Ansible playbook that triggers a backup and waits for completion with retry logic.
                        </p>
                        <CopyBlock code={ansiblePlaybook} language="yaml" />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
