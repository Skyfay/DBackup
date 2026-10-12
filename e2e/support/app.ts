/**
 * DBackup over its HTTP API, signed in with the session of the admin. The shapes follow the
 * routes, which do not all answer alike: credentials and executions wrap their result in `data`,
 * adapters and jobs return the record itself, a run and a restore return `executionId`.
 */

import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

/** The Vault key the first start makes, which every job of the tests encrypts with. */
export const E2E_KEY = "E2E key";

const FINISHED = ["Success", "Partial", "Failed", "Cancelled"];

/** What a connection is made of, for creating it and for testing it. */
export interface Connection {
    adapterId: string;
    config: Record<string, unknown>;
    primaryCredentialId?: string;
    sshCredentialId?: string;
}

/** A job as the API returns it, with the folder sources a restore names by their id. */
export interface Job {
    id: string;
    sources: { id: string }[];
}

export interface LogEntry {
    level?: string;
    message?: string;
}

export interface Execution {
    id: string;
    status: string;
    path: string | null;
    size: number | null;
    logs?: string | LogEntry[];
}

/** A short name part that no other test of this run uses, safe in a database name. */
export const unique = () => `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class App {
    constructor(private readonly request: APIRequestContext) {}

    /** Sends a request and returns its JSON. A 429 waits and tries again, anything else not ok fails the test. */
    private async send(method: "get" | "post" | "delete", url: string, data?: unknown): Promise<unknown> {
        for (let attempt = 0; ; attempt++) {
            const response: APIResponse = await this.request[method](url, data === undefined ? {} : { data });
            if (response.status() === 429 && attempt < 20) {
                await new Promise((resolve) => setTimeout(resolve, 3_000));
                continue;
            }
            const text = await response.text();
            expect(response.ok(), `${method.toUpperCase()} ${url} answered ${response.status()}: ${text.slice(0, 500)}`).toBe(true);
            return text ? JSON.parse(text) : null;
        }
    }

    async credential(name: string, type: "USERNAME_PASSWORD" | "SSH_KEY" | "ACCESS_KEY" | "SMTP" | "TOKEN" | "WEBHOOK", data: Record<string, unknown>): Promise<string> {
        const result = await this.send("post", "/api/credentials", { name, type, data }) as { data: { id: string } };
        return result.data.id;
    }

    async connection(body: Connection & { name: string; type: "database" | "storage" | "notification"; storageRole?: "SOURCE" | "DESTINATION" }): Promise<string> {
        return (await this.send("post", "/api/adapters", body) as { id: string }).id;
    }

    /** The Test connection button of the connection form, before the connection is saved. */
    async testConnection(body: Connection): Promise<{ success: boolean; message?: string; version?: string }> {
        return await this.send("post", "/api/adapters/test-connection", body) as { success: boolean; message?: string; version?: string };
    }

    /** The backups on a destination, as the Backups page lists them, read from it again. */
    async files(destinationId: string): Promise<{ name: string; path: string; size: number }[]> {
        return await this.send("get", `/api/storage/${destinationId}/files?refresh=true`) as { name: string; path: string; size: number }[];
    }

    async deleteFile(destinationId: string, path: string): Promise<void> {
        await this.send("delete", `/api/storage/${destinationId}/files`, { path });
    }

    async vaultKey(name = E2E_KEY): Promise<string> {
        const result = await this.send("get", "/api/vault/keys") as { data: { id: string; name: string }[] | { keys: { id: string; name: string }[] } };
        const keys = Array.isArray(result.data) ? result.data : result.data.keys;
        const key = keys.find((entry) => entry.name === name);
        expect(key, `the Vault key ${name} of the first start`).toBeTruthy();
        return key!.id;
    }

    /**
     * A paused job to the destinations given, encrypted and compressed like most real jobs. Every
     * database of a database source, or the whole of a folder source.
     */
    async job(name: string, sourceId: string, destinationIds: string[], encryptionProfileId: string, kind: "database" | "folder" = "database"): Promise<Job> {
        const result = await this.send("post", "/api/jobs", {
            name,
            schedule: "0 3 * * *",
            enabled: false,
            ...(kind === "folder" ? { sources: [{ configId: sourceId, priority: 0, path: "/" }] } : { sourceId, databases: [] }),
            destinations: destinationIds.map((configId, priority) => ({ configId, priority, retention: JSON.stringify({ mode: "SIMPLE", simple: { keepCount: 10 } }) })),
            encryptionProfileId,
            compression: "GZIP",
        }) as Job;
        return result;
    }

    /** Runs a job like Run now and waits for its run. */
    async backUp(jobId: string): Promise<Execution> {
        const started = await this.send("post", `/api/jobs/${jobId}/run`, {}) as { executionId: string };
        return this.waitFor(started.executionId);
    }

    /** Starts a restore like the restore page and waits for it. */
    async restore(destinationId: string, body: Record<string, unknown>): Promise<Execution> {
        const started = await this.send("post", `/api/storage/${destinationId}/restore`, body) as { executionId: string };
        return this.waitFor(started.executionId);
    }

    async waitFor(executionId: string, minutes = 10): Promise<Execution> {
        const deadline = Date.now() + minutes * 60_000;
        for (;;) {
            const { data } = await this.send("get", `/api/executions/${executionId}`) as { data: Execution };
            if (FINISHED.includes(data.status)) {
                if (data.status === "Success") return data;
                const { data: withLogs } = await this.send("get", `/api/executions/${executionId}?includeLogs=true`) as { data: Execution };
                return withLogs;
            }
            if (Date.now() > deadline) throw new Error(`Run ${executionId} is still ${data.status} after ${minutes} minutes`);
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
    }
}

/** The errors of a run that did not succeed, for the message of a failed expectation. */
export function problemOf(execution: Execution): string {
    if (execution.status === "Success") return "Success";
    // The route hands the log over as a list already, older runs kept it as JSON text.
    let entries: LogEntry[] = [];
    if (Array.isArray(execution.logs)) entries = execution.logs;
    else {
        try {
            entries = JSON.parse(execution.logs ?? "[]");
        } catch {
            return `${execution.status}: ${execution.logs ?? "no log"}`;
        }
    }
    const errors = entries.filter((entry) => entry.level === "error").map((entry) => entry.message).slice(-3);
    return `${execution.status}: ${errors.join(" | ") || "no error in the log"}`;
}
