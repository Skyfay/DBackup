import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ module: "ExecutionRecovery" });

function storedMetadata(metadata: string | null): Record<string, unknown> {
    if (!metadata) return {};
    try {
        const value: unknown = JSON.parse(metadata);
        return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

/**
 * Recovers stale executions on application startup.
 *
 * When the application is hard-killed (e.g. crash, SIGKILL, power loss),
 * running and pending executions remain in a stale state because the
 * graceful shutdown handler never ran. This function detects and marks
 * them as failed so they don't block the queue or mislead users.
 */
export async function recoverStaleExecutions(): Promise<void> {
    try {
        const staleExecutions = await prisma.execution.findMany({
            where: {
                status: { in: ["Running", "Pending"] },
            },
            select: {
                id: true,
                status: true,
                jobId: true,
                logs: true,
                metadata: true,
            },
        });

        if (staleExecutions.length === 0) {
            log.debug("No stale executions found");
            return;
        }

        log.warn(`Found ${staleExecutions.length} stale execution(s) from previous run`, {
            ids: staleExecutions.map((e) => e.id),
        });

        for (const execution of staleExecutions) {
            try {
                // Append a log entry explaining the failure
                let existingLogs: unknown[] = [];
                try {
                    existingLogs = execution.logs ? JSON.parse(execution.logs) : [];
                } catch {
                    existingLogs = [];
                }

                existingLogs.push({
                    timestamp: new Date().toISOString(),
                    level: "error",
                    type: "general",
                    message:
                        execution.status === "Running"
                            ? "Execution was interrupted by an unexpected application shutdown"
                            : "Execution was cancelled because the application shut down before it could start",
                    stage: "Recovery",
                });

                await prisma.execution.update({
                    where: { id: execution.id },
                    data: {
                        status: "Failed",
                        endedAt: new Date(),
                        logs: JSON.stringify(existingLogs),
                        // What else the metadata says stays, like the server a restore went to,
                        // which names the run in History.
                        metadata: JSON.stringify({
                            ...storedMetadata(execution.metadata),
                            progress: 0,
                            stage: "Failed (Application Restart)",
                        }),
                    },
                });

                log.info(`Marked stale execution as failed`, {
                    executionId: execution.id,
                    previousStatus: execution.status,
                    jobId: execution.jobId,
                });
            } catch (error) {
                log.error(`Failed to recover execution ${execution.id}`, {
                    executionId: execution.id,
                    error: String(error),
                });
            }
        }

        log.info(`Stale execution recovery complete`, {
            recovered: staleExecutions.length,
        });
    } catch (error) {
        log.error("Stale execution recovery failed", {
            error: String(error),
        });
    }
}
