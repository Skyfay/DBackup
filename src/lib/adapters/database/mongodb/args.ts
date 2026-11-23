import type { MongoDBConfig } from "@/lib/adapters/definitions";
import type { ExecutionHost } from "@/lib/transport";

/**
 * Connection arguments and URIs for the MongoDB tools.
 *
 * Raw argv only. Quoting belongs to the transport, and escaping here would
 * double-escape over SSH.
 */

type AnyMongoConfig = MongoDBConfig & {
    uri?: string;
    user?: string;
    password?: string;
    authenticationDatabase?: string;
};

/**
 * DNS zones that publish an SRV record and no A record.
 *
 * An Atlas cluster is reached as `cluster0.xxxxx.mongodb.net`, but that name
 * resolves to nothing. Only `_mongodb._tcp.cluster0.xxxxx.mongodb.net` exists,
 * and it points at the shard hostnames. A plain `mongodb://host:port` therefore
 * fails with ENOTFOUND before a connection is ever attempted, which is why the
 * same cluster works in Compass (it connects with `mongodb+srv://`) and not here.
 */
const SRV_ZONES = [".mongodb.net", ".mongodb-dev.net", ".mongodb-qa.net"];

/** Where the client should connect, once the Host field has been made sense of. */
interface MongoTarget {
    /** Authority for a connection string: `host:port`, a bare host for SRV, or a comma-separated list. */
    authority: string;
    /** First host, for the `--host` flag path. */
    host: string;
    /** Port belonging to that first host, for the `--port` flag path. */
    port: number;
    /** Connect with `mongodb+srv://`, which resolves the SRV record and implies TLS. */
    srv: boolean;
    /** Several hosts were given, which only a connection string can express. */
    multiHost: boolean;
}

/**
 * Reads the Host field the way a user actually fills it in.
 *
 * The field asks for a hostname, but people paste what their provider gave them:
 * a full connection string, a host with a trailing slash, a host with the port
 * already attached, or the seed list of a replica set. Every one of those
 * produces a broken URI when concatenated blindly, so the host is reduced to its
 * authority component first.
 *
 * An explicit `mongodb+srv://` scheme selects SRV. Otherwise the zone decides,
 * which is what makes an Atlas cluster work with nothing but its hostname typed in.
 */
export function parseMongoTarget(config: AnyMongoConfig): MongoTarget {
    const { hosts, srv } = readMongoHosts(config);

    // An SRV record carries a port per host, so naming one alongside it is
    // rejected as an invalid connection string.
    const authority = srv
        ? hosts[0].host
        : hosts.map((entry) => `${entry.host}:${entry.port}`).join(",");

    return {
        authority,
        host: hosts[0].host,
        port: hosts[0].port,
        srv,
        multiHost: !srv && hosts.length > 1,
    };
}

/** The Host field read into its hosts with their ports, never empty, and whether it names an SRV record. */
function readMongoHosts(config: AnyMongoConfig): { hosts: { host: string; port: number }[]; srv: boolean } {
    let raw = (config.host || "127.0.0.1").trim();
    let srv = false;

    const scheme = /^(mongodb(?:\+srv)?):\/\//i.exec(raw);
    if (scheme) {
        srv = scheme[1].toLowerCase() === "mongodb+srv";
        raw = raw.slice(scheme[0].length);
    }

    // A pasted connection string carries its own credentials. They are dropped:
    // the login comes from the credential profile, and keeping both would produce
    // two userinfo sections in one URI.
    const at = raw.lastIndexOf("@");
    if (at !== -1) raw = raw.slice(at + 1);

    // Path, query and fragment are not part of the host.
    raw = raw.split(/[/?#]/)[0];

    const defaultPort = Number(config.port) || 27017;
    const entries = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            // A port typed into the Host field is the more specific answer, so it
            // wins over the Port field. The bracket alternative keeps IPv6 literals intact.
            const withPort = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(entry);
            return withPort
                ? { host: withPort[1], port: Number(withPort[2]) }
                : { host: entry, port: defaultPort };
        });

    const hosts = entries.length > 0 ? entries : [{ host: "127.0.0.1", port: defaultPort }];

    if (!srv) {
        const lower = hosts[0].host.toLowerCase();
        srv = SRV_ZONES.some((zone) => lower.endsWith(zone));
    }

    return { hosts, srv };
}

/**
 * The hosts the tools and the driver dial for the Host field, read by `parseMongoTarget` itself:
 * after the user info, before a path or a query, every entry of a list, `127.0.0.1` when nothing
 * is left. An SRV name alone, the hosts its record names come from DNS. Without the brackets of
 * an IPv6 address, so the local network check reads them as addresses.
 */
export function dialedMongoHosts(config: AnyMongoConfig): string[] {
    const { hosts, srv } = readMongoHosts(config);
    return (srv ? hosts.slice(0, 1) : hosts).map((entry) => entry.host.replace(/^\[|\]$/g, ""));
}

/**
 * Whether the driver connects to the one host it names and to nobody it announces: a Host field
 * of one host without an SRV record and without the older connection URI. The tools connect
 * directly to a single `--host` on their own, since no replica set name is given.
 */
