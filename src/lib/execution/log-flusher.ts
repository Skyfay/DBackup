import prisma from "@/lib/prisma";
import { LogEntry } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ module: "LogFlusher" });

/** Minimum gap between two writes for the same execution. */
export const DEFAULT_FLUSH_INTERVAL_MS = 1000;

/**
 * Metadata field carrying the moment an execution last made progress.
 *
 * Lives inside the existing metadata JSON rather than in its own column: there are never more
 * than a handful of running executions, so the watchdog reads and parses them all, and that
 * is cheaper than a schema migration for a field nothing queries by.
 */
export const HEARTBEAT_KEY = "heartbeat";

export interface LogFlusherOptions {
    executionId: string;
    /** The live log buffer. Read at write time, so late entries are included. */
    getLogs: () => LogEntry[];
    /** The live progress metadata. Read at write time, for the same reason. */
    getMetadata: () => Record<string, unknown>;
    intervalMs?: number;
}

export interface LogFlusher {
    /**
     * Asks for the current state to reach the database. Throttled, but a request arriving
     * inside the window is deferred rather than dropped.
     */
    schedule(): void;
    /** Writes right now, cancelling any deferred write. Use for the final state of a run. */
    flush(): Promise<void>;
    /**
     * Drops a deferred write without performing it. Must be called when the run ends. Lines
     * written after it, like the notifications of a finished run, still reach the database, but
     * without the progress metadata, which would replace what the run recorded when it ended.
     */
    dispose(): void;
}

/**
 * Persists an execution's logs and progress, at most once per interval.
 *
 * The throttle defers instead of dropping, which is the whole point. A run that records
 * something and then blocks - a directory listing over a network source can block for
 * minutes - would otherwise leave the database holding the state from before that work
 * started, and the history view would show the job sitting at a step it left long ago. That
 * is exactly how a slow backup came to look like one that never started at all.
 *
 * Shared by the backup runner, the system-task runner and the restore pipeline, which each
 * used to carry their own copy of this logic and each dropped writes the same way.
 */
export function createLogFlusher(options: LogFlusherOptions): LogFlusher {
    const { executionId, getLogs, getMetadata } = options;
    const intervalMs = options.intervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

    // Zero rather than "now": the first request writes immediately, so a run's opening state
    // is visible without waiting out a window first.
    let lastWrite = 0;
    let writing = false;
    let disposed = false;
    let repeatRequested = false;
    let timer: NodeJS.Timeout | null = null;

    const clearPending = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const write = async () => {
        lastWrite = Date.now();
        try {
            await prisma.execution.update({
                where: { id: executionId },
                data: disposed ? { logs: JSON.stringify(getLogs()) } : {
                    logs: JSON.stringify(getLogs()),
                    // The heartbeat is written here and nowhere else, precisely because it
                    // must record real progress. Nothing keeps it warm on a timer: a run whose
                    // pipeline has stopped stops updating it, which is what lets the watchdog
                    // tell a long backup apart from a stuck one.
                    metadata: JSON.stringify({ ...getMetadata(), [HEARTBEAT_KEY]: new Date().toISOString() }),
                },
            });
        } catch (error) {
            // Logged, never thrown: losing a progress write must not fail the backup it is
            // only reporting on.
            log.error("Failed to flush execution logs", { executionId }, wrapError(error));
        }
    };

    const run = async () => {
        if (writing) {
            // One repeat is enough however many requests arrive while a write is in flight -
            // the state is read inside write(), so the repeat already carries the newest of
            // them. Counting them would only mean writing the same rows again.
            repeatRequested = true;
            return;
        }

        writing = true;
        try {
            await write();
            if (repeatRequested) {
                repeatRequested = false;
                await write();
            }
        } finally {
            writing = false;
        }
    };

    return {
        schedule() {
            if (timer) return;

            const elapsed = Date.now() - lastWrite;
            if (elapsed >= intervalMs) {
                void run();
                return;
            }

            timer = setTimeout(() => {
                timer = null;
                void run();
            }, intervalMs - elapsed);
            // A deferred progress write is not a reason to keep the process alive at
            // shutdown - the final flush() is what has to land, and it is awaited.
            timer.unref?.();
        },

        async flush() {
            clearPending();
            await run();
        },

        dispose() {
            disposed = true;
            clearPending();
        },
    };
}
