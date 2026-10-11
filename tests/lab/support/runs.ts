/**
 * Backups and restores through the real queue, runner and restore pipeline, waited for until
 * they finish. Nothing here talks to an adapter itself.
 */

import type { Execution } from "@prisma/client";
import prisma from "@/lib/prisma";
import { createEncryptionProfile } from "@/services/backup/encryption-service";
import { extractLastError } from "@/services/dashboard/health";
import { jobService } from "@/services/jobs/job-service";
import { restoreService } from "@/services/restore/restore-service";
import type { RestoreInput } from "@/services/restore/types";

const FINISHED = ["Success", "Partial", "Failed", "Cancelled"];

async function waitFor(executionId: string, minutes = 15): Promise<Execution> {
    const deadline = Date.now() + minutes * 60_000;
    let execution = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
    while (!FINISHED.includes(execution.status)) {
        if (Date.now() > deadline) throw new Error(`Run ${executionId} still ${execution.status} after ${minutes} minutes`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        execution = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
    }
    return execution;
}

/** The last error of a run, for the message of a failed expectation. */
export const problemOf = (execution: Execution) => `${execution.status}: ${extractLastError(execution.logs) ?? "no error in the log"}`;

export function namesIn(execution: Execution): string[] {
    return (JSON.parse(execution.metadata ?? "{}") as { names?: string[] }).names ?? [];
}

let keyId: string | undefined;

/** The Vault key the jobs of the tests encrypt with. */
async function testKey(): Promise<string> {
    keyId ??= (await createEncryptionProfile(`Lab test key ${Date.now()}`, "Made by the lab tests")).id;
    return keyId;
}

/**
 * A paused job of one source to the destinations given, encrypted and compressed like most real
 * jobs. Every database of a database source, or the whole of a folder source.
 */
export async function createJob(name: string, sourceId: string, destinationIds: string[], kind: "database" | "folder" = "database"): Promise<string> {
    const job = await jobService.createJob({
        name,
        schedule: "0 3 * * *",
        enabled: false,
        ...(kind === "folder" ? { sources: [{ configId: sourceId, priority: 0, path: "/" }] } : { sourceId, databases: [] }),
        destinations: destinationIds.map((configId, priority) => ({
            configId,
            priority,
            retention: JSON.stringify({ mode: "SIMPLE", simple: { keepCount: 10 } }),
            retentionPolicyId: null,
        })),
        encryptionProfileId: await testKey(),
        compression: "GZIP",
        notificationIds: [],
    });
    return job.id;
}

/** Runs a job once, like Run now, and waits for its run. */
export async function backUp(jobId: string): Promise<Execution> {
    const { runJob } = await import("@/lib/runner");
    const started = await runJob(jobId, { type: "Manual", label: "lab tests" });
    const executionId = (started as { executionId?: string }).executionId;
    if (!executionId) throw new Error("The job could not be queued");
    return waitFor(executionId);
}

/** Starts a restore, like the restore page, and waits for it. */
export async function restore(input: RestoreInput): Promise<Execution> {
    const started = await restoreService.restore({ ...input, triggerInfo: { type: "Manual", label: "lab tests" } });
    if (!started.executionId) throw new Error(`The restore did not start: ${started.message}`);
    return waitFor(started.executionId);
}
