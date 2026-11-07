import prisma from "@/lib/prisma";
import { PIPELINE_STAGES, type LogEntry, type LogLevel } from "@/lib/core/logs";
import { FOLLOWS_KEY, activeFollowersOf, providerHint, type RunFollower } from "@/lib/execution/follower-runs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { formatBytes, formatDuration } from "@/lib/utils";

/**
 * The run a customer sees of a backup they started of a database on a shared server. The backup
 * itself is a run of the job of the tenant of the server, in that tenant's History with every line.
 * The customer's run follows it, see `src/lib/execution/follower-runs.ts`: the same status, its
 * steps and their times, the size of the dump of the customer's database, and a short log this
 * module writes itself. No line of the real run reaches it, so it never names the address of the
 * server, the job, the destinations or another database, whatever the runner logs.
 */

const log = logger.child({ service: "SharedBackupRuns" });

/** The steps of the customer's run. Processing, uploading and verifying are one step, retention and notifications none. */
export const CUSTOMER_BACKUP_STAGES: readonly string[] = ["Queued", "Initializing", "Dumping Databases", "Uploading", "Completed"];

/** The step of the customer's run for a stage of the real run, null for one it does not show. */
const STEP_OF: Record<string, string> = {
    [PIPELINE_STAGES.INITIALIZING]: "Initializing",
    [PIPELINE_STAGES.DUMPING]: "Dumping Databases",
    [PIPELINE_STAGES.PROCESSING]: "Uploading",
    [PIPELINE_STAGES.UPLOADING]: "Uploading",
    [PIPELINE_STAGES.VERIFYING]: "Uploading",
};

const PROGRESS: Record<string, number> = { Queued: 0, Initializing: 10, "Dumping Databases": 30, Uploading: 70, Completed: 100 };

export interface CustomerBackupRun {
    tenantId: string;
    /** The id of the run of the job of the server's tenant, made right after this one. */
    leaderId: string;
    databaseName: string;
    /** The server as the customer knows it. */
    serverName: string;
    adapterId: string;
    providerName: string;
    /** Who started it, the starter of the run. */
    person: string;
}

/** What a customer's run of a backup says of itself, from its metadata. */
export interface BackupOf {
    database: string;
    provider: string;
}

export function backupOf(metadata: Record<string, unknown>): BackupOf | null {
    const value = metadata.backupOf as { database?: unknown; provider?: unknown } | undefined;
    if (!value || typeof value.database !== "string" || !value.database) return null;
    return { database: value.database, provider: typeof value.provider === "string" && value.provider ? value.provider : "The provider" };
}

function line(message: string, stage: string, level: LogLevel = "info", durationMs?: number): LogEntry {
    return { timestamp: new Date().toISOString(), level, type: "general", message, stage, ...(durationMs !== undefined ? { durationMs } : {}) };
}

/**
 * Records the customer's run, waiting, before the real run is queued, so the real run finds it
 * the moment the queue takes it.
 */
export async function createCustomerBackupRun(run: CustomerBackupRun): Promise<string> {
    const metadata = {
        progress: 0,
        stage: "Queued",
        target: { name: run.serverName, adapterId: run.adapterId },
        backupOf: { database: run.databaseName, provider: run.providerName },
        // A run of one database, which the usual length of anything leaves out.
        onlyDatabases: [run.databaseName],
        [FOLLOWS_KEY]: run.leaderId,
    };
    const created = await runAsSystem(() => prisma.execution.create({
        data: {
            tenantId: run.tenantId,
            type: "Backup",
            status: "Pending",
            logs: JSON.stringify([line(`Backup of ${run.databaseName} on ${run.serverName} queued.`, "Queued")]),
            metadata: JSON.stringify(metadata),
            triggerType: "Manual",
            triggerLabel: run.person,
        },
        select: { id: true },
    }));
    return created.id;
}

/** Removes the customer's run of a backup that never got queued. */
export async function dropCustomerBackupRun(id: string): Promise<void> {
    await runAsSystem(() => prisma.execution.deleteMany({ where: { id, status: "Pending" } }));
}

