import { transportSuffix, type ExecutionHost } from "@/lib/transport";
import { FirebirdConfig } from "@/lib/adapters/definitions";
import { DatabaseInfo } from "@/lib/core/interfaces";
import { getIsqlCommand } from "./tools";
import { AdapterError } from "@/lib/logging/errors";
import { validPort } from "@/lib/adapters/command-values";
import { firebirdHostProblem } from "./host";
import path from "path";

/**
 * Resolve a job-selected alias name (config.database) to its configured
 * filesystem path (config.databases). Firebird has no server-side database
 * registry, so this is the single point where an alias becomes a real path.
 */
export function resolveAliasPath(config: FirebirdConfig, aliasName: string): string {
    const entry = (config.databases || []).find((d) => d.name === aliasName);
    if (!entry) {
        const known = (config.databases || []).map((d) => d.name).join(", ") || "(none)";
        throw new Error(`Unknown Firebird database alias "${aliasName}". Configured aliases: ${known}.`);
    }
    return entry.path;
}

/** Whether two database paths of a Firebird server name the same file, case aside on Windows. */
function sameDatabasePath(a: string, b: string): boolean {
    const windows = (value: string) => /^[a-zA-Z]:|\\/.test(value);
    if (windows(a) || windows(b)) return path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
    return path.posix.normalize(a) === path.posix.normalize(b);
}

/**
 * The aliases of the connection a restore target names: the alias of that name, and every alias
 * whose file the target is, since the restore page fills in the path of an alias and a person may
 * type it. Whatever guards a database by its name, like the databases of customers, compares these
 * too, or a restore by path went past it. Empty for a path of no alias.
 */
export function aliasesOfTarget(databases: readonly { name: string; path: string }[] | undefined, target: string): string[] {
    return (databases ?? [])
        .filter((entry) => entry.name === target || (typeof entry.path === "string" && entry.path !== "" && sameDatabasePath(entry.path, target)))
        .map((entry) => entry.name);
}

/**
 * Build the connection string gbak/isql use to reach a database, always via
 * the Firebird wire protocol ("host[/port]:path"). Used in both direct mode
 * (tool runs in the DBackup container) and SSH mode (tool runs on the SSH
 * target, with `host`/`port` reachable from there - e.g. 127.0.0.1 plus a
 * container's published port). A bare local path was tried previously for
 * SSH mode, but Firebird's "local" provider still requires an actual service
 * listener on that same host/network namespace - it fails outright against a
 * containerized server, which the wire protocol handles correctly instead.
 */
export function buildConnectionString(config: FirebirdConfig, dbPath: string): string {
    // The string is a positional argument of gbak and isql, so it never starts with `-`, which
    // they would read as a switch. The path follows the host, so only the host can bring one.
    // Checked here, since a stored config may predate the check on save, see `firebirdHostProblem`.
    const problem = firebirdHostProblem(config.host);
    if (problem) throw new AdapterError("firebird", "config", problem);
    const port = validPort(config.port, "firebird", 3050);
    const portSegment = port !== 3050 ? `/${port}` : "";
    return `${String(config.host).trim()}${portSegment}:${dbPath}`;
}

/**
 * A database adapter cannot fall back to a default transport: guessing "direct"
 * for a source configured for SSH would talk to a different machine and report
 * it healthy. Callers reach these functions through withHost or
 * runConnectivityCheck, both of which always supply one.
 */
const NO_HOST_MESSAGE = "Firebird adapter requires an execution host. Call it through withHost().";

export async function getDatabases(config: FirebirdConfig, _host: ExecutionHost): Promise<string[]> {
    return (config.databases || []).map((d) => d.name);
}

const TABLE_COUNT_QUERY =
    "SET HEADING OFF;\nSELECT COUNT(*) FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0 OR RDB$SYSTEM_FLAG IS NULL;";

export async function getDatabasesWithStats(config: FirebirdConfig, host: ExecutionHost): Promise<DatabaseInfo[]> {
    // Firebird has no filesystem-level size query reachable over the wire protocol
    // (no gstat bundled - see tools.ts), so sizeInBytes is intentionally left
    // undefined. `path` is included so the restore UI can prefill the target field
    // with the real path instead of just the alias name.
    return Promise.all(
        (config.databases || []).map(async (d) => {
            try {
                const stdout = await runQuery(config, d.name, TABLE_COUNT_QUERY, host);
                const tableCount = parseInt(stdout.trim(), 10);
                return { name: d.name, path: d.path, tableCount: Number.isNaN(tableCount) ? undefined : tableCount };
            } catch {
                return { name: d.name, path: d.path };
            }
        })
    );
}

const VERSION_QUERY = "SELECT rdb$get_context('SYSTEM','ENGINE_VERSION') FROM rdb$database;";

function parseEngineVersion(raw: string): string | undefined {
    const match = raw.match(/(\d+\.\d+(?:\.\d+)?)/);
    return match ? match[1] : undefined;
}

/**
 * Run one SQL statement through isql, feeding it on stdin.
 *
 * The SSH path used to pipe the statement in through a shell command built by
 * string concatenation. The SQL now travels through stdin on both transports,
 * so nothing in a statement can be interpreted by a shell.
 */
async function runIsql(
    config: FirebirdConfig,
    host: ExecutionHost,
    connStr: string,
    sql: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const isql = await getIsqlCommand(host);
    return host.exec(
        [isql, "-q", connStr, "-user", config.user],
        { stdin: sql + "\n", env: { ISC_PASSWORD: config.password } },
    );
}

/** Runs a single SQL statement against a database alias via isql, returning raw stdout. */
export async function runQuery(
    config: FirebirdConfig,
    database: string,
    sql: string,
    host: ExecutionHost,
): Promise<string> {
    if (!host) throw new Error(NO_HOST_MESSAGE);

    const dbPath = resolveAliasPath(config, database);
    const result = await runIsql(config, host, buildConnectionString(config, dbPath), sql);
    if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || "Query failed");
    }
    return result.stdout;
}

export async function test(
    config: FirebirdConfig,
    host?: ExecutionHost,
): Promise<{ success: boolean; message: string; version?: string }> {
    const aliases = config.databases || [];
    if (aliases.length === 0) {
        return { success: false, message: "No database aliases configured" };
    }
    if (!host) {
        return { success: false, message: NO_HOST_MESSAGE };
    }

    const via = transportSuffix(host);
    const connStr = buildConnectionString(config, aliases[0].path);

    try {
        const result = await runIsql(config, host, connStr, VERSION_QUERY);
        if (result.code !== 0) {
            return { success: false, message: `Connection failed: ${result.stderr.trim() || result.stdout.trim()}` };
        }
        return {
            success: true,
            message: `Connection successful${via}`,
            version: parseEngineVersion(result.stdout),
        };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Connection failed: ${msg}` };
    }
}

/**
 * Lightweight connectivity check for the periodic health check.
 *
 * Opens the database port as reachable from the execution host. Over SSH this
 * used to return success as soon as the SSH handshake worked, so a source whose
 * Firebird server was down still reported healthy.
 */
export async function ping(
    config: FirebirdConfig,
    host?: ExecutionHost,
): Promise<{ success: boolean; message: string }> {
    if (!host) {
        return { success: false, message: NO_HOST_MESSAGE };
    }

    const via = transportSuffix(host);
    try {
        const socket = await host.connect(config.host, config.port || 3050);
        socket.destroy();
        return { success: true, message: `Connection successful${via}` };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Connection failed: ${msg}` };
    }
}
