import { transportSuffix, type ExecutionHost } from "@/lib/transport";
import { MySQLConfig } from "@/lib/adapters/definitions";
import { DatabaseInfo } from "@/lib/core/interfaces";
import {
    MYSQL_ADMIN,
    MYSQL_CLIENT,
    buildConnectionArgs,
    withAuthArgs,
} from "./args";
import { connectionClientOf } from "./dump-content";

const SYSTEM_DATABASES = ["information_schema", "mysql", "performance_schema", "sys"];

/**
 * A database adapter cannot fall back to a default transport: guessing "direct"
 * for a source configured for SSH would talk to a different machine and report
 * it healthy. Callers reach these functions through withHost or
 * runConnectivityCheck, both of which always supply one.
 */
function requireHost(host: ExecutionHost | undefined): ExecutionHost {
    if (!host) {
        throw new Error("MySQL adapter requires an execution host. Call it through withHost().");
    }
    return host;
}

export async function ensureDatabase(
    config: MySQLConfig,
    dbName: string,
    user: string,
    pass: string | undefined,
    privileged: boolean,
    logs: string[],
    host: ExecutionHost,
) {
    try {
        const mysqlBin = await host.which(...MYSQL_CLIENT);
        const connArgs = buildConnectionArgs(config, host, { user, client: await connectionClientOf(config, host, mysqlBin) });

        await withAuthArgs(host, pass, async (authArgs) => {
            const created = await host.exec([
                mysqlBin, ...authArgs, ...connArgs,
                "-e", `CREATE DATABASE IF NOT EXISTS \`${dbName}\``,
            ]);
            if (created.code !== 0) {
                logs.push(`Warning ensures DB '${dbName}': ${created.stderr}`);
                return;
            }
            logs.push(`Database '${dbName}' ensured.`);

            if (privileged) {
                const grantQuery =
                    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${config.user}'@'%'; ` +
                    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${config.user}'@'localhost'; FLUSH PRIVILEGES;`;
                const granted = await host.exec([mysqlBin, ...authArgs, ...connArgs, "-e", grantQuery]);
                logs.push(granted.code === 0
                    ? `Permissions granted for '${dbName}'.`
                    : `Warning grants for '${dbName}': ${granted.stderr}`);
            }
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        logs.push(`Warning ensures DB '${dbName}': ${message}`);
    }
}

export async function test(
    config: MySQLConfig,
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
        const mysqlBin = await host.which(...MYSQL_CLIENT);
        const adminBin = await host.which(...MYSQL_ADMIN);
        const connArgs = buildConnectionArgs(config, host, { client: await connectionClientOf(config, host, mysqlBin) });

        return await withAuthArgs(host, config.password, async (authArgs) => {
            // 1. Reachability. 10s allows for a server under heavy load.
            const ping = await host.exec([
                adminBin, ...authArgs, "ping", ...connArgs, "--connect-timeout=10",
            ]);
            if (ping.code !== 0) {
                return { success: false, message: `Connection failed: ${ping.stderr.trim()}` };
            }

            // 2. Auth. mysqladmin ping succeeds on some MariaDB builds even when
            //    query authentication does not, so credentials get their own check.
            const auth = await host.exec([mysqlBin, ...authArgs, ...connArgs, "-N", "-s", "-e", "SELECT 1"]);
            if (auth.code !== 0) {
                return { success: false, message: `Connection failed: ${auth.stderr.trim()}` };
            }

            // 3. Version, best effort.
            const versionResult = await host.exec([
                mysqlBin, ...authArgs, ...connArgs, "-N", "-s", "-e", "SELECT VERSION()",
            ]);
            if (versionResult.code !== 0) {
                return { success: true, message: `Connection successful${via}, version unknown` };
            }

            // "11.4.9-MariaDB-ubu2404" -> "11.4.9", "8.0.44" -> "8.0.44"
            const raw = versionResult.stdout.trim();
            const version = raw.match(/^([\d.]+)/)?.[1] ?? raw;
            return { success: true, message: `Connection successful${via}`, version };
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Connection failed: ${message}` };
    }
}

export async function getDatabases(config: MySQLConfig, hostArg: ExecutionHost): Promise<string[]> {
    const host = requireHost(hostArg);
    const mysqlBin = await host.which(...MYSQL_CLIENT);
    const connArgs = buildConnectionArgs(config, host, { client: await connectionClientOf(config, host, mysqlBin) });

    return withAuthArgs(host, config.password, async (authArgs) => {
        const result = await host.exec([
            mysqlBin, ...authArgs, ...connArgs, "-e", "SHOW DATABASES", "--skip-column-names",
        ]);
        if (result.code !== 0) {
            throw new Error(`Failed to list databases: ${result.stderr.trim()}`);
        }
        return parseDatabaseNames(result.stdout);
    });
}

function parseDatabaseNames(stdout: string): string[] {
    return stdout
        .split("\n")
        .map(s => s.trim())
        .filter(s => s && !SYSTEM_DATABASES.includes(s));
}

const statsQuery = `
    SELECT
        s.schema_name AS db_name,
        COALESCE(SUM(t.data_length + t.index_length), 0) AS size_bytes,
        COUNT(t.table_name) AS table_count
    FROM information_schema.schemata s
    LEFT JOIN information_schema.tables t ON s.schema_name = t.table_schema
    WHERE s.schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
    GROUP BY s.schema_name
    ORDER BY s.schema_name;
`.trim();

function parseStatsOutput(stdout: string): DatabaseInfo[] {
    return stdout
        .split("\n")
        .map(line => line.trim())
        .filter(line => line)
        .map(line => {
            const [name, sizeStr, tableStr] = line.split("\t");
            return {
                name,
                sizeInBytes: parseInt(sizeStr, 10) || 0,
                tableCount: parseInt(tableStr, 10) || 0,
            };
        });
}

export async function getDatabasesWithStats(config: MySQLConfig, hostArg: ExecutionHost): Promise<DatabaseInfo[]> {
    const host = requireHost(hostArg);
    const mysqlBin = await host.which(...MYSQL_CLIENT);
    const connArgs = buildConnectionArgs(config, host, { client: await connectionClientOf(config, host, mysqlBin) });

    return withAuthArgs(host, config.password, async (authArgs) => {
        const stats = await host.exec([
            mysqlBin, ...authArgs, ...connArgs,
            "-e", statsQuery, "--skip-column-names", "--batch",
        ]);
        if (stats.code === 0) {
            return parseStatsOutput(stats.stdout);
        }

        // information_schema is often unreadable for a least-privilege backup
        // user, so fall back to the plain listing rather than failing the page.
        // Direct mode used to skip this fallback and simply error out.
        const fallback = await host.exec([
            mysqlBin, ...authArgs, ...connArgs, "-e", "SHOW DATABASES", "--skip-column-names",
        ]);
        if (fallback.code !== 0) {
            throw new Error(`Failed to list databases: ${fallback.stderr.trim()}`);
        }
        return parseDatabaseNames(fallback.stdout).map(name => ({ name, sizeInBytes: 0, tableCount: 0 }));
    });
}
