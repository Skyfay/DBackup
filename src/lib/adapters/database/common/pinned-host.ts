import type { DatabaseAdapter } from "@/lib/core/interfaces";
import type { ExecOptions, ExecutionHost, SpawnOptions } from "@/lib/transport";
import { hostOf } from "@/lib/adapters/dialed-hosts";
import { parseMongoTarget } from "@/lib/adapters/database/mongodb/args";
import { reachableAddress } from "@/lib/network/checked-socket";
import { isAddressLiteral } from "@/lib/network/local-network";
import { reachOf, type ReachPolicy } from "@/lib/network/reach-policy";
import { resolveTransport } from "@/lib/transport/spec";

/**
 * The database host the client tools dial for a connection of a tenant that blocks the local
 * network: an address checked right before the call, the first that answers on the port of the
 * database where a name has several, see `checked-socket.ts`. So a name that answers otherwise for
 * the tool reaches no address of the local network either. Only in direct mode, in SSH mode the
 * tools run on the SSH server and reach the database from there. A connection of any other tenant
 * dials its host as before.
 *
 * Only where the address keeps the connection what it was:
 * - PostgreSQL: `-h` keeps the name, for SNI and a certificate check like `verify-full`, and libpq
 *   dials the address of `PGHOSTADDR`, one per entry of the host list.
 * - Redis and Valkey: redis-cli takes the name as `--sni` for TLS, see `redis/args.ts`.
 * - Firebird: its wire protocol has no certificate.
 * - MongoDB with one host and no TLS: the tools and the driver talk to that host alone. A seed list
 *   and an SRV name are refused for such a tenant, see `announcedHostsReason` in `dialed-hosts.ts`.
 *   With TLS on in its options, the tools check the certificate against the host they dial and take
 *   no address beside it, so that host keeps its name. Not pinned.
 * - MySQL and MariaDB only with TLS off. With TLS on, the client has no option for an address beside
 *   the name, and MariaDB's from 11.4 checks the certificate against the host it was given, so those
 *   connections dial the name, which the check resolved just before. Not pinned.
 */

type Config = Record<string, unknown>;
/** A pinned config, and the environment the tools of the call get on top of their own. */
type Pinned = { config: Config; env?: Record<string, string> };
type Pin = (config: Config, reach: ReachPolicy) => Promise<Pinned>;

/**
 * A field as text. A host or an option that is there and no text is refused, since the tool would
 * read the text of a list like `["127.0.0.1"]` where the pin sees an empty field and pins nothing.
 */
function text(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new Error("A host of the connection is no text, so its address cannot be checked.");
    return value.trim();
}

const portOf = (config: Config, fallback: number) => Number(config.port) || fallback;

/** An address as a host field takes it, an IPv6 address in brackets. */
const bracketed = (address: string) => (address.includes(":") ? `[${address}]` : address);

/** Whether the tools of a call run on the server DBackup runs on, as the transport of the adapter decides. */
function runsHere(adapter: DatabaseAdapter, config: Config): boolean {
    try {
        return resolveTransport(adapter, config).kind === "direct";
    } catch {
        // A transport that does not resolve fails the call itself, with its own message.
        return false;
    }
}

/** libpq: `-h` as it is, `PGHOSTADDR` with the address of every entry of the list, see `postgresHosts` in `dialed-hosts.ts`. */
const postgres: Pin = async (config, reach) => {
    const port = portOf(config, 5432);
    const entries = text(config.host).split(",").map((entry) => entry.trim());
    const addresses = await Promise.all(entries.map(async (entry) => {
        const host = hostOf(entry) ?? entry;
        return isAddressLiteral(host) ? host.replace(/^\[|\]$/g, "") : reachableAddress(host, port, reach.allowed);
    }));
    return { config, env: { PGHOSTADDR: addresses.join(",") } };
};

/** redis-cli: `-h` by the address, the name for TLS, see `buildConnectionArgs` in `redis/args.ts`. */
const redis: Pin = async (config, reach) => {
    const host = text(config.host);
    if (!host || isAddressLiteral(host)) return { config };
    return { config: { ...config, host: await reachableAddress(host, portOf(config, 6379), reach.allowed), tlsServerName: host } };
};

/** gbak and isql: the host of `host[/port]` by its address, see `firebirdHostProblem`. */
const firebird: Pin = async (config, reach) => {
    const typed = /^(.*)\/(\d{1,5})$/.exec(text(config.host));
    const bare = (typed ? typed[1] : text(config.host)).replace(/^\[|\]$/g, "");
    if (!bare || isAddressLiteral(bare)) return { config };
    const port = typed ? Number(typed[2]) : portOf(config, 3050);
    return { config: { ...config, host: `${bracketed(await reachableAddress(bare, port, reach.allowed))}${typed ? `/${typed[2]}` : ""}` } };
};

/**
 * TLS turned on by the additional options of the MongoDB tools. A query in the host field turns
 * nothing on, `parseMongoTarget` cuts it off before the tools and the driver get the host.
 */
