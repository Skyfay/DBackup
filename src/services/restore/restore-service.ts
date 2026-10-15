import prisma from "@/lib/prisma";
import { LogEntry } from "@/lib/core/logs";
import path from "path";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import type { RestoreInput } from "./types";
import { preflightRestore } from "./preflight";
import { runRestorePipeline } from "./pipeline";
import { normalizeDatabaseMapping } from "./database-mapping";
import { assertNoDatabaseMaintenance } from "@/lib/server/database-maintenance";
import { runAsSystem } from "@/lib/tenant/context";

const svcLog = logger.child({ service: "RestoreService" });

// Ensure adapters are loaded at module init
registerAdapters();

export type { RestoreInput };

/**
 * Facade for the restore subsystem. Implementation lives under `src/services/restore/`:
 *   - types.ts          → RestoreInput
 *   - preflight.ts      → permission probe + version compatibility checks
 *   - smart-recovery.ts → encryption-key matching across profiles
 *   - pipeline.ts       → background download → decrypt → decompress → restore pipeline
 */
export class RestoreService {
    async restore(rawInput: RestoreInput) {
        return this.start(rawInput);
    }

    /**
     * Restores a database given to a customer on a shared server of another tenant, which the
     * caller checked. The run belongs to the customer, so it shows in their history. The backup,
     * its destination, its key and the server belong to the tenant of the server, so the restore
     * reads them for every tenant, with nothing but the ids the caller fixed.
     */
    async restoreShared(input: RestoreInput, customerTenantId: string) {
        return runAsSystem(() => this.start(input, customerTenantId));
    }

    private async start(rawInput: RestoreInput, runTenantId?: string) {
        // One mapping shape from here on, so the preflight checks the same databases the
        // pipeline then restores.
        const input: RestoreInput = { ...rawInput, databaseMapping: normalizeDatabaseMapping(rawInput.databaseMapping) };
        const { file } = input;

        // Pre-flight: throws on permission/version/type incompatibility.
        await preflightRestore(input);

        // Initial Structured Log
        const initialLog: LogEntry = {
            timestamp: new Date().toISOString(),
            message: input.shared ? `Starting restore of ${input.shared.databaseName}` : `Starting restore for ${path.basename(file)}`,
            level: 'info',
            type: 'general',
            stage: 'Initializing'
        };

        // Checked right before the run is recorded, since the preflight above can take a while.
        assertNoDatabaseMaintenance("restore");

        // Start Logging Execution
        const execution = await prisma.execution.create({
            data: {
                ...(runTenantId ? { tenantId: runTenantId } : {}),
                type: 'Restore',
                status: 'Running',
                logs: JSON.stringify([initialLog]),
                startedAt: new Date(),
                // The run of a customer never names the archive of the server it came from.
                path: input.shared ? null : file,
                metadata: JSON.stringify({ progress: 0, stage: 'Initializing' }),
                triggerType: input.triggerInfo?.type ?? null,
                triggerLabel: input.triggerInfo?.label ?? null,
            }
        });
        const executionId = execution.id;

        // Run in background (do not await)
        runRestorePipeline(executionId, input).catch(err => {
            svcLog.error("Background restore failed", { executionId }, wrapError(err));
        });

        return { success: true, executionId, message: "Restore started" };
    }
}

export const restoreService = new RestoreService();
