import sql from "mssql";

import type { ExecutionHost } from "@/lib/transport";
import type { AzureSQLConfig } from "@/lib/adapters/definitions";
import { reachOf, type ReachPolicy } from "@/lib/network/reach-policy";
import { tdsConnector } from "../mssql/connector";

/**
 * Opening a TDS connection to Azure SQL Database.
 *
 * A fork of the MSSQL pool rather than a shared module, for two reasons. A change
 * to that one's SSH tunnelling would otherwise silently change this adapter, which
 * has no SSH mode. And the settings below are pinned here rather than offered:
 * Azure presents a real certificate on every connection, so encryption is not a
 * choice and trusting an unverified certificate against *.database.windows.net is
 * always either a mistake or an interception.
 *
 * The `database` option is not a convenience. Azure SQL Database rejects
 * three-part names, so every per-database catalog read needs its own connection.
 */

export interface PoolOptions {
    /** Defaults to `master`, which is where the server-scoped catalog lives. */
    database?: string;
    /** Override the request timeout, 0 for none. */
    requestTimeout?: number;
}

function buildConnectionConfig(
    config: AzureSQLConfig,
    server: string,
    port: number,
    options: PoolOptions,
    reach: ReachPolicy | null,
): sql.config {
    // For a tenant that blocks the local network every socket, a routing redirect of the gateway
    // included, goes to an address checked at connect time, see `mssql/connector.ts`.
    const connector = tdsConnector(server, false, reach);
    return {
        server,
        port,
        user: config.user,
        password: config.password || "",
        database: options.database ?? "master",
        options: {
            encrypt: true,
            trustServerCertificate: false,
            connectTimeout: 15000,
            requestTimeout: options.requestTimeout ?? config.requestTimeout ?? 300000,
            ...(connector ? { connector: connector as NonNullable<sql.config["options"]>["connector"] } : {}),
        },
    };
}

/**
 * Run `fn` against a connected pool, closing it afterwards.
 */
export async function withPool<T>(
    config: AzureSQLConfig,
    host: ExecutionHost,
    fn: (pool: sql.ConnectionPool) => Promise<T>,
    options: PoolOptions = {},
): Promise<T> {
    if (!host) {
        throw new Error("Azure SQL adapter requires an execution host. Call it through withHost().");
    }

    // Always a no-op on the DirectHost this adapter resolves to. Kept because it is
    // the convention every other adapter follows, and skipping it would be the one
    // place a future transport silently bypasses.
    const forward = await host.forwardPort(config.host, config.port || 1433);
    let pool: sql.ConnectionPool | null = null;

    try {
        pool = new sql.ConnectionPool(buildConnectionConfig(config, forward.host, forward.port, options, reachOf(config)));
        await pool.connect();
        return await fn(pool);
    } finally {
        if (pool) await pool.close().catch(() => {});
        await forward.close().catch(() => {});
    }
}
