/**
 * Runs the check of the Test connection button against every connection of the lab in the dev
 * database, so a broken lab service or a wrong seed shows before anyone clicks through the app.
 * Imported by the CLI only after it loaded `.env`, like the seed.
 */

import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { registerAdapters } from "@/lib/adapters";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { registry } from "@/lib/core/registry";
import { runAdapterTest } from "@/lib/transport/adapter-invoke";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

export interface CheckResult {
    name: string;
    ok: boolean;
    message: string;
}

const FINISHED = ["Success", "Partial", "Failed", "Cancelled"];

/**
 * Runs every job of the lab once through the real queue and runner, one after the other, and
 * waits for each. Proves that a backup really goes from each source to each destination. The lab
 * lives in the tenant every installation starts with, like the seed puts it.
 */
export function runJobs(onStart: (name: string) => void): Promise<CheckResult[]> {
    return runAsTenant(HOME_TENANT_ID, () => runLabJobs(onStart));
}

async function runLabJobs(onStart: (name: string) => void): Promise<CheckResult[]> {
    const { runJob } = await import("@/lib/runner");
    const { extractLastError } = await import("@/services/dashboard/health");
    const jobs = await prisma.job.findMany({ where: { name: { startsWith: "Lab " } }, orderBy: { name: "asc" } });
    const results: CheckResult[] = [];

    for (const job of jobs) {
        onStart(job.name);
        const started = await runJob(job.id, { type: "Manual", label: "lab:check" });
        const executionId = (started as { executionId?: string }).executionId;
        if (!executionId) {
            results.push({ name: job.name, ok: false, message: "the job could not be queued" });
            continue;
        }
        const deadline = Date.now() + 20 * 60_000;
        let execution = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
        while (!FINISHED.includes(execution.status) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            execution = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
        }
        const seconds = execution.endedAt ? Math.round((execution.endedAt.getTime() - execution.startedAt.getTime()) / 1000) : null;
        const detail = execution.status === "Success" ? `${seconds}s, ${Number(execution.size ?? 0)} bytes` : extractLastError(execution.logs) ?? execution.status;
        results.push({ name: job.name, ok: execution.status === "Success", message: `${execution.status}: ${detail}` });
    }
    return results;
}

/** The Test connection button of one connection. */
export async function checkConnection(row: AdapterConfig): Promise<CheckResult> {
    registerAdapters();
    const adapter = registry.get(row.adapterId);
    if (!adapter) return { name: row.name, ok: false, message: `unknown adapter ${row.adapterId}` };
    try {
        const config = await resolveAdapterConfig(row);
        const result = await runAdapterTest(adapter, config, { timeoutMs: 60_000, label: row.name });
        if (!result) return { name: row.name, ok: true, message: "has no connection test" };
        return { name: row.name, ok: result.success, message: [result.message, result.version].filter(Boolean).join(", ") };
    } catch (error) {
        return { name: row.name, ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}

export function checkConnections(): Promise<CheckResult[]> {
    return runAsTenant(HOME_TENANT_ID, async () => {
        const rows = await prisma.adapterConfig.findMany({ where: { name: { startsWith: "Lab " } }, orderBy: [{ type: "asc" }, { name: "asc" }] });
        return Promise.all(rows.map(checkConnection));
    });
}