export function connectsDirectly(config: AnyMongoConfig): boolean {
    if (config.uri) return false;
    const { srv, multiHost } = parseMongoTarget(config);
    return !srv && !multiHost;
}

/**
 * A value of the YAML file of `--config`, as a double quoted string. JSON escapes every control
 * character and quote the way YAML reads them, and the characters YAML reads as a line break on
 * top are escaped too.
 */
function yamlString(value: string): string {
    return JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * The connection flags of mongodump and mongorestore, and the secrets they read from the YAML file
 * of `--config` instead of argv: the password, or the whole connection string, which carries the
 * login. The Database Tools read `password` and `uri` from that file since 100.3.0.
 */
export function toolConnection(config: AnyMongoConfig): { args: string[]; secrets: string | null } {
    if (config.uri) return { args: [], secrets: `uri: ${yamlString(config.uri)}\n` };

    const { host, port, srv, multiHost } = parseMongoTarget(config);
    // An SRV name has no address record, so --host cannot resolve it, and a seed list does not fit
    // into one --host either, so both go as a connection string.
    if (srv || multiHost) return { args: [], secrets: `uri: ${yamlString(buildConnectionUri(config))}\n` };

    const args = ["--host", host, "--port", String(port)];
    if (config.user && config.password) {
        args.push("--username", config.user, "--authenticationDatabase", config.authenticationDatabase || "admin");
        return { args, secrets: `password: ${yamlString(config.password)}\n` };
    }
    return { args, secrets: null };
}

/**
 * Runs `fn` with the connection flags of mongodump or mongorestore. The secrets go into a file of
 * mode 0600 on the execution host, named by `--config` and removed afterwards, so the password is
 * in no process list and in no command an SSH server logs.
 */
export async function withToolConnection<T>(host: ExecutionHost, config: AnyMongoConfig, fn: (args: string[]) => Promise<T>): Promise<T> {
    const { args, secrets } = toolConnection(config);
    if (secrets === null) return fn(args);
    return host.withTempFile({ content: secrets, mode: 0o600, suffix: ".yaml" }, (path) => fn([...args, `--config=${path}`]));
}

/**
 * The connection string mongosh connects with: the one of the driver, and `directConnection` for a
 * single host, which the tools get for a single `--host` on their own, see `connectsDirectly`.
 */
export function shellConnectionUri(config: AnyMongoConfig): string {
    const uri = buildConnectionUri(config);
    if (config.uri || !connectsDirectly(config)) return uri;
    return `${uri}${uri.includes("?") ? "&" : "?"}directConnection=true`;
}

/**
 * Runs `fn` with what a mongosh call needs to connect: the flags and the statement its `--eval`
 * script starts with. mongosh takes a password only in argv or in the connection string, and has no
 * file or environment variable for it, so the connection string goes into a script of mode 0600 on
 * the execution host, which `load()` reads before the script connects without a server of its own
 * (`--nodb`). The password is then in no process list and in no command an SSH server logs. The
 * older `mongo` shell reads the same `load()` and `connect()`.
 */
export async function withShellConnection<T>(host: ExecutionHost, config: AnyMongoConfig, fn: (args: string[], prelude: string) => Promise<T>): Promise<T> {
    const content = `db = connect(${JSON.stringify(shellConnectionUri(config))});\n`;
    return host.withTempFile({ content, mode: 0o600, suffix: ".js" }, (path) => fn(["--nodb", "--quiet"], `load(${JSON.stringify(path)});`));
}

/**
 * Connection URI for the native driver.
 *
 * A stored inline `uri` is honoured for sources created before that field was
 * deprecated. The UI no longer exposes it; new sources arrive with host/port
 * plus credentials resolved from the vault profile.
 */
export function buildConnectionUri(config: AnyMongoConfig): string {
    if (config.uri) return config.uri;

    const { authority, srv } = parseMongoTarget(config);

    const auth = config.user && config.password
        ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@`
        : "";
    const authDb = config.authenticationDatabase || "admin";
    const authParam = config.user ? `?authSource=${encodeURIComponent(authDb)}` : "";
    const scheme = srv ? "mongodb+srv" : "mongodb";

    return `${scheme}://${auth}${authority}/${authParam}`;
}

/**
 * Replace secrets with stars for anything that gets logged.
 *
 * Covers both shapes the password can take: its own argument, and the userinfo
 * section of a connection string that is passed as one argument.
 */
export function maskSecrets(argv: string[], password?: string): string {
    return argv
        .map((arg) => (password && arg === password ? "******" : arg))
        .map((arg) => arg.replace(/(mongodb(?:\+srv)?:\/\/[^:/@\s]+:)[^@\s]+@/gi, "$1******@"))
        .join(" ");
}

/** Databases MongoDB manages itself, which are never backup targets. */
export const SYSTEM_DATABASES = ["admin", "config", "local"];

export const MONGOSH = ["mongosh", "mongo"] as const;
export const MONGODUMP = ["mongodump"] as const;
export const MONGORESTORE = ["mongorestore"] as const;
