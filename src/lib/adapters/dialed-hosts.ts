/**
 * The hosts DBackup itself connects to for a config of a connection, per adapter, as plain data.
 * The local network check of a tenant resolves them, see `src/services/tenant/tenant-network.ts`.
 *
 * - A database in direct mode: its host as its client reads the field, every host of a list (`a,b`
 *   of PostgreSQL, the sentinels of Redis, the hosts of a MongoDB URI), and the fallback of the
 *   client for an empty one. In SSH mode the SSH host alone, since whatever lies behind it is
 *   reached from that server and never from the one DBackup runs on. Agents will be the same
 *   later: DBackup dials the agent, the agent the database.
 * - A storage: the server of its address, the S3 endpoint and the host of a bucket on it.
 * - A notification channel: every URL or host a person types, its webhook, its server, its SMTP host.
 * - Nothing for an endpoint fixed by the adapter, like Amazon S3, the cloud drives, Telegram and
 *   Twilio, and nothing for what reaches the server DBackup runs on itself, which `host-local.ts`
 *   keeps to the platform.
 *
 * Each entry reads its field the way the client or tool of that adapter does, so a spelling the
 * client takes for another host than the check, like `user@host` or `host\INSTANCE`, never passes
 * unchecked. Every adapter id has an entry, which `tests/unit/adapters/dialed-hosts.test.ts` checks.
 */

import { dialedMongoHosts } from "./database/mongodb/args";
import { parseSmbAddress, SMB_ADDRESS_HINT } from "./smb-address";

type Config = Record<string, unknown>;
type HostsOf = (config: Config) => string[];

/**
 * A config whose address has no form its client reads, so no host can be named for it. The local
 * network check refuses it for a tenant that blocks the local network, see `tenant-network.ts`.
 */
export class HostFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "HostFormatError";
    }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const present = (host: string | null | undefined): host is string => typeof host === "string" && host !== "";

/** The host of a URL, with or without a scheme, without the brackets of an IPv6 address, null when it names none. */
export function urlHost(value: unknown): string | null {
    const raw = text(value);
    if (!raw) return null;
    for (const candidate of [raw, `https://${raw}`]) {
        try {
            const host = new URL(candidate).hostname.replace(/^\[|\]$/g, "");
            if (host) return host;
        } catch {
            // Not a URL, the next form is tried.
        }
    }
    return null;
}

/**
 * The host of one entry of a host field: a name, an address, `host:port`, `[v6]:port` or a URL.
 * Null for a socket path, which reaches the server DBackup runs on and is `host-local.ts`'s.
 */
export function hostOf(value: unknown): string | null {
    const raw = text(value);
    if (!raw || raw.startsWith("/")) return null;
    if (raw.includes("://")) return urlHost(raw);
    const bracketed = /^\[([^\]]+)\](?::\d*)?$/.exec(raw);
    if (bracketed) return bracketed[1];
    const colons = raw.split(":").length - 1;
    // One colon is a port, more are an IPv6 address.
    if (colons === 1) return raw.slice(0, raw.indexOf(":")) || null;
    return raw;
}

/** The hosts of a field that may list several, comma separated, like the sentinels of Redis. */
export function hostsIn(value: unknown): string[] {
    return text(value).split(",").map(hostOf).filter(present);
}

/** What the clients of MySQL, MariaDB, PostgreSQL, MongoDB and Firebird dial for an empty host. */
const FALLBACK_HOST = "127.0.0.1";

/**
 * The hosts of a MongoDB connection URI, `mongodb://user:pw@a:27017,b:27017/db`. The Node driver
 * ends the user info at the first `@`, other readers at the last one, so both count. Of an SRV URI
 * its name.
 */
