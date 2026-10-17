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
import { FOLLOWS_KEY } from "@/lib/execution/follower-runs";
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

        return { success: true, executionId, ...(providerRun ? { providerExecutionId: providerRun.id } : {}), message: "Restore started" };
    }
}

/**
 * The provider's run of a customer's restore of a database on its shared server: started by the
 * person of the customer, like "Acme · Sara", and linked to the customer's run by its id.
 */
function providerRunData(providerRun: ProviderRun, input: RestoreInput, tenantId: string, customerRun: string, startedAt: Date): Prisma.ExecutionUncheckedCreateInput {
    const database = input.shared?.databaseName;
    const person = input.triggerInfo?.label;
    return {
        id: providerRun.id,
        tenantId,
        type: 'Restore',
        status: 'Running',
        logs: JSON.stringify([{
            timestamp: startedAt.toISOString(),
            message: `Starting restore of ${database} for ${providerRun.customer} out of ${path.basename(input.file)}`,
            level: 'info',
            type: 'general',
            stage: 'Initializing',
        } satisfies LogEntry]),
        startedAt,
        path: input.file,
        metadata: JSON.stringify({ progress: 0, stage: 'Initializing', restoreOf: { database, customer: providerRun.customer }, [FOLLOWS_KEY]: customerRun }),
        triggerType: input.triggerInfo?.type ?? null,
        triggerLabel: person ? `${providerRun.customer} · ${person}` : providerRun.customer,
    };
}

export const restoreService = new RestoreService();
