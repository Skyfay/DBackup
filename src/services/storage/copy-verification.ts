import prisma from "@/lib/prisma";
import { SystemTaskRunner } from "@/lib/runner/system-task-runner";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import { logger } from "@/lib/logging/logger";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
import { notify } from "@/services/notifications/system-notification-service";
import { checksNatively, verificationService, type FileVerificationResult } from "./verification-service";

const log = logger.child({ service: "CopyVerification" });

/** One copy of a backup: the destination and the path of the file there. */
export interface CopyTarget {
    destinationId: string;
    file: string;
}

export type CopyCheckState = "waiting" | "checking" | "passed" | "failed" | "skipped" | "error";

/** Where the check of one copy stands, as the dialog that started it shows it. */
export interface CopyCheck {
    destinationId: string;
    file: string;
    state: CopyCheckState;
    method?: "native" | "download";
    /** Bytes downloaded so far and in all, while a copy is downloaded to be hashed. */
    processed?: number;
    total?: number;
    /** Why a copy was skipped or could not be checked. */
    reason?: string;
    verifiedAt?: string;
}

export interface CopyVerification {
    executionId: string;
    /** The status of the run: Pending, Running, Success or Failed. */
    status: string;
    progress: number;
    copies: CopyCheck[];
}

const STAGES: Record<string, [number, number]> = {
    Initializing: [0, 0],
    Verifying: [0, 100],
    Completed: [100, 100],
    Failed: [100, 100],
};

const REASONS: Partial<Record<FileVerificationResult["status"], string>> = {
    no_metadata: "No .meta.json lies beside it",
    no_checksum: "No checksum was stored for it",
    skipped: "It was verified already",
    download_error: "The download failed",
};

/** Puts the result of a check on its copy, and returns the state it left. */
function settle(check: CopyCheck, result: FileVerificationResult): CopyCheckState {
    check.verifiedAt = result.verifiedAt;
    if (result.method) check.method = result.method;
    if (result.status === "passed" || result.status === "failed") {
        check.state = result.status;
    } else {
        check.state = result.status === "download_error" ? "error" : "skipped";
        check.reason = REASONS[result.status] ?? result.status;
    }
    return check.state;
}

/**
 * Checks copies of a backup one after the other in one run, which History lists. Copies whose
 * destination checks its own checksum go first, since they take seconds, and the ones that have
 * to be downloaded and hashed after them. Returns at once, the run goes on in the background.
 */
export async function startCopyVerification(targets: CopyTarget[], triggeredBy: string): Promise<{ executionId: string }> {
    const configs = await prisma.adapterConfig.findMany({
        where: { id: { in: [...new Set(targets.map((target) => target.destinationId))] } },
        select: { id: true, name: true, adapterId: true },
    });
    const byId = new Map(configs.map((config) => [config.id, config]));
    const native = (target: CopyTarget) => checksNatively(byId.get(target.destinationId)?.adapterId ?? "");
    // A stable sort, so the copies keep their order within each kind.
    const ordered = [...targets].sort((a, b) => Number(!native(a)) - Number(!native(b)));

    const runner = await SystemTaskRunner.create("Verification", "Manual", triggeredBy, STAGES);
    const checks: CopyCheck[] = ordered.map((target) => ({ ...target, state: "waiting" }));
    runner.setExtra({ copies: checks });

    void (async () => {
        const failures: { file: string; destination: string; expected: string; actual: string }[] = [];
        try {
            await runner.start();
            runner.setStage("Verifying");
            for (const [index, check] of checks.entries()) {
                const name = byId.get(check.destinationId)?.name ?? check.destinationId;
                check.state = "checking";
                runner.setExtra({ copies: checks });
                runner.logEntry(`Verifying the copy at ${name}`, "info");
                try {
                    const result = await verificationService.verifyFile(check.destinationId, check.file, "manual", {
                        onProgress: (processed, total) => {
                            check.method = "download";
                            check.processed = processed;
                            check.total = total;
                            runner.setProgress(((index + (total > 0 ? processed / total : 0)) / checks.length) * 100);
                            runner.setExtra({ copies: checks });
                        },
                    });
                    const state = settle(check, result);
                    if (state === "passed") {
                        runner.logEntry(`The copy at ${name} matches its checksum`, "success");
                    } else if (state === "failed") {
                        failures.push({ file: check.file, destination: name, expected: result.expectedChecksum ?? "", actual: result.actualChecksum ?? "" });
                        runner.logEntry(`The copy at ${name} does not match its checksum`, "error", "general",
                            `Expected: ${result.expectedChecksum ?? "unknown"}\nActual:   ${result.actualChecksum ?? "unknown"}`);
                    } else {
                        runner.logEntry(`Skipped the copy at ${name}: ${check.reason}`, state === "error" ? "error" : "info");
                    }
                } catch (e: unknown) {
                    check.state = "error";
                    check.reason = getErrorMessage(e);
                    runner.logEntry(`Could not check the copy at ${name}: ${check.reason}`, "error");
                }
                runner.setProgress(((index + 1) / checks.length) * 100);
                runner.setExtra({ copies: checks });
            }

            runner.setStage("Completed");
            await runner.finish(checks.some((check) => check.state === "failed" || check.state === "error") ? "Failed" : "Success");
            if (failures.length > 0) {
                await notify({
                    eventType: NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE,
                    data: {
                        totalFiles: checks.length,
                        failed: failures.length,
                        passed: checks.filter((check) => check.state === "passed").length,
                        skipped: checks.filter((check) => check.state === "skipped").length,
                        triggerType: "Manual",
                        errors: failures,
                    },
                });
            }
        } catch (e: unknown) {
            log.error("Copy verification failed", { executionId: runner.id }, wrapError(e));
            runner.logEntry(getErrorMessage(e), "error");
            runner.setStage("Failed");
            await runner.finish("Failed").catch(() => {});
        }
    })();

    return { executionId: runner.id };
}

/** Where a check of copies stands, for the dialog that started it. Null for a run that is none. */
export async function readCopyVerification(executionId: string): Promise<CopyVerification | null> {
    const execution = await prisma.execution.findUnique({ where: { id: executionId }, select: { id: true, type: true, status: true, metadata: true } });
    if (!execution || execution.type !== "Verification") return null;

    let meta: { progress?: number; copies?: CopyCheck[] } = {};
    try {
        meta = execution.metadata ? JSON.parse(execution.metadata) : {};
    } catch {
        meta = {};
    }
    return { executionId: execution.id, status: execution.status, progress: meta.progress ?? 0, copies: meta.copies ?? [] };
}
