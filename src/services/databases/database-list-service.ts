import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { registerAdapters } from "@/lib/adapters";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import type { DatabaseAdapter } from "@/lib/core/interfaces";
import { registry } from "@/lib/core/registry";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { withHost } from "@/lib/transport";
import { withTimeoutInsideScope } from "@/lib/transport/adapter-invoke";
import { cleanListedDatabases } from "./database-explorer-model";

registerAdapters();

const log = logger.child({ service: "DatabaseListService" });

/** A server that has not listed its databases by then counts as a failed read. */
const READ_TIMEOUT_MS = 60_000;
/** Servers read at the same time, so Read now does not open a connection to every server at once. */
const CONCURRENCY = 4;
/** How much of an error the page gets, the rest stays in the log. */
const ERROR_LENGTH = 300;

/**
 * Keeps the databases of every database connection, so the Database Explorer opens without
 * asking a server. The version task reads them every hour and Read now on the page reads them
 * at once. A read that fails keeps the list from before and records why.
 */
export class DatabaseListService {
    /** Reads the databases of one connection and keeps them. Never throws, a failure is recorded instead. */
    async readSource(source: AdapterConfig): Promise<void> {
        const adapter = registry.get(source.adapterId) as DatabaseAdapter | undefined;
        const withStats = adapter?.getDatabasesWithStats;
        const listNames = adapter?.getDatabases;
        if (!adapter || (!withStats && !listNames)) return;

        const attemptedAt = new Date();
        try {
            const config = await resolveAdapterConfig(source);
            const listed = await withHost(adapter, config, (host) => {
                const call = withStats
                    ? withStats.call(adapter, config, host)
                    : listNames!.call(adapter, config, host).then((names) => names.map((name) => ({ name })));
                return withTimeoutInsideScope(call, READ_TIMEOUT_MS, source.name);
            });
            const databasesJson = JSON.stringify(cleanListedDatabases(listed));
            await prisma.databaseListCache.upsert({
                where: { adapterConfigId: source.id },
                create: { adapterConfigId: source.id, databasesJson, readAt: attemptedAt, error: null, attemptedAt },
                update: { databasesJson, readAt: attemptedAt, error: null, attemptedAt },
            });
        } catch (error: unknown) {
            log.warn("Reading the databases failed", { sourceId: source.id, sourceName: source.name }, wrapError(error));
            const message = getErrorMessage(error).slice(0, ERROR_LENGTH);
            try {
                await prisma.databaseListCache.upsert({
                    where: { adapterConfigId: source.id },
                    create: { adapterConfigId: source.id, error: message, attemptedAt },
                    update: { error: message, attemptedAt },
                });
            } catch (saveError: unknown) {
                log.error("Recording a failed read failed", { sourceId: source.id }, wrapError(saveError));
            }
        }
    }

    /** Reads the databases of the given connections, or of every database connection, a few at a time. */
    async readSources(ids?: string[]): Promise<void> {
        const sources = await prisma.adapterConfig.findMany({
            where: { type: "database", ...(ids ? { id: { in: ids } } : {}) },
        });
        let next = 0;
        const worker = async () => {
            while (next < sources.length) {
                const source = sources[next++];
                await this.readSource(source);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker));
    }
}

export const databaseListService = new DatabaseListService();