function mongoUriHosts(value: unknown): string[] {
    const raw = text(value);
    const scheme = /^mongodb(?:\+srv)?:\/\//i.exec(raw);
    if (!scheme) return [];
    const rest = raw.slice(scheme[0].length);
    const authority = (from: number) => rest.slice(from).split(/[/?#@]/)[0];
    const first = rest.indexOf("@");
    const last = rest.lastIndexOf("@");
    return [...hostsIn(authority(first + 1)), ...(last !== first ? hostsIn(authority(last + 1)) : [])];
}

/**
 * The hosts libpq dials for `-h`: every entry of a comma list, the fallback of `buildConnectionArgs`
 * for an empty field. An entry that starts with `/` or `@` names a Unix socket, an empty entry the
 * default socket, all of them on the server DBackup runs on, which `host-local.ts` keeps to the
 * platform.
 */
function postgresHosts(value: unknown): string[] {
    if (!text(value)) return [FALLBACK_HOST];
    return text(value).split(",").map((entry) => entry.trim())
        .filter((entry) => entry !== "" && !entry.startsWith("/") && !entry.startsWith("@"))
        .map(hostOf).filter(present);
}

/**
 * The host the clients of SQL Server dial for a server name: without a protocol prefix like `tcp:`,
 * without a named instance (`host\INSTANCE`, whose port the browser of that host names), without a
 * port after a comma (`host,1433`), and `.` or `(local)` as the server itself.
 */
export function sqlServerHost(value: unknown): string | null {
    let server = text(value).replace(/^(?:tcp|np|lpc|admin):/i, "");
    const instance = server.lastIndexOf("\\");
    if (instance >= 0) server = server.slice(0, instance);
    server = server.split(",")[0].trim();
    if (/^(?:\.|\(local\)|\(localdb\))$/i.test(server)) return FALLBACK_HOST;
    return hostOf(server);
}

/**
 * The hosts gbak and isql dial for the connection string `host[/port]:path` that `buildConnectionString`
 * in `firebird/connection.ts` builds: up to the first `:`, or inside the brackets of `[v6]/port`,
 * without `/port`. A bare IPv6 address counts by that reading and as typed. An `inet://` URL by its
 * host. An empty host goes through the loopback provider.
 */
function firebirdHosts(value: unknown): string[] {
    const raw = text(value);
    if (!raw) return [FALLBACK_HOST];
    if (/^[a-z][a-z0-9]*:\/\//i.test(raw)) return [urlHost(raw)].filter(present);
    const bracketed = /^\[([^\]]*)\]/.exec(raw);
    if (bracketed) return [bracketed[1] || FALLBACK_HOST];
    const node = raw.split(":")[0].split("/")[0].trim() || FALLBACK_HOST;
    return raw.split(":").length > 2 ? [node, raw] : [node];
}

/**
 * The hosts rsync and OpenSSH dial for `user@host`: both take what follows the last `@`. OpenSSH
 * reads the rest as the name, rsync ends it at the first `:` unless it sits in brackets.
 */
function rsyncHosts(value: unknown): string[] {
    const raw = text(value);
    const after = raw.slice(raw.lastIndexOf("@") + 1).trim();
    if (!after) return [];
    const bracketed = /^\[([^\]]+)\]/.exec(after);
    return [hostOf(after), bracketed ? bracketed[1] : after.split(":")[0]].filter(present);
}

/** The server of an SMB share address, `//server/share` or `\\server\share`, the only forms smbclient reads. */
function smbHost(value: unknown): string[] {
    const parsed = parseSmbAddress(value);
    if (!parsed) throw new HostFormatError(`The share address does not read. ${SMB_ADDRESS_HINT}`);
    return [hostOf(parsed.server)].filter(present);
}

const DNS_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * An S3 endpoint and the host of the bucket on it. Without path style the SDK puts the bucket in
 * front of the endpoint, `bucket.s3.example.com`, a name the one who picks the bucket controls too.
 */
function s3Hosts(endpoint: string | null, bucket: unknown, pathStyle: unknown): string[] {
    if (!endpoint) return [];
    const name = text(bucket);
    const virtual = pathStyle !== true && DNS_BUCKET.test(name) && !/^[0-9.]+$|:/.test(endpoint) ? [`${name}.${endpoint}`] : [];
    return [endpoint, ...virtual];
}

/** The R2 endpoint as `s3.ts` builds it from the account id, which a person types. */
function r2Endpoint(config: Config): string | null {
    const jurisdiction = config.jurisdiction === "eu" ? ".eu" : config.jurisdiction === "fedramp" ? ".fedramp" : "";
    return urlHost(`https://${text(config.accountId)}${jurisdiction}.r2.cloudflarestorage.com`);
}

/** Direct mode dials the host fields, SSH mode the SSH host alone. Zod defaults do not run on a stored config, so a missing mode is direct. */
const directOrSsh = (direct: HostsOf): HostsOf => (config) => (config.connectionMode === "ssh" ? hostsIn(config.sshHost) : direct(config));

const host: HostsOf = (config) => hostsIn(config.host);
const none: HostsOf = () => [];
const webhook: HostsOf = (config) => [urlHost(config.webhookUrl)].filter(present);
const server: HostsOf = (config) => [urlHost(config.serverUrl)].filter(present);

/** MySQL and MariaDB: the host, `127.0.0.1` for an empty one as `buildConnectionArgs` passes it. */
const mysql = directOrSsh((config) => (text(config.host) ? hostsIn(config.host) : [FALLBACK_HOST]));

/** Redis and Valkey: the host, and the sentinels in sentinel mode, which a sentinel connection dials first. */
const redis = directOrSsh((config) => [...hostsIn(config.host), ...(config.mode === "sentinel" ? hostsIn(config.sentinelNodes) : [])]);

/**
 * SQL Server tunnels through SSH to the SSH host, which falls back to the database host, see
 * `mssql/transport.ts`. Its older file transfer over SSH dials both in direct mode. The database
 * host counts by its server name, see `sqlServerHost`.
 */
const mssql: HostsOf = (config) => {
    const database = [sqlServerHost(config.host)].filter(present);
    const ssh = text(config.sshHost) ? hostsIn(config.sshHost) : [...hostsIn(config.host), ...database];
    if (config.connectionMode === "ssh") return ssh;
    return [...database, ...(config.fileTransferMode === "ssh" && text(config.sshUsername) ? ssh : [])];
};

export const DIALED_HOSTS: Readonly<Record<string, HostsOf>> = {
    // Databases
    mysql,
    mariadb: mysql,
    // Every entry of a libpq host list, see `postgresHosts`.
    postgres: directOrSsh((config) => postgresHosts(config.host)),
    // The hosts `parseMongoTarget` reads for the tools and the driver, and those of an older URI.
    mongodb: directOrSsh((config) => [...dialedMongoHosts({ host: text(config.host), port: Number(config.port) || 27017 } as Parameters<typeof dialedMongoHosts>[0]), ...mongoUriHosts(config.uri)]),
    // SQLite keeps its SSH host in `host`, see `sqlite/transport.ts`. Local mode opens a file of the server itself.
    sqlite: (config) => (config.mode === "ssh" ? hostsIn(config.host) : []),
    mssql,
    // SqlPackage gets `tcp:<host>,<port>` and the driver the same server name, see `sqlServerHost`.
    "azure-sql": (config) => [sqlServerHost(config.host)].filter(present),
    redis,
    valkey: redis,
    // `host/port` and `[v6]/port` by the host, see `firebirdHosts`.
    firebird: directOrSsh((config) => firebirdHosts(config.host)),

    // Storage
    "local-filesystem": none,
    // Without SSH it talks to the Docker socket of the server DBackup runs on.
    "docker-volume": (config) => (config.connectionMode === "ssh" ? hostsIn(config.sshHost) : []),
    // The SDK builds the endpoint from the region, which it checks itself.
    "s3-aws": none,
    "s3-generic": (config) => s3Hosts(urlHost(config.endpoint), config.bucket, config.forcePathStyle),
    "s3-r2": (config) => s3Hosts(r2Endpoint(config), config.bucket, false),
    "s3-hetzner": (config) => s3Hosts(urlHost(`https://${text(config.region)}.your-objectstorage.com`), config.bucket, false),
    "google-drive": none,
    dropbox: none,
    onedrive: none,
    sftp: host,
    ftp: host,
    // By the part after the last `@`, as rsync and OpenSSH read `user@host`, see `rsyncHosts`.
    rsync: (config) => rsyncHosts(config.host),
    // Only `//server/share` or `\\server\share`, anything else throws `HostFormatError`.
    smb: (config) => smbHost(config.address),
    webdav: (config) => [urlHost(config.url)].filter(present),

    // Notification channels
    discord: webhook,
    slack: webhook,
    teams: webhook,
    "generic-webhook": webhook,
    gotify: server,
    ntfy: server,
    telegram: none,
    "twilio-sms": none,
    email: host,
};

/**
 * What an id without an entry dials, like the SSH test of a form that names no adapter: the SSH
 * host in SSH mode, else the host. A new adapter gets an entry of its own, this only keeps a
 * config of an unknown kind from passing unchecked.
 */
const unknownAdapter = directOrSsh(host);

/**
 * The hosts DBackup connects to for a config, each once, as its clients read them.
 *
 * @throws HostFormatError for an address no client reads, like an SMB share without `//`.
 */
export function dialedHosts(adapterId: string, config: Config): string[] {
    const hostsOf = Object.hasOwn(DIALED_HOSTS, adapterId) ? DIALED_HOSTS[adapterId] : unknownAdapter;
    return [...new Set(hostsOf(config ?? {}))];
}
