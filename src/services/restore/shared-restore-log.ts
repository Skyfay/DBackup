/**
 * The run log of a restore a customer started of a database on a shared server.
 *
 * The run lands in the customer's History, which may name their database and nothing else of the
 * server: no address, port or login, no archive, destination or other database of the backup, no
 * path on a disk. The database adapters log all of that freely, the command line with every
 * argument in `details`, the settings of the server and the errors of its tools, so every line of
 * such a run passes through here. A value the restore knows turns into a neutral word wherever it
 * shows, an address or a path by its shape, and the details are dropped.
 */

import type { LogLevel, LogType } from "@/lib/core/logs";

export type RunLog = (message: string, level?: LogLevel, type?: LogType, details?: string) => void;

/** What a restore knows of the server and the backup, and the names the customer may read. */
export interface SharedLogFacts {
    /** The names of the customer's database, in the backup and now, which every line keeps. */
    keep: readonly string[];
    /** The path of the archive at the destination. */
    archive?: string;
    /** The name of the destination of the archive. */
    destination?: string | null;
    /** The connection of the server, as the database adapter gets it. */
    connection?: Record<string, unknown>;
    /** The other databases the backup or the server holds. */
    otherDatabases?: readonly string[];
}

export interface SharedLogScrubber {
    /** The text as the customer reads it. */
    text(message: string): string;
    /** The log of the customer's run: every line scrubbed, without details or the diagnostics of the server. */
    wrap(log: RunLog): RunLog;
}

/**
 * The words a hidden value turns into. Each goes in as a character no value holds and becomes its
 * word at the end, so no later rule reads a word another one wrote.
 */
const WORDS = {
    server: "the server",
    port: "its port",
    user: "the user",
    backup: "the backup",
    archive: "a backup",
    path: "a path on the server",
    address: "an address",
    storage: "the storage",
    database: "another database",
    secret: "a secret",
} as const;
type Word = keyof typeof WORDS;

const MARK = Object.fromEntries(Object.keys(WORDS).map((word, index) => [word, String.fromCharCode(0xe000 + index)])) as Record<Word, string>;
const WORD_OF = new Map(Object.entries(MARK).map(([word, mark]) => [mark, WORDS[word as Word]]));
const MARKS = new RegExp(`[${Object.values(MARK).join("")}]`, "g");

/** Databases every server of an engine has, whose names say nothing about anyone. */
const SYSTEM_DATABASES = new Set([
    "mysql", "sys", "information_schema", "performance_schema", "postgres", "template0", "template1",
    "admin", "local", "config", "master", "model", "msdb", "tempdb",
]);

/** Lines in which an adapter reports the state of the server rather than the restore. Null drops the line. */
const SERVER_DIAGNOSTICS: { pattern: RegExp; as: string | null }[] = [
    // The variables of the server, read before a MySQL restore.
    { pattern: /^Server settings:/i, as: null },
    // The data folder of SQL Server, which says how the server is laid out.
    { pattern: /^Placing database files in:/i, as: null },
    // Lines of the kernel log of the server's host, which name its other processes.
    { pattern: /^OOM killer detected:/i, as: "The server ran out of memory during the restore." },
];

/** Characters of a name, which a hidden value never starts or ends inside of. */
const NAME = "A-Za-z0-9_$\\-";
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The values on their own, never as a part of a longer name, the longest first. `after` are the
 * characters that may not follow, those of a name unless the caller allows more.
 */
function whole(values: readonly string[], flags = "g", after = NAME): RegExp | null {
    const list = [...new Set(values)].sort((a, b) => b.length - a.length);
    if (list.length === 0) return null;
    return new RegExp(`(?<![${NAME}])(?:${list.map(escape).join("|")})(?![${after}])`, flags);
}

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`(?<![\\d.])${OCTET}(?:\\.${OCTET}){3}(?![\\d.]*\\d)`, "g");
const HEX = "[0-9A-Fa-f]{1,4}";
// A full address, or one with :: in it, never a time like 12:30:45.
const IPV6 = new RegExp(`(?<![0-9A-Za-z:.])(?:(?:${HEX}:){7}${HEX}|(?:${HEX}:){1,7}:(?:${HEX}(?::${HEX}){0,6})?|::${HEX}(?::${HEX}){0,6})(?![0-9A-Za-z:])`, "g");
/**
 * An account of MySQL or MariaDB as the server names it, like `'root'@'backup01.msp.internal'` or a
 * DEFINER `ops`@`%`. Its host is the machine DBackup runs on as the server sees it, which no setting
 * of the connection names, so the whole account goes.
 */
