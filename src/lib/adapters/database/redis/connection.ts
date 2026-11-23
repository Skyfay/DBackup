import { transportSuffix, type ExecutionHost } from "@/lib/transport";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { RedisConfig } from "@/lib/adapters/definitions";
import { DatabaseInfo } from "@/lib/core/interfaces";
import { REDIS_CLI, buildConnectionArgs, redisCliOptions } from "./args";

const log = logger.child({ adapter: "redis", module: "connection" });

/** Redis ships with 16 databases unless the server says otherwise. */
const DEFAULT_DATABASE_COUNT = 16;

/**
 * A database adapter cannot fall back to a default transport: guessing "direct"
 * for a source configured for SSH would talk to a different machine and report
 * it healthy. Callers reach these functions through withHost or
 * runConnectivityCheck, both of which always supply one.
 */
function requireHost(host: ExecutionHost | undefined): ExecutionHost {
    if (!host) {
        throw new Error("Redis adapter requires an execution host. Call it through withHost().");
    }
    return host;
}

function numberedDatabases(count: number): string[] {
    return Array.from({ length: count }, (_, i) => String(i));
}

export async function test(
    config: RedisConfig,
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
        const redisCli = await host.which(...REDIS_CLI);
        const args = buildConnectionArgs(config);

        const ping = await host.exec([redisCli, ...args, "PING"], redisCliOptions(config));
        if (ping.code !== 0 || !ping.stdout.includes("PONG")) {
            const detail = ping.stderr.trim() || ping.stdout.trim();
            return { success: false, message: `Connection failed: ${detail}` };
        }

        // Prefer valkey_version when present, fall back to redis_version.
        const info = await host.exec([redisCli, ...args, "INFO", "server"], redisCliOptions(config));
        let version: string | undefined;
        if (info.code === 0) {
            const valkey = info.stdout.match(/valkey_version:([^\r\n]+)/);
            const redis = info.stdout.match(/redis_version:([^\r\n]+)/);
            version = (valkey ?? redis)?.[1]?.trim();
        }

        return { success: true, message: `Connection successful${via}`, version };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Connection failed: ${message}` };
    }
}

/**
 * Redis uses numbered databases rather than named ones, so this reports how many
 * the server is configured for. They always exist, even when empty.
 */
export async function getDatabases(config: RedisConfig, hostArg: ExecutionHost): Promise<string[]> {
    const host = requireHost(hostArg);

    try {
        const redisCli = await host.which(...REDIS_CLI);
        const args = buildConnectionArgs({ ...config, database: 0 });

        const result = await host.exec([redisCli, ...args, "CONFIG", "GET", "databases"], redisCliOptions(config));
        if (result.code !== 0) {
            return numberedDatabases(DEFAULT_DATABASE_COUNT);
        }

        // "databases\n16\n" -> 16
        const lines = result.stdout.trim().split("\n");
        const count = parseInt(lines[1] || String(DEFAULT_DATABASE_COUNT), 10);
        return numberedDatabases(Number.isNaN(count) ? DEFAULT_DATABASE_COUNT : count);
    } catch (error: unknown) {
        log.error("Failed to get databases", {}, wrapError(error));
        return numberedDatabases(DEFAULT_DATABASE_COUNT);
    }
}

/** Parses `INFO keyspace` output ("db0:keys=N,expires=..." lines) into a per-db key count map. */
function parseKeyspaceInfo(stdout: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const line of stdout.split("\n")) {
        const match = line.trim().match(/^db(\d+):keys=(\d+)/);
        if (match) counts[match[1]] = parseInt(match[2], 10);
    }
    return counts;
}

/**
 * Database list with key counts, surfaced as `tableCount`. Redis has no notion
 * of tables, but this is the most useful "how much is in here" signal available
 * in one round trip. Redis exposes no per-database memory usage, so
 * sizeInBytes stays undefined.
 */
export async function getDatabasesWithStats(config: RedisConfig, hostArg: ExecutionHost): Promise<DatabaseInfo[]> {
    const host = requireHost(hostArg);
    const databases = await getDatabases(config, host);

    try {
        const redisCli = await host.which(...REDIS_CLI);
        const args = buildConnectionArgs({ ...config, database: 0 });

        const result = await host.exec([redisCli, ...args, "INFO", "keyspace"], redisCliOptions(config));
        const keyCounts = result.code === 0 ? parseKeyspaceInfo(result.stdout) : {};
        return databases.map((name) => ({ name, tableCount: keyCounts[name] ?? 0 }));
    } catch (error: unknown) {
        log.error("Failed to get database stats", {}, wrapError(error));
        return databases.map((name) => ({ name }));
    }
}

export { buildConnectionArgs };
