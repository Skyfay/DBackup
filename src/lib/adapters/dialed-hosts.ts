/**
 * The hosts DBackup itself connects to for a config of a connection, per adapter, as plain data.
 * The local network check of a tenant resolves them, see `src/services/tenant/tenant-network.ts`.
 *
 * - A database in direct mode: its host, every host of a list (`a,b` of PostgreSQL, the sentinels
 *   of Redis, the hosts of a MongoDB URI). In SSH mode the SSH host alone, since whatever lies
 *   behind it is reached from that server and never from the one DBackup runs on. Agents will be
 *   the same later: DBackup dials the agent, the agent the database.
 * - A storage: the server of its address, the S3 endpoint and the host of a bucket on it.
 * - A notification channel: every URL or host a person types, its webhook, its server, its SMTP host.
 * - Nothing for an endpoint fixed by the adapter, like Amazon S3, the cloud drives, Telegram and
 *   Twilio, and nothing for what reaches the server DBackup runs on itself, which `host-local.ts`
 *   keeps to the platform.
 *
 * Every adapter id has an entry, which `tests/unit/adapters/dialed-hosts.test.ts` checks.
 */

type Config = Record<string, unknown>;
type HostsOf = (config: Config) => string[];

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

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

/** The hosts of a field that may list several, comma separated, like `db1,db2` of PostgreSQL. */
export function hostsIn(value: unknown): string[] {
    return text(value).split(",").map(hostOf).filter((host): host is string => host !== null);
}

/** The hosts of a MongoDB connection URI, `mongodb://user:pw@a:27017,b:27017/db`. Of an SRV URI only its name. */
function mongoUriHosts(value: unknown): string[] {
    const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?#]*)/i.exec(text(value));
    return match ? hostsIn(match[1]) : [];
}

/** The server of an SMB share address, `//server/share` or `\\server\share`. */
function smbHost(value: unknown): string[] {
    const normalized = text(value).replace(/\\/g, "/").replace(/^\/+/, "");
    const host = hostOf(normalized.split("/")[0]);
    return host ? [host] : [];
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
const webhook: HostsOf = (config) => [urlHost(config.webhookUrl)].filter((entry): entry is string => entry !== null);
const server: HostsOf = (config) => [urlHost(config.serverUrl)].filter((entry): entry is string => entry !== null);

/** Redis and Valkey: the host, and the sentinels in sentinel mode, which a sentinel connection dials first. */
const redis = directOrSsh((config) => [...hostsIn(config.host), ...(config.mode === "sentinel" ? hostsIn(config.sentinelNodes) : [])]);

export const DIALED_HOSTS: Readonly<Record<string, HostsOf>> = {
    // Databases
    mysql: directOrSsh(host),
    mariadb: directOrSsh(host),
    postgres: directOrSsh(host),
    mongodb: directOrSsh((config) => [...hostsIn(config.host), ...mongoUriHosts(config.uri)]),
    // SQLite keeps its SSH host in `host`, see `sqlite/transport.ts`. Local mode opens a file of the server itself.
    sqlite: (config) => (config.mode === "ssh" ? hostsIn(config.host) : []),
    // SQL Server tunnels through SSH to the SSH host, which falls back to the database host, see
    // `mssql/transport.ts`. Its older file transfer over SSH dials both in direct mode.
    mssql: (config) => {
        const ssh = hostsIn(text(config.sshHost) || config.host);
        if (config.connectionMode === "ssh") return ssh;
        return [...hostsIn(config.host), ...(config.fileTransferMode === "ssh" && text(config.sshUsername) ? ssh : [])];
    },
    "azure-sql": host,
    redis,
    valkey: redis,
    firebird: directOrSsh(host),

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
    rsync: host,
    smb: (config) => smbHost(config.address),
    webdav: (config) => [urlHost(config.url)].filter((entry): entry is string => entry !== null),

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

/** The hosts DBackup connects to for a config, each once, as typed. */
export function dialedHosts(adapterId: string, config: Config): string[] {
    const hostsOf = Object.hasOwn(DIALED_HOSTS, adapterId) ? DIALED_HOSTS[adapterId] : unknownAdapter;
    return [...new Set(hostsOf(config ?? {}))];
}
