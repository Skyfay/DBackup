import type { ExecutionHost, ExecResult } from "@/lib/transport";
import type { PostgresConfig } from "@/lib/adapters/definitions";

/**
 * Argument and environment helpers for the PostgreSQL client tools.
 *
 * Everything here returns RAW argv. Quoting belongs to the transport, and
 * escaping a value here would double-escape it over SSH.
 */

type AnyPostgresConfig = PostgresConfig & { user?: string; password?: string };

/**
 * A database name for `-d`, as libpq reads it word for word. libpq takes a `-d` value that holds
 * an `=` or starts with `postgres://` or `postgresql://` as a whole connection string, whose host,
 * port and login replace those of the connection, so a name from a job, a restore or the table
 * browser could otherwise lead to another server. A `dbname='...'` keyword value is always a name.
 */
export function dbArg(name: string): string {
    return `dbname='${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Connection flags shared by psql, pg_dump and pg_restore. */
export function buildConnectionArgs(
    config: AnyPostgresConfig,
    options: { user?: string } = {},
): string[] {
    return [
        "-h", config.host || "127.0.0.1",
        "-p", String(config.port || 5432),
        "-U", options.user || config.user,
    ];
}

/**
 * The password environment for the client tools.
 *
 * PGPASSWORD stays out of argv on both transports: the SSH transport renders it
 * as an `export` prefix so it never reaches the remote process list.
 */
export function pgEnv(password?: string): Record<string, string | undefined> {
    return password ? { PGPASSWORD: password } : {};
}

/**
 * psql refuses to connect without a database, and the one the user configured
 * may not exist yet or may be unreadable. These are tried in order.
 */
export function candidateDatabases(config: AnyPostgresConfig): string[] {
    const candidates = ["postgres", "template1"];
    if (typeof config.database === "string" && config.database) {
        candidates.push(config.database);
    }
    return candidates;
}

/**
 * Run `build` against each candidate database and return the first success.
 *
 * This loop used to depend on `execFileAsync` REJECTING to move on to the next
 * candidate. `host.exec` reports a non-zero exit instead of throwing, so the
 * check is explicit here. Getting that wrong would stop at the first database
 * and quietly return nothing at all.
 */
export async function firstReachableDatabase<T>(
    host: ExecutionHost,
    config: AnyPostgresConfig,
    build: (database: string) => string[],
    onSuccess: (result: ExecResult, database: string) => T | Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; stderr: string }> {
    let lastStderr = "";

    for (const database of candidateDatabases(config)) {
        const result = await host.exec(build(database), { env: pgEnv(config.password) });
        if (result.code === 0) {
            return { ok: true, value: await onSuccess(result, database) };
        }
        lastStderr = result.stderr.trim() || lastStderr;
    }

    return { ok: false, stderr: lastStderr };
}

export const PSQL = ["psql"] as const;
export const PG_DUMP = ["pg_dump"] as const;
export const PG_RESTORE = ["pg_restore"] as const;