const MONGO_TLS = /--tls\b|--ssl\b|\b(?:tls|ssl)=true\b/i;

/**
 * The tools and the driver: one host by its address, with its port. The field is read by
 * `parseMongoTarget`, the parser of the adapter itself, so every spelling the adapter takes for one
 * host, like `name/`, `user@name` or `mongodb://name`, is pinned and none of them dials the name.
 */
const mongodb: Pin = async (config, reach) => {
    if (config.uri || MONGO_TLS.test(text(config.options))) return { config };
    const target = parseMongoTarget({ host: text(config.host), port: portOf(config, 27017) } as Parameters<typeof parseMongoTarget>[0]);
    // A seed list and an SRV name are refused for such a tenant, see `announcedHostsReason`.
    if (target.srv || target.multiHost) return { config };
    const bare = target.host.replace(/^\[|\]$/g, "");
    const address = isAddressLiteral(bare) ? bare : await reachableAddress(bare, target.port, reach.allowed);
    return { config: { ...config, host: `${bracketed(address)}:${target.port}` } };
};

/** The MySQL and MariaDB tools with TLS off, see the top of this module. */
const mysql: Pin = async (config, reach) => {
    const host = text(config.host);
    if (config.disableSsl !== true || !host || isAddressLiteral(host)) return { config };
    return { config: { ...config, host: await reachableAddress(host, portOf(config, 3306), reach.allowed) } };
};

/** How each adapter puts the checked address of its host in place, by adapter id. */
export const DATABASE_PINS: Readonly<Record<string, Pin>> = { postgres, redis, valkey: redis, firebird, mongodb, mysql, mariadb: mysql };

/**
 * The config of a call with the checked address of its database host, and the environment its
 * tools get on top. The config itself for a tenant that blocks nothing, in SSH mode and for an
 * adapter without a pin. Keeps the policy and every other field, a spread keeps the symbols.
 */
export async function pinDatabaseHost(adapter: DatabaseAdapter, config: unknown): Promise<{ config: unknown; env?: Record<string, string> }> {
    const reach = reachOf(config);
    const pin = Object.hasOwn(DATABASE_PINS, adapter.id) ? DATABASE_PINS[adapter.id] : null;
    if (!reach || !pin || typeof config !== "object" || config === null || !runsHere(adapter, config as Config)) return { config };
    return pin(config as Config, reach);
}

/** Whether a value is an execution host, the argument a database adapter takes after its own. */
function isExecutionHost(value: unknown): value is ExecutionHost {
    return typeof value === "object" && value !== null && typeof (value as ExecutionHost).exec === "function" && typeof (value as ExecutionHost).spawn === "function";
}

/** The host with `env` laid over the environment of every command it runs, the rest of it untouched. */
export function withHostEnv(host: ExecutionHost, env: Record<string, string>): ExecutionHost {
    return new Proxy(host, {
        get(target, property) {
            if (property === "exec") return (argv: string[], options: ExecOptions = {}) => target.exec(argv, { ...options, env: { ...options.env, ...env } });
            if (property === "spawn") return (argv: string[], options: SpawnOptions = {}) => target.spawn(argv, { ...options, env: { ...options.env, ...env } });
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

/** The methods of a database adapter that take the config first, the ones a pinned config goes to. */
const CONFIG_FIRST = ["test", "ping", "getDatabases", "getDatabasesWithStats", "prepareRestore", "dump", "restore", "getTables", "getTableData", "dumpOne", "restoreOne", "listDumpEntries"] as const;

/** The methods that answer a refusal with a result instead of throwing it. */
const ANSWERS: ReadonlySet<string> = new Set(["test", "ping"]);

/**
 * The adapter with its config-first methods handed the config of `pinDatabaseHost`, and its host
 * the environment of the pin. A refused host fails `test` and `ping` with its message, like any
 * other failed connection.
 */
export function withPinnedDatabaseHost(adapter: DatabaseAdapter): DatabaseAdapter {
    const pinned: Record<string, unknown> = { ...adapter };
    for (const name of CONFIG_FIRST) {
        const method = (adapter as unknown as Record<string, unknown>)[name];
        if (typeof method !== "function") continue;
        pinned[name] = async (config: unknown, ...rest: unknown[]) => {
            let ready: { config: unknown; env?: Record<string, string> };
            try {
                ready = await pinDatabaseHost(adapter, config);
            } catch (error: unknown) {
                if (ANSWERS.has(name)) return { success: false, message: error instanceof Error ? error.message : String(error) };
                throw error;
            }
            const env = ready.env;
            const args = env ? rest.map((value) => (isExecutionHost(value) ? withHostEnv(value, env) : value)) : rest;
            return (method as (...values: unknown[]) => unknown).call(pinned, ready.config, ...args);
        };
    }
    return pinned as unknown as DatabaseAdapter;
}
