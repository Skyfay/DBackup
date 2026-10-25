/**
 * The runs of a customer's restore of a shared database, beside the customer's own: the provider's
 * run of the same restore, and both runs of a restore refused before it started.
 *
 * A restore the checks before the start refuse, like the version guard, a local network the tenant
 * of the server blocks or a database the server will not prepare, leaves both runs, failed. The
 * customer's names the reason in the words of `shared-restore-log.ts`, the provider's the whole
 * reason, so the customer reads more than that the restore could not be started and the provider
 * learns of it.
 */

import path from "path";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { LogEntry } from "@/lib/core/logs";
import { FOLLOWS_KEY, providerHint } from "@/lib/execution/follower-runs";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { getErrorMessage, NotFoundError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { findDestination } from "@/services/sharing/destination-access";
import { listedDatabases } from "@/services/tenant/shared-servers";
import type { ProviderRun } from "./run-logs";
import { sharedLogScrubber } from "./shared-restore-log";
import type { RestoreInput } from "./types";

const svcLog = logger.child({ service: "RestoreService" });

/** A customer's restore refused before it started, with the runs that say why. */
export class SharedRestoreRefused extends Error {
    constructor(
        /** The reason as the customer reads it. */
        readonly reason: string,
        readonly executionId: string,
        readonly providerExecutionId: string | null,
    ) {
        super(reason);
        this.name = "SharedRestoreRefused";
    }
}

/**
 * The provider's run of a customer's restore of a database on its shared server: started by the
 * person of the customer, like "Acme · Sara", and linked to the customer's run by its id.
 */
export function providerRunData(providerRun: ProviderRun, input: RestoreInput, tenantId: string, customerRun: string, startedAt: Date): Prisma.ExecutionUncheckedCreateInput {
    const database = input.shared?.databaseName;
    const person = input.triggerInfo?.label;
    return {
        id: providerRun.id,
        tenantId,
        type: "Restore",
        status: "Running",
        logs: JSON.stringify([{
            timestamp: startedAt.toISOString(),
            message: `Starting restore of ${database} for ${providerRun.customer} out of ${path.basename(input.file)}`,
            level: "info",
            type: "general",
            stage: "Initializing",
        } satisfies LogEntry]),
        startedAt,
        path: input.file,
        metadata: JSON.stringify({ progress: 0, stage: "Initializing", restoreOf: { database, customer: providerRun.customer }, [FOLLOWS_KEY]: customerRun }),
        triggerType: input.triggerInfo?.type ?? null,
        triggerLabel: person ? `${providerRun.customer} · ${person}` : providerRun.customer,
    };
}

/**
 * The reason in the words of the customer's run: the version guard as it is, with the versions by
 * their number, and anything else without the server, its paths, the archive or other databases.
 */
async function customerReason(input: RestoreInput, reason: string): Promise<string> {
    const databaseName = input.shared?.databaseName ?? "";
    const target = input.targetSourceId ? await prisma.adapterConfig.findUnique({ where: { id: input.targetSourceId } }).catch(() => null) : null;
    // A connection whose settings cannot be used, the reason the restore was refused, hides by shape alone.
    const connection = target ? await (resolveAdapterConfig(target) as Promise<Record<string, unknown>>).catch(() => ({})) : {};
    const [destination, listed] = await Promise.all([
        findDestination(input.storageConfigId, input.shared?.copyTenantId).then((found) => found.row.name).catch(() => null),
        input.targetSourceId ? listedDatabases(input.targetSourceId).catch(() => []) : [],
    ]);
    return sharedLogScrubber({
        keep: [databaseName],
        archive: input.file,
        destination,
        connection,
        otherDatabases: listed.map((database) => database.name),
    }).text(reason);
}

/**
 * Records a customer's restore that was refused before it started, as a failed run of the customer
 * and, with `input.shared.provider`, a failed run of the provider, both or none. Returns the error
 * the caller throws in place of the refusal.
 */
export async function recordRefusedRestore(input: RestoreInput, customerTenantId: string, error: unknown): Promise<SharedRestoreRefused> {
    const databaseName = input.shared?.databaseName ?? "the database";
    const provider = input.shared?.provider;
    const full = getErrorMessage(error);
    // A record that is gone names it by its id, which says nothing to the customer.
    const reason = error instanceof NotFoundError ? "The backup or its server is not there any more." : await customerReason(input, full);
    const at = new Date();
    const entry = (message: string, level: LogEntry["level"] = "info"): LogEntry => ({ timestamp: at.toISOString(), message, level, type: "general", stage: "Initializing" });
    const target = input.targetSourceId
        ? await prisma.adapterConfig.findUnique({ where: { id: input.targetSourceId }, select: { id: true, name: true, adapterId: true } }).catch(() => null)
        : null;

    const executionId = randomUUID();
    const providerRun: ProviderRun | null = provider ? { id: randomUUID(), provider: provider.name, customer: provider.customer } : null;
    const customerRun: Prisma.ExecutionUncheckedCreateInput = {
        id: executionId,
        tenantId: customerTenantId,
        type: "Restore",
        status: "Failed",
        startedAt: at,
        endedAt: at,
        path: null,
        logs: JSON.stringify([
            entry(`Starting restore of ${databaseName}`),
            entry(`The restore was refused before it started: ${reason}`, "error"),
            ...(providerRun ? [entry(providerHint(providerRun.provider))] : []),
        ]),
        metadata: JSON.stringify({
            progress: 0, stage: "Failed", restoreOf: { database: databaseName },
            ...(target ? { target: { name: target.name, adapterId: target.adapterId } } : {}),
        }),
        triggerType: input.triggerInfo?.type ?? null,
        triggerLabel: input.triggerInfo?.label ?? null,
    };
    const runs: Prisma.ExecutionUncheckedCreateInput[] = [customerRun];
    if (providerRun && provider) {
        const data = providerRunData(providerRun, input, provider.tenantId, executionId, at);
        runs.push({
            ...data,
            status: "Failed",
            endedAt: at,
            logs: JSON.stringify([...(JSON.parse(data.logs as string) as LogEntry[]), entry(`The restore was refused before it started: ${full}`, "error")]),
            metadata: JSON.stringify({ ...(JSON.parse(data.metadata as string) as Record<string, unknown>), stage: "Failed", ...(target ? { target } : {}) }),
        });
    }
    try {
        await prisma.$transaction(runs.map((run) => prisma.execution.create({ data: run })));
    } catch (recordError: unknown) {
        // The refusal still reaches the customer, only its runs are missing.
        svcLog.error("Recording a refused shared restore failed", { targetSourceId: input.targetSourceId }, wrapError(recordError));
        return new SharedRestoreRefused(reason, "", null);
    }
    return new SharedRestoreRefused(reason, executionId, providerRun?.id ?? null);
}