const ACCOUNT = /(['"`])[^'"`\n]*\1@(['"`])[^'"`\n]*\2/g;
// A path in quotes, which may hold spaces, like 'C:\Program Files\...\shop.bak'.
const QUOTED_PATH = /(['"])((?:[A-Za-z]:)?[\\/][^'"]*[\\/][^'"]*)\1/g;
// A path of two parts or more, like /var/opt/mssql/backup/shop.bak.
const PATH = /(?<![A-Za-z0-9_.~$-])(?:[A-Za-z]:)?[\\/](?:[^\s'"\\/<>|(),;]+[\\/])+[^\s'"<>|(),;]*/g;
// Another archive, like one of an incremental chain.
const ARCHIVE = /[^\s'"(),;=]+\.tar\b(?:\.[A-Za-z0-9]+)*/g;

/**
 * The version of the server as the customer reads it: the number of the engine without the build of
 * a distribution or the system it runs on, which say how the server is set up. So
 * `8.0.36-0ubuntu0.22.04.1` reads `8.0.36`, and the banner of SQL Server only its version number.
 */
const VERSIONS: { pattern: RegExp; as: string }[] = [
    // Microsoft SQL Server 2022 (RTM-CU12) (KB...) - 16.0.4135.4 (X64) ... on Linux (Ubuntu 22.04.4 LTS) <X64>
    { pattern: /Microsoft SQL (?:Server|Azure)\b[\s\S]*?\s-\s(\d+(?:\.\d+){1,3})[\s\S]*?(?:<[A-Z0-9]+>|$)/g, as: "$1" },
    // PostgreSQL 16.1 on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit
    { pattern: /(PostgreSQL \d+(?:\.\d+)*)(?: \([^)\n]*\))? on [^\s,]+(?:, compiled by [^\n]*?, \d+-bit)?/g, as: "$1" },
    // LI-V5.0.1.1469 Firebird 5.0, whose first letters name the system.
    { pattern: /(?<![A-Za-z0-9])[A-Z]{2}-[VT](\d+(?:\.\d+){1,3})(?: Firebird \d+(?:\.\d+)*)?/g, as: "$1" },
    // 16.2 (Debian 16.2-1.pgdg120+2)
    { pattern: /(\d+(?:\.\d+)+) \((?:Debian|Ubuntu|Red Hat|RHEL|CentOS|Rocky|AlmaLinux|Alpine|SUSE|openSUSE|Oracle|Amazon|Homebrew|Windows|Linux|FreeBSD)\b[^)\n]*\)/gi, as: "$1" },
    // 8.0.36-0ubuntu0.22.04.1, 10.11.6-MariaDB-0+deb12u1, never a time like 12:30:45.123+0000.
    { pattern: /(?<![\w.:/-])(\d+\.\d+(?:\.\d+){0,2})[-+~](?=[0-9A-Za-z.+~-]*[A-Za-z])[0-9A-Za-z+~-]+(?:\.[0-9A-Za-z+~-]+)*/g, as: "$1" },
];

/** The version of the server a customer's run keeps, see `VERSIONS`: its number alone, null without one. */
export function versionShown(version: string | null | undefined): string | null {
    if (!version) return null;
    return /\d+(?:\.\d+)+/.exec(version)?.[0] ?? /\d+/.exec(version)?.[0] ?? null;
}

function strings(value: unknown): string[] {
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
    if (Array.isArray(value)) return value.flatMap(strings);
    return [];
}

/** `host:port`, `[v6]:port` or a host alone. */
function splitNode(node: string): { host: string; port: string | null } {
    const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(node);
    if (bracketed) return { host: bracketed[1], port: bracketed[2] ?? null };
    const colon = node.lastIndexOf(":");
    if (colon > 0 && node.indexOf(":") === colon && /^\d+$/.test(node.slice(colon + 1))) return { host: node.slice(0, colon), port: node.slice(colon + 1) };
    return { host: node, port: null };
}

function decoded(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

interface Hidden {
    hosts: string[];
    ports: string[];
    users: string[];
    secrets: string[];
    paths: string[];
    databases: string[];
    whole: string[];
}

/** What the connection of a server names: its hosts, ports, logins, paths and databases. */
function connectionValues(connection: Record<string, unknown>): Hidden {
    const pick = (...keys: string[]) => keys.flatMap((key) => strings(connection[key]));
    const privileged = (connection.privilegedAuth ?? {}) as Record<string, unknown>;
    const listed = Array.isArray(connection.databases) ? (connection.databases as Record<string, unknown>[]) : [];
    const hidden: Hidden = {
        // The name of the master of a Sentinel names the server as much as its host does. The host
        // field may hold a list, which the loop below splits.
        hosts: pick("sshHost", "sentinelMasterName"),
        ports: pick("port", "sshPort"),
        users: [...pick("user", "username", "sshUsername"), ...strings(privileged.user)],
        secrets: [...pick("password", "sshPassword", "passphrase"), ...strings(privileged.password)],
        paths: [...pick("path", "backupPath", "localBackupPath", "sqliteBinaryPath", "firebirdBinaryPath"), ...listed.flatMap((entry) => strings(entry?.path))],
        databases: [...pick("database", "authenticationDatabase"), ...listed.flatMap((entry) => strings(entry?.name))],
        whole: pick("uri"),
    };

    // A URI, the nodes of a Sentinel and a host field with a list, like the members of a MongoDB
    // replica set as `rs0/mongo1:27017,mongo2:27017`, name hosts, ports and a login of their own.
    const nodes = pick("sentinelNodes").flatMap((value) => value.split(","));
    for (const host of pick("host")) {
        const replicaSet = /^([A-Za-z0-9_.-]+)\/(.+)$/.exec(host);
        if (replicaSet) hidden.hosts.push(replicaSet[1]);
        nodes.push(...(replicaSet ? replicaSet[2] : host).split(","));
    }
    for (const uri of hidden.whole) {
        const parts = /^[a-z][a-z0-9+.-]*:\/\/(?:([^@/?#]*)@)?([^/?#]*)(?:[^?#]*)(?:\?([^#]*))?/i.exec(uri);
        if (!parts) continue;
        const [user, password] = (parts[1] ?? "").split(":");
        if (user) hidden.users.push(decoded(user));
        if (password) hidden.secrets.push(decoded(password));
        nodes.push(...parts[2].split(","));
        // The name of the replica set names the cluster as much as its hosts do.
        const replicaSet = new URLSearchParams(parts[3] ?? "").get("replicaSet");
        if (replicaSet) hidden.hosts.push(replicaSet);
    }
    for (const node of nodes) {
        const { host, port } = splitNode(node.trim());
        if (host) hidden.hosts.push(host);
        if (port) hidden.ports.push(port);
    }
    // The server of Azure SQL goes by its first label too, like the acme-sql of a login sqladmin@acme-sql.
    for (const host of [...hidden.hosts]) {
        const azure = /^([a-z0-9-]+)\.database\.(?:windows\.net|chinacloudapi\.cn|usgovcloudapi\.net|cloudapi\.de)$/i.exec(host);
        if (azure) hidden.hosts.push(azure[1]);
    }
    return hidden;
}

/**
 * The domains of the hosts, like `msp.internal` of `db7.msp.internal`, whose other hosts a line may
 * name too, like a replica or the node a cluster sent the restore to. A domain of one label, like
 * `com` or the `msp` of `mongo1.msp`, says too little to hide, and an address has none.
 */
function domainsOf(hosts: readonly string[]): string[] {
    return hosts.flatMap((host) => {
        const labels = host.toLowerCase().split(".");
        if (labels.length < 3 || labels.some((label) => !/^[a-z0-9-]+$/.test(label)) || labels.every((label) => /^\d+$/.test(label))) return [];
        return [labels.slice(1).join(".")];
    });
}

/** The archive as a line may name it: its path, its folder, its name and its name without the extension. */
function archiveValues(archive: string): string[] {
    const normalized = archive.replace(/\\/g, "/");
    const name = normalized.split("/").pop() ?? normalized;
    const folder = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    const stem = name.replace(/\.tar(?:\.[A-Za-z0-9]+)*$/, "");
    return [archive, normalized, folder, name, stem];
}

interface Rule {
    pattern: RegExp;
    /** A mark, or a replacement with `$1` for a rule that ignores the kept names. */
    as: string;
    /** Whether a match inside a name the customer may read stays as it is. */
    keepNames: boolean;
}

/** Replaces the matches of a rule, leaving the ones that lie inside a kept name. */
function apply(text: string, rule: Rule, keep: RegExp | null): string {
    rule.pattern.lastIndex = 0;
    if (!rule.keepNames || !keep) return text.replace(rule.pattern, rule.as);
    const kept = [...text.matchAll(keep)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length] as const);
    return text.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
        const offset = rest[rest.length - 2] as number;
        return kept.some(([start, end]) => start <= offset && offset + match.length <= end) ? match : rule.as;
    });
}

/** The scrubber of a customer's restore log, from what the restore knows. */
export function sharedLogScrubber(facts: SharedLogFacts): SharedLogScrubber {
    const keepNames = [...new Set(facts.keep.filter((name) => name.length > 0))];
    const isKept = (value: string) => keepNames.some((name) => name.toLowerCase() === value.toLowerCase());
    // A value of one letter would hide that letter in every word, a kept name is the customer's own.
    const usable = (values: readonly string[]) => values.filter((value) => value.length >= 2 && !isKept(value));

    const connection = connectionValues(facts.connection ?? {});
    const hosts = usable(connection.hosts);
    const domains = [...new Set(domainsOf(hosts))];
    const ports = [...new Set(connection.ports.filter((port) => /^\d+$/.test(port)))];
    const databases = usable([...(facts.otherDatabases ?? []), ...connection.databases])
        .filter((name) => /[A-Za-z]/.test(name) && !SYSTEM_DATABASES.has(name.toLowerCase()));

    const values = (list: readonly string[], as: string, keepNames: boolean, flags?: string, after?: string): Rule[] => {
        const pattern = whole(list, flags, after);
        return pattern ? [{ pattern, as, keepNames }] : [];
    };
    // A host of one label, like db7, with a domain after it, like db7.msp.internal.
    const labels = hosts.filter((host) => /^[A-Za-z0-9-]+$/.test(host) && !/^\d+$/.test(host));
    const hidden = `${MARK.server}${MARK.address}`;
    // In this order: what may hold spaces before the shapes that end at one, a path before the
    // names that may be a part of it.
    const rules: Rule[] = [
        ...values(usable(connection.secrets), MARK.secret, false),
        ...values(usable(facts.archive ? archiveValues(facts.archive) : []), MARK.backup, false),
        ...values(usable(connection.paths), MARK.path, false),
        ...values(usable(connection.whole), MARK.server, false),
        { pattern: ACCOUNT, as: `$1${MARK.user}$1@$2${MARK.address}$2`, keepNames: false },
        { pattern: QUOTED_PATH, as: `$1${MARK.path}$1`, keepNames: false },
        { pattern: PATH, as: MARK.path, keepNames: false },
        { pattern: ARCHIVE, as: MARK.archive, keepNames: false },
        // The version of the server without its build and system, before an address could take a part of it.
        ...VERSIONS.map((rule) => ({ ...rule, keepNames: false })),
        ...(labels.length > 0 ? [{ pattern: new RegExp(`(?<![${NAME}.])(?:${labels.map(escape).join("|")})(?:\\.[A-Za-z0-9-]+)+(?![${NAME}])`, "gi"), as: MARK.server, keepNames: true }] : []),
        ...values(hosts, MARK.server, true, "gi"),
        // Any other host of the same domain. Only the start of a name is tried, never a part of one.
        ...(domains.length > 0 ? [{ pattern: new RegExp(`(?<![${NAME}.])(?:[A-Za-z0-9-]+\\.)*(?:${domains.map(escape).join("|")})(?![${NAME}])`, "gi"), as: MARK.server, keepNames: true }] : []),
        { pattern: IPV4, as: MARK.address, keepNames: true },
        { pattern: IPV6, as: MARK.address, keepNames: true },
        // Any port after a hidden server or address, as in 10.0.0.8:43125 or Firebird's db7/3051:path.
        { pattern: new RegExp(`([${hidden}]\\]?)(?::\\d{1,5}|\\/\\d{1,5}(?=:))(?![0-9])`, "g"), as: "$1", keepNames: false },
        // A port of the server after anything else, as in host:3306, named as one, as in "port 5432",
        // or as a flag, as in -P 3306.
        ...(ports.length > 0 ? [
            { pattern: new RegExp(`(?<![0-9])(?:[:,](?:${ports.join("|")})|\\/(?:${ports.join("|")})(?=:))(?![0-9])`, "g"), as: "", keepNames: false },
            { pattern: new RegExp(`(?<![A-Za-z0-9-])-P ?(?:${ports.join("|")})(?![0-9])`, "g"), as: `-P ${MARK.port}`, keepNames: false },
            { pattern: new RegExp(`\\bport[\\s=:]{0,3}(?:${ports.join("|")})(?![0-9])`, "gi"), as: MARK.port, keepNames: false },
        ] : []),
        ...values(usable(connection.users), MARK.user, true),
        ...values(usable(facts.destination ? [facts.destination] : []), MARK.storage, true),
        // Also at the start of a longer name, like the billing of a file billing_log.
        ...values(databases, MARK.database, true, "g", "A-Za-z0-9$"),
    ];
    const keep = whole(keepNames);

    const text = (message: string): string =>
        rules.reduce((current, rule) => apply(current, rule, keep), message).replace(MARKS, (mark) => WORD_OF.get(mark) ?? mark);

    return {
        text,
        wrap: (log) => (message, level, type) => {
            const diagnostic = SERVER_DIAGNOSTICS.find((entry) => entry.pattern.test(message));
            if (diagnostic?.as === null) return;
            // The details hold whole command lines and the output of the server's tools, which name
            // the server in more ways than any rule here knows.
            log(text(diagnostic?.as ?? message), level, type);
        },
    };
}
