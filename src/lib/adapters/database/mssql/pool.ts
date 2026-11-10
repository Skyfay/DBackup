import sql from "mssql";

import type { ExecutionHost, PortForward } from "@/lib/transport";
import type { MSSQLConfig } from "@/lib/adapters/definitions";
import { reachOf } from "@/lib/network/reach-policy";
import { tdsConnector } from "./connector";

/**
 * Opening a TDS connection, through an SSH tunnel when the transport asks for one.
 *
 * Every connection in this adapter goes through here. `buildConnectionConfig` is
 * deliberately not exported: a pool built outside this file would dial the
 * database host directly and silently bypass the tunnel.
 */

export interface PoolOptions {
    database?: string;
    /** Override the request timeout, 0 for none. Used by BACKUP and RESTORE. */
    requestTimeout?: number;
}

/**
 * Each pooled TDS connection is a separate SSH channel when tunnelled, and the
 * SFTP session claims one more. OpenSSH allows 10 sessions by default, while
 * the mssql default pool size is 10 on its own.
 */
const TUNNELLED_POOL_MAX = 4;

function buildConnectionConfig(
    config: MSSQLConfig,
    forward: PortForward,
    options: PoolOptions,
): sql.config {
    const connConfig: sql.config = {
        server: forward.host,
        port: forward.port,
        user: config.user,
        password: config.password || "",
        database: options.database ?? "master", // master for admin operations
        options: {
            encrypt: config.encrypt ?? true,
            trustServerCertificate: config.trustServerCertificate ?? false,
            connectTimeout: 15000,
            requestTimeout: options.requestTimeout ?? config.requestTimeout ?? 300000,
        },
    };

    // For a tenant that blocks the local network every socket goes through a connector that checks
    // its address, and a routing redirect too, see `connector.ts`.
    const connector = tdsConnector(forward.host, forward.forwarded, reachOf(config));
    if (connector) connConfig.options!.connector = connector as NonNullable<sql.config["options"]>["connector"];

    if (forward.forwarded) {
        // The driver now dials 127.0.0.1, and its default TLS server name
        // collapses to an empty string for an IP address, which fails
        // certificate validation. serverName restores the real hostname for
        // SNI and the certificate check, so encryption stays verified.
        connConfig.options!.serverName = config.host;
        connConfig.pool = { ...connConfig.pool, max: TUNNELLED_POOL_MAX };
    }

    return connConfig;
}

/**
 * Run `fn` against a connected pool, closing both the pool and any tunnel afterwards.
 */
export async function withPool<T>(
    config: MSSQLConfig,
    host: ExecutionHost,
    fn: (pool: sql.ConnectionPool) => Promise<T>,
    options: PoolOptions = {},
): Promise<T> {
    if (!host) {
        throw new Error("MSSQL adapter requires an execution host. Call it through withHost().");
    }

    const forward = await host.forwardPort(config.host, config.port || 1433);
    let pool: sql.ConnectionPool | null = null;

    try {
        pool = new sql.ConnectionPool(buildConnectionConfig(config, forward, options));
        try {
            await pool.connect();
        } catch (error: unknown) {
            // A forwarding refusal surfaces at the driver as a reset connection,
            // so the real cause is attached here where it is still known.
            if (forward.lastError) {
                const detail = error instanceof Error ? error.message : String(error);
                throw new Error(`${detail} (SSH tunnel: ${forward.lastError.message})`);
            }
            throw error;
        }

        return await fn(pool);
    } finally {
        if (pool) await pool.close().catch(() => {});
        await forward.close().catch(() => {});
    }
}