function stored(metadata: string | null): Record<string, unknown> {
    try {
        const value: unknown = metadata ? JSON.parse(metadata) : {};
        return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

/** The size of the dump of the database, from the dumps the real run recorded. */
function dumpSize(dumps: unknown, database: string): number | null {
    if (!Array.isArray(dumps)) return null;
    const dump = (dumps as { name?: unknown; state?: unknown; bytes?: unknown }[]).find((entry) => entry?.name === database);
    return dump && dump.state === "done" && typeof dump.bytes === "number" ? dump.bytes : null;
}

/**
 * The customer's run that follows a real run of a backup, null when the run has none. The runner
 * tells it when the run starts, moves on and ends, and it writes its own lines for each.
 */
export async function customerBackupFollower(leaderId: string): Promise<RunFollower | null> {
    const [row] = await activeFollowersOf(leaderId);
    if (!row) return null;
    const metadata = stored(row.metadata);
    const facts = backupOf(metadata);
    if (!facts) return null;

    const lines: LogEntry[] = (() => {
        try {
            const parsed: unknown = row.logs ? JSON.parse(row.logs) : [];
            return Array.isArray(parsed) ? parsed as LogEntry[] : [];
        } catch {
            return [];
        }
    })();
    let stage = "Queued";
    let since = row.startedAt.getTime();
    let chain: Promise<unknown> = Promise.resolve();

    const meta = () => JSON.stringify({ ...metadata, progress: PROGRESS[stage] ?? 0, stage });
    // In order, one after the other. A write that fails is logged, the real run goes on.
    const write = (data: { status?: string; startedAt?: Date; endedAt?: Date; size?: number | null }) => {
        const logs = JSON.stringify(lines);
        const update = { ...data, logs, metadata: meta() };
        chain = chain
            .then(() => runAsSystem(() => prisma.execution.update({ where: { id: row.id }, data: update })))
            .catch((error: unknown) => log.error("Writing the customer's run of a backup failed", { executionId: row.id, leaderId }, wrapError(error)));
        return chain;
    };
    const close = (word: "completed" | "failed" | "aborted") => {
        const durationMs = Math.max(0, Date.now() - since);
        const level: LogLevel = word === "completed" ? "success" : word === "failed" ? "error" : "warning";
        lines.push(line(`${stage} ${word} (${formatDuration(durationMs)})`, stage, level, durationMs));
    };
    const moveTo = (next: string) => {
        close("completed");
        stage = next;
        since = Date.now();
    };

    return {
        start() {
            moveTo("Initializing");
            lines.push(line(`Backup of ${facts.database} started.`, stage));
            void write({ status: "Running", startedAt: new Date() });
        },
        stage(pipelineStage) {
            const next = STEP_OF[pipelineStage];
            if (!next || next === stage) return;
            moveTo(next);
            lines.push(line(next === "Dumping Databases" ? `Dumping ${facts.database}...` : `Storing the backup of ${facts.database}...`, stage));
            void write({});
        },
        async end({ status, dumps }) {
            const size = dumpSize(dumps, facts.database);
            // Some copies of the provider that failed are the provider's to fix, the backup is there.
            if (status === "Success" || status === "Partial") {
                moveTo("Completed");
                lines.push(line(size !== null ? `Backup of ${facts.database} completed, its dump holds ${formatBytes(size)}.` : `Backup of ${facts.database} completed.`, stage, "success"));
                await write({ status: "Success", endedAt: new Date(), size });
                return;
            }
            if (status === "Cancelled") {
                lines.push(line(`The backup of ${facts.database} was cancelled.`, stage, "warning"));
                close("aborted");
                await write({ status: "Cancelled", endedAt: new Date(), size: null });
                return;
            }
            lines.push(line(`The backup of ${facts.database} failed.`, stage, "error"));
            lines.push(line(providerHint(facts.provider), stage));
            close("failed");
            await write({ status: "Failed", endedAt: new Date(), size: null });
        },
    };
}
