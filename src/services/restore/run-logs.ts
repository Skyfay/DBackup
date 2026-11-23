/**
 * The log of a restore run, and of the provider's run beside it when a customer restores a database
 * of a shared server.
 *
 * The customer's run lands in the customer's History and names their database alone, see
 * `shared-restore-log.ts`. Whoever looks after the server needs the whole story when such a restore
 * fails, so the tenant of the server gets a run of its own: the same restore with every line in
 * full, the archive, the destination, the commands and the errors of the server's tools. Both runs
 * share their progress and end with the same status. The provider's run follows the customer's, see
 * `src/lib/execution/follower-runs.ts`.
 */

import prisma from "@/lib/prisma";
import type { LogEntry, LogLevel, LogType } from "@/lib/core/logs";
import { createLogFlusher } from "@/lib/execution/log-flusher";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import type { RunLog } from "./shared-restore-log";
import { providerHint } from "@/lib/execution/follower-runs";

const svcLog = logger.child({ service: "RestoreService" });

/** The provider's run of a customer's restore of a database on its shared server. */
export interface ProviderRun {
    id: string;
    /** The name of the tenant of the server, as the customer reads it. */
    provider: string;
    /** The name of the customer's tenant. */
    customer: string;
}

/** The two logs of a customer's restore, for a line they read apart. */
export interface SharedRunLogs {
    /** The customer's run, which names their database alone. */
    customer: RunLog;
    /** The provider's run, which reads every line in full. */
    provider: RunLog;
}

export interface RestoreLogs {
    /** A line every run of the restore reads. */
    log: RunLog;
    /**
     * A line the runs read apart: the words of the customer's run, null for none, and the full line,
     * which the provider's run reads and every restore of no customer.
     */
    split(customer: string | null, full: string, level?: LogLevel, type?: LogType): void;
    /** The logs on their own, for a customer's restore with a provider's run. */
    sinks: SharedRunLogs | null;
    /** A line built already, like the length of a stage, which every run reads. */
    add(entry: LogEntry): void;
    /** Writes the logs and the progress, now or within the second. */
    flush(force?: boolean): Promise<void>;
    /** Ends every run of the restore with its status and its log. */
    finish(status: string): Promise<void>;
    /** Drops a write that waits. Lines written after it still reach the database. */
    dispose(): void;
}

export interface RestoreLogsOptions {
    executionId: string;
    /** Whether a customer restores a database of a shared server. */
    shared: boolean;
    providerRun: ProviderRun | null;
    stage: () => string;
    /** The progress of the run, and of the provider's run. */
    metadata: () => Record<string, unknown>;
    providerMetadata: () => Record<string, unknown>;
}


export function createRestoreLogs(options: RestoreLogsOptions): RestoreLogs {
    const { executionId, shared, providerRun, stage } = options;
    const own: LogEntry[] = [];
    const full: LogEntry[] | null = providerRun ? [] : null;

    const flushers = [
        createLogFlusher({ executionId, getLogs: () => own, getMetadata: options.metadata }),
        ...(providerRun && full ? [createLogFlusher({ executionId: providerRun.id, getLogs: () => full, getMetadata: options.providerMetadata })] : []),
    ];

    const flush = async (force = false) => {
        if (force) {
            await Promise.all(flushers.map((flusher) => flusher.flush()));
            return;
        }
        for (const flusher of flushers) flusher.schedule();
    };

    const entry = (message: string, level: LogLevel = "info", type: LogType = "general", details?: string): LogEntry => ({
        timestamp: new Date().toISOString(),
        message,
        level,
        type,
        stage: stage(),
        details,
    });

    const into = (...buffers: (LogEntry[] | null)[]): RunLog => (message, level = "info", type = "general", details) => {
        const line = entry(message, level, type, details);
        for (const buffer of buffers) buffer?.push(line);
        void flush(level === "error");
    };
    const toOwn = into(own);
    const toFull = into(full);
    const log = into(own, full);

    const end = async (id: string, status: string, endedAt: Date, lines: LogEntry[]) => {
        await prisma.execution.update({ where: { id }, data: { status, endedAt, logs: JSON.stringify(lines) } });
    };

    return {
        log,
        split(customer, line, level, type) {
            if (!shared) {
                toOwn(line, level, type);
                return;
            }
            if (customer !== null) own.push(entry(customer, level, type));
            full?.push(entry(line, level, type));
            void flush(level === "error");
        },
        sinks: providerRun ? { customer: toOwn, provider: toFull } : null,
        add(line) {
            own.push(line);
            full?.push(line);
        },
        flush,
        async finish(status) {
            if (status === "Failed" && providerRun) own.push(entry(providerHint(providerRun.provider)));
            const endedAt = new Date();
            await end(executionId, status, endedAt, own);
            if (!providerRun || !full) return;
            // The customer's run counts. The provider's run that cannot be ended here follows the
            // customer's run, so the watchdog fails it a while after that run ended, see
            // `endOrphanedFollowers`.
            await end(providerRun.id, status, endedAt, full).catch((error: unknown) => {
                svcLog.error("Ending the provider's run of a restore failed", { executionId, providerRunId: providerRun.id }, wrapError(error));
            });
        },
        dispose() {
            for (const flusher of flushers) flusher.dispose();
        },
    };
}
