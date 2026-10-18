/**
 * Asks a database server what it holds right now: its databases, the tables of one and the rows
 * of a table. A request names a saved source, or brings the adapter and the config of a form.
 * Unlike the cached lists of `database-list-service.ts`, every call here reaches the server.
 *
 * A config of a form is for someone who may change connections of its kind, which the route
 * checks. It runs without the program a request names, see `formConfig`.
 */

import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { registerAdapters } from "@/lib/adapters";
import { assertConfigOffHost, resolveAdapterConfig, withoutBinaryPaths } from "@/lib/adapters/config-resolver";
import type { DatabaseAdapter, DatabaseInfo, TableDataOptions, TableDataResult, TableInfo } from "@/lib/core/interfaces";
import { registry } from "@/lib/core/registry";
import { withHost } from "@/lib/transport";

registerAdapters();

/** A saved source by its id, or the adapter and the plain config of a form. */
export type DatabaseTarget = { sourceId: string } | { adapterId: string; config: unknown };

/** Why a read never reached the server: the saved source does not exist, no adapter has the id, or the adapter cannot do it. */
export type ReadRefusal = "source-missing" | "adapter-missing" | "unsupported";

/** The stats also refuse a request that names neither a source nor an adapter with its config. */
export type StatsRefusal = ReadRefusal | "incomplete";

export type ReadOutcome<T, R extends string = ReadRefusal> = { ok: true; value: T } | { ok: false; reason: R };

const refused = <R extends string>(reason: R): { ok: false; reason: R } => ({ ok: false, reason });

/** The databases of a saved source, none when its adapter cannot list them. */
export async function listSourceDatabases(source: AdapterConfig): Promise<string[]> {
    const adapter = registry.get(source.adapterId) as DatabaseAdapter | undefined;
    if (!adapter?.getDatabases) return [];
    const listDatabases = adapter.getDatabases;

    const config = await resolveAdapterConfig(source);
    return withHost(adapter, config, (host) => listDatabases(config, host));
}

export interface DatabaseStatsInput {
    sourceId?: string;
    adapterId?: string;
    config?: unknown;
}

export interface DatabaseStats {
    databases: DatabaseInfo[];
    serverVersion?: string;
    serverEdition?: string;
}

/**
 * The databases of a server with their size and table count, and the version of the server.
 * A saved source is only read when the request brings no config of its own.
 */
export async function readDatabaseStats(input: DatabaseStatsInput): Promise<ReadOutcome<DatabaseStats, StatsRefusal>> {
    let adapterId = input.adapterId;
    let config = input.config;
    if (input.sourceId && !input.config) {
        const source = await prisma.adapterConfig.findUnique({ where: { id: input.sourceId } });
        if (!source) return refused("source-missing");
        adapterId = source.adapterId;
        config = await resolveAdapterConfig(source);
    }
    if (!adapterId || !config) return refused("incomplete");
    if (input.config) config = await formConfig(adapterId, input.config);

    const adapter = registry.get(adapterId) as DatabaseAdapter | undefined;
    if (!adapter) return refused("adapter-missing");

    const withStats = adapter.getDatabasesWithStats;
    const listNames = adapter.getDatabases;
    if (!withStats && !listNames) return refused("unsupported");

    const statsConfig = config;
    let serverVersion: string | undefined;
    let serverEdition: string | undefined;

    // One host for the whole request: listing the databases and probing the version used to
    // open two connections to the same machine.
    const databases: DatabaseInfo[] = await withHost(adapter, statsConfig, async (host) => {
        const listed = withStats
            ? await withStats(statsConfig, host)
            : (await listNames!(statsConfig, host)).map((name) => ({ name }));

        if (adapter.test) {
            try {
                const testResult = await adapter.test(statsConfig, host) as { success: boolean; version?: string; edition?: string };
                if (testResult.success) {
                    serverVersion = testResult.version;
                    serverEdition = testResult.edition;
                }
            } catch {
                // The version is a nice to have, the list is what was asked for.
            }
        }

        return listed;
    });

    return { ok: true, value: { databases, serverVersion, serverEdition } };
}

/** The tables or collections of one database. */
export async function listTables(target: DatabaseTarget, database: string): Promise<ReadOutcome<TableInfo[]>> {
    const resolved = await resolveTarget(target);
    if (!resolved.ok) return resolved;
    const { adapter, config } = resolved.value;

    const getTables = adapter.getTables;
    if (!getTables) return refused("unsupported");

    const tables = await withHost(adapter, config, (host) => getTables(config, database, host));
    return { ok: true, value: tables };
}

/** One page of the rows of a table or collection. */
export async function readTableData(target: DatabaseTarget, options: TableDataOptions): Promise<ReadOutcome<TableDataResult>> {
    const resolved = await resolveTarget(target);
    if (!resolved.ok) return resolved;
    const { adapter, config } = resolved.value;

    const getTableData = adapter.getTableData;
    if (!getTableData) return refused("unsupported");

    const result = await withHost(adapter, config, (host) => getTableData(config, options, host));
    return { ok: true, value: result };
}

/**
 * The config of a form as a read runs it: without a path to a program like `sqliteBinaryPath`, so
 * a read never runs a program the request picked, and never on the server DBackup runs on while a
 * customer, All tenants or an account of no tenant asks.
 */
async function formConfig(adapterId: string, submitted: unknown): Promise<Record<string, unknown>> {
    const config = withoutBinaryPaths(submitted && typeof submitted === "object" ? (submitted as Record<string, unknown>) : {});
    await assertConfigOffHost(adapterId, config);
    return config;
}

/** The adapter a target reads with and its config in plain text, with the logins of a saved source on top. */
async function resolveTarget(target: DatabaseTarget): Promise<ReadOutcome<{ adapter: DatabaseAdapter; config: unknown }>> {
    let adapterId: string;
    let config: unknown;
    if ("sourceId" in target) {
        const source = await prisma.adapterConfig.findUnique({ where: { id: target.sourceId } });
        if (!source) return refused("source-missing");
        adapterId = source.adapterId;
        config = await resolveAdapterConfig(source);
    } else {
        adapterId = target.adapterId;
        config = await formConfig(adapterId, target.config);
    }

    const adapter = registry.get(adapterId) as DatabaseAdapter | undefined;
    if (!adapter) return refused("adapter-missing");
    return { ok: true, value: { adapter, config } };
}
