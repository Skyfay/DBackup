import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { LogEntry } from "@/lib/core/logs";
import path from "path";
import { randomUUID } from "crypto";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import type { RestoreInput } from "./types";
import { preflightRestore } from "./preflight";
import { runRestorePipeline } from "./pipeline";
import type { ProviderRun } from "./run-logs";
import { providerRunData, recordRefusedRestore } from "./refused-restore";
import { assertCustomerDatabasesConfirmed } from "./customer-databases";
import { assertDatabaseTarget, normalizeDatabaseMapping } from "./database-mapping";
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
     * reads them for every tenant, with nothing but the ids the caller fixed. With
     * `input.shared.provider` the tenant of the server gets a run of the same restore with the whole
     * log in its own History.
     */
    async restoreShared(input: RestoreInput, customerTenantId: string) {
        return runAsSystem(() => this.start(input, customerTenantId));
    }

    private async start(rawInput: RestoreInput, runTenantId?: string) {
        // One mapping shape from here on, so the preflight checks the same databases the
        // pipeline then restores.
        const input: RestoreInput = { ...rawInput, databaseMapping: normalizeDatabaseMapping(rawInput.databaseMapping) };
        assertDatabaseTarget(input.targetDatabaseName);
        const { file } = input;

        // Databases customers hold now on the server go back only once the request confirms it,
        // asked before anything touches the server.
        const overwritten = await assertCustomerDatabasesConfirmed(input);

        try {
            // Pre-flight: throws on permission/version/type incompatibility.
            await preflightRestore(input);
            // Checked right before the run is recorded, since the preflight above can take a while.
            assertNoDatabaseMaintenance("restore");
        } catch (error: unknown) {
            // A customer's restore refused here leaves its runs, failed, with the reason.
            if (input.shared && runTenantId) throw await recordRefusedRestore(input, runTenantId, error);
            throw error;
        }

        // Initial Structured Log
        const initialLog: LogEntry = {
            timestamp: new Date().toISOString(),
            message: input.shared ? `Starting restore of ${input.shared.databaseName}` : `Starting restore for ${path.basename(file)}`,
            level: 'info',
            type: 'general',
            stage: 'Initializing'
        };

        const startedAt = new Date();
        const run: Prisma.ExecutionUncheckedCreateInput = {
            ...(runTenantId ? { tenantId: runTenantId } : {}),
            type: 'Restore',
            status: 'Running',
            logs: JSON.stringify([initialLog]),
            startedAt,
            // The run of a customer never names the archive of the server it came from.
            path: input.shared ? null : file,
            metadata: JSON.stringify({ progress: 0, stage: 'Initializing' }),
            triggerType: input.triggerInfo?.type ?? null,
            triggerLabel: input.triggerInfo?.label ?? null,
        };

        // Start Logging Execution
        const provider = input.shared?.provider;
        let executionId: string;
        let providerRun: ProviderRun | null = null;
        if (input.shared && provider) {
            // Both runs or none, so the provider never misses a restore on its server.
            executionId = randomUUID();
            providerRun = { id: randomUUID(), provider: provider.name, customer: provider.customer };
            await prisma.$transaction([
                prisma.execution.create({ data: { ...run, id: executionId } }),
                prisma.execution.create({ data: providerRunData(providerRun, input, provider.tenantId, executionId, startedAt) }),
            ]);
        } else {
            executionId = (await prisma.execution.create({ data: run })).id;
        }

        // Run in background (do not await)
        runRestorePipeline(executionId, input, providerRun).catch(err => {
            svcLog.error("Background restore failed", { executionId }, wrapError(err));
        });

        return {
            success: true,
            executionId,
            ...(providerRun ? { providerExecutionId: providerRun.id } : {}),
            ...(overwritten.length > 0 ? { overwritten } : {}),
            message: "Restore started",
        };
    }
}

export const restoreService = new RestoreService();
