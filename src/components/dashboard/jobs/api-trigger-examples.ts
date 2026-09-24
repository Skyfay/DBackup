/**
 * What the API trigger dialog shows: the requests that start a job and follow its run, and ready
 * examples that do both. Plain data without React, so the tests read the code the dialog copies.
 */
import type { CodeLanguage } from "@/components/ui/code-block";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** Where the examples send their requests, and with which key. */
export interface TriggerTarget {
    baseUrl: string;
    jobId: string;
    apiKey: string;
}

/** One file of an example, like the script itself or a request of cURL. */
export interface ExampleFile {
    /** A heading above it, for an example of several files. */
    title?: string;
    /** The file it is saved as, or what it is. */
    name: string;
    language: CodeLanguage;
    code: (target: TriggerTarget) => string;
    /** A line under it on what to do with it. */
    note?: string;
}

export interface TriggerExample {
    id: string;
    group: "script" | "pipeline";
    label: string;
    /** What it does and what it needs. */
    description: string;
    files: ExampleFile[];
    /** Reads the address and the key from the secrets of the pipeline instead of its file. */
    secrets?: boolean;
}

/** The key the examples show until one is made in the dialog. */
export const KEY_PLACEHOLDER = "dbackup_YOUR_API_KEY";

/** What a key needs to start the job and follow its run. */
export const TRIGGER_PERMISSIONS = [PERMISSIONS.JOBS.EXECUTE, PERMISSIONS.HISTORY.READ];

/** The secrets a pipeline reads, so the job ID is the only thing in its file that points at DBackup. */
export const PIPELINE_SECRETS = ["DBACKUP_URL", "DBACKUP_API_KEY"] as const;

export const triggerUrl = ({ baseUrl, jobId }: Pick<TriggerTarget, "baseUrl" | "jobId">) => `${baseUrl}/api/jobs/${jobId}/run`;

export const statusUrl = (baseUrl: string, executionId = "{executionId}") => `${baseUrl}/api/executions/${executionId}`;

/** How a run ends, and the exit code every script gives for it. */
export const OUTCOMES = [
    { status: "Success", exit: 0 },
    { status: "Partial", exit: 2 },
    { status: "Failed", exit: 1 },
    { status: "Cancelled", exit: 1 },
] as const;

export function curlTrigger(target: TriggerTarget): string {
    return `curl -X POST "${triggerUrl(target)}" \\
  -H "Authorization: Bearer ${target.apiKey}"`;
}

export function curlStatus({ baseUrl, apiKey }: TriggerTarget, query = ""): string {
    return `curl "${statusUrl(baseUrl, "EXECUTION_ID")}${query}" \\
  -H "Authorization: Bearer ${apiKey}"`;
}

/** What the two requests answer, for the Overview. */
export const RESPONSE_EXAMPLES = {
    trigger: `{
  "success": true,
  "executionId": "cm8x2k9f40001",
  "message": "Job queued successfully"
}`,
    status: `{
  "success": true,
  "data": {
    "status": "Running",
    "progress": 45,
    "stage": "Uploading",
    "error": null
  }
}`,
};
