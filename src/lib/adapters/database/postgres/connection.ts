import { transportSuffix, type ExecutionHost } from "@/lib/transport";
import { PostgresConfig } from "@/lib/adapters/definitions";
import { DatabaseInfo } from "@/lib/core/interfaces";
import { PSQL, buildConnectionArgs, firstReachableDatabase, pgEnv, dbArg } from "./args";

/**
 * A database adapter cannot fall back to a default transport: guessing "direct"
 * for a source configured for SSH would talk to a different machine and report
 * it healthy. Callers reach these functions through withHost or
 * runConnectivityCheck, both of which always supply one.
 */
function requireHost(host: ExecutionHost | undefined): ExecutionHost {
    if (!host) {
        throw new Error("PostgreSQL adapter requires an execution host. Call it through withHost().");
    }
    return host;
}

export async function test(
    config: PostgresConfig,
    hostArg?: ExecutionHost,
): Promise<{ success: boolean; message: string; version?: string }> {
    let host: ExecutionHost;
    try {
        host = requireHost(hostArg);
    } catch (e: unknown) {
        return { success: false, message: e instanceof Error ? e.message : String(e) };
    }

    const via = transportSuffix(host);

    try {
        const psql = await host.which(...PSQL);
        const outcome = await firstReachableDatabase(
            host,
            config,
            (database) => [
                psql, ...buildConnectionArgs(config), "-d", dbArg(database), "-t", "-c", "SELECT version()",
            ],
            (result) => {
                // "PostgreSQL 16.1 on x86_64-pc-linux-gnu ..." -> "16.1"
                const raw = result.stdout.trim();
                return raw.match(/PostgreSQL\s+([\d.]+)/)?.[1] ?? raw;
            },
        );

        if (!outcome.ok) {
            return { success: false, message: `Connection failed: ${outcome.stderr}` };
        }
        return { success: true, message: `Connection successful${via}`, version: outcome.value };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Connection failed: ${message}` };
    }
}

export async function getDatabases(config: PostgresConfig, hostArg: ExecutionHost): Promise<string[]> {
    const host = requireHost(hostArg);
    const psql = await host.which(...PSQL);

    const outcome = await firstReachableDatabase(
        host,
        config,
        (database) => [
            psql, ...buildConnectionArgs(config), "-d", dbArg(database),
            // -t = tuples only, -A = unaligned
            "-t", "-A", "-c", "SELECT datname FROM pg_database WHERE datistemplate = false;",
        ],
        (result) => result.stdout.split("\n").map(s => s.trim()).filter(s => s),
    );

    if (!outcome.ok) {
        throw new Error(`Failed to list databases: ${outcome.stderr}`);
    }
    return outcome.value;
}

// NOTE: PostgreSQL's information_schema.tables is scoped to the currently connected
// database, so a single-query cross-database table count is not possible.
// Sizes come from one query, then a separate per-database query counts tables.
const pgStatsQuery = `
    SELECT d.datname, pg_database_size(d.datname) AS size_bytes FROM pg_database d WHERE d.datistemplate = false ORDER BY d.datname;
`.trim();

const pgTableCountQuery =
    `SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');`;

function parseStatsOutput(stdout: string): DatabaseInfo[] {
    return stdout
        .split("\n")
        .map(line => line.trim())
        .filter(line => line)
        .map(line => {
            const parts = line.split("\t");
            return {
                name: parts[0],
                sizeInBytes: parseInt(parts[1], 10) || 0,
            };
        });
}

async function countTables(
    host: ExecutionHost,
    config: PostgresConfig,
    psql: string,
    dbName: string,
): Promise<number | undefined> {
    const result = await host.exec(
        [psql, ...buildConnectionArgs(config), "-d", dbArg(dbName), "-t", "-A", "-c", pgTableCountQuery],
        { env: pgEnv(config.password) },
    );
    if (result.code !== 0) return undefined;
    const count = parseInt(result.stdout.trim(), 10);
    return isNaN(count) ? undefined : count;
}

export async function getDatabasesWithStats(config: PostgresConfig, hostArg: ExecutionHost): Promise<DatabaseInfo[]> {
    const host = requireHost(hostArg);
    const psql = await host.which(...PSQL);

    const outcome = await firstReachableDatabase(
        host,
        config,
        (database) => [
            psql, ...buildConnectionArgs(config), "-d", dbArg(database),
            "-t", "-A", "-F", "\t", "-c", pgStatsQuery,
        ],
        async (result) => {
            const stats = parseStatsOutput(result.stdout);
            // One query per database. Over SSH each is a channel, which the
            // transport caps so a wide fan-out cannot exhaust the session limit.
            return Promise.all(
                stats.map(async (entry) => {
                    const tableCount = await countTables(host, config, psql, entry.name);
                    return tableCount !== undefined ? { ...entry, tableCount } : entry;
                }),
            );
        },
    );

    if (!outcome.ok) {
        throw new Error(`Failed to get database stats: ${outcome.stderr}`);
    }
    return outcome.value;
}
