import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

/**
 * The common tasks of an API key, the first step of New API key. Each holds exactly the
 * permissions its calls need, checked against the routes, so a key for one task can do nothing
 * else. The editor after it changes them freely, Custom starts with none.
 */

export interface ApiKeyTemplate {
    id: "ci" | "widget" | "monitoring" | "download" | "restore" | "read";
    label: string;
    /** The name the new key gets, which can change before it is created. */
    keyName: string;
    description: string;
    /** The call it is made for, shown on its card. */
    call: string;
    permissions: Permission[];
}

const P = PERMISSIONS;

export const API_KEY_TEMPLATES: ApiKeyTemplate[] = [
    {
        id: "ci",
        label: "Run jobs from CI/CD",
        keyName: "CI pipeline",
        description: "Starts a job from a pipeline and waits for its result, like the API trigger of a job",
        call: "POST /api/jobs/{id}/run",
        permissions: [P.JOBS.EXECUTE, P.HISTORY.READ],
    },
    {
        id: "widget",
        label: "Dashboard widget",
        keyName: "Dashboard widget",
        description: "The numbers of the overview for Homepage, Homarr or Grafana",
        call: "GET /api/dashboard/stats",
        permissions: [P.DASHBOARD.READ],
    },
    {
        id: "monitoring",
        label: "Monitoring",
        keyName: "Monitoring",
        description: "Runs, failures and backup counts for Uptime Kuma or a script",
        call: "GET /api/history/runs",
        permissions: [P.JOBS.READ, P.STORAGE.READ, P.HISTORY.READ],
    },
    {
        id: "download",
        label: "Download backups",
        keyName: "Backup download",
        description: "Fetches the latest backup of a job to another server",
        call: "POST /api/storage/{id}/download-url",
        permissions: [P.DESTINATIONS.READ, P.STORAGE.READ, P.STORAGE.DOWNLOAD],
    },
    {
        id: "restore",
        label: "Restore from a script",
        keyName: "Restore script",
        description: "Restores a backup into a database, like for a disaster drill",
        call: "POST /api/storage/{id}/restore",
        permissions: [P.SOURCES.VIEW, P.STORAGE.READ, P.STORAGE.RESTORE, P.HISTORY.READ],
    },
    {
        id: "read",
        label: "Read only",
        keyName: "Read only",
        description: "Reads jobs, runs, backups, connections and templates, changes nothing",
        call: "GET /api/jobs, /api/history/runs, ...",
        permissions: [P.SOURCES.VIEW, P.DESTINATIONS.READ, P.NOTIFICATIONS.READ, P.JOBS.READ, P.STORAGE.READ, P.HISTORY.READ, P.DASHBOARD.READ, P.TEMPLATES.READ],
    },
];

export function apiKeyTemplate(id: string | null | undefined): ApiKeyTemplate | undefined {
    return API_KEY_TEMPLATES.find((template) => template.id === id);
}

/** The permission the first call of the example of every task needs, in the order a key without a task tries them. */
const EXAMPLE_NEEDS: [ApiKeyTemplate["id"], Permission][] = [
    ["ci", P.JOBS.EXECUTE],
    ["monitoring", P.HISTORY.READ],
    ["widget", P.DASHBOARD.READ],
    ["download", P.STORAGE.READ],
    ["restore", P.STORAGE.RESTORE],
];

/**
 * The task whose example a key with these permissions can run, for a key made with Custom or a
 * copy and for a rotated one. Null falls back to listing the jobs.
 */
export function exampleTaskFor(permissions: readonly string[]): ApiKeyTemplate["id"] | null {
    return EXAMPLE_NEEDS.find(([, needs]) => permissions.includes(needs))?.[0] ?? null;
}

/**
 * A first request that works with the key of a task, for the dialog that shows the key once. Without
 * the key, like in the panel of a key, it reads the key from `$DBACKUP_KEY`.
 */
export function templateExample(id: string | null | undefined, baseUrl: string, key: string | null): { name: string; code: string } {
    const auth = `  -H "Authorization: Bearer ${key ? "$KEY" : "$DBACKUP_KEY"}"`;
    const lines = (...body: string[]) => (key ? [`KEY=${key}`, ...body] : body).join("\n");
    switch (id) {
        case "ci":
            return {
                name: "Start a job and wait for it",
                code: lines(
                    `RUN=$(curl -s -X POST ${baseUrl}/api/jobs/JOB_ID/run \\`,
                    `${auth})`,
                    `curl -s ${baseUrl}/api/executions/$(echo "$RUN" | jq -r .executionId) \\`,
                    auth
                ),
            };
        case "widget":
            return { name: "Read the numbers of the overview", code: lines(`curl -s ${baseUrl}/api/dashboard/stats \\`, auth) };
        case "monitoring":
            return { name: "Read the latest runs", code: lines(`curl -s "${baseUrl}/api/history/runs?pageSize=10" \\`, auth) };
        case "download":
            return { name: "List the backups of a destination", code: lines(`curl -s ${baseUrl}/api/storage/DESTINATION_ID/files \\`, auth) };
        case "restore":
            return {
                name: "List what a backup holds",
                code: lines(`curl -s -X POST ${baseUrl}/api/storage/DESTINATION_ID/analyze \\`, `${auth} \\`, `  -H "Content-Type: application/json" -d '{"file": "PATH"}'`),
            };
        default:
            return { name: "List the jobs", code: lines(`curl -s ${baseUrl}/api/jobs \\`, auth) };
    }
}
