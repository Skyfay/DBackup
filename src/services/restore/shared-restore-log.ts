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
    // Lines of the kernel log of the server's host, which name its other processes.
    { pattern: /^OOM killer detected:/i, as: "The server ran out of memory during the restore." },
];

/** Characters of a name, which a hidden value never starts or ends inside of. */
const NAME = "A-Za-z0-9_$\\-";
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The values on their own, never as a part of a longer name, the longest first. */
function whole(values: readonly string[], flags = "g"): RegExp | null {
    const list = [...new Set(values)].sort((a, b) => b.length - a.length);
    if (list.length === 0) return null;
    return new RegExp(`(?<![${NAME}])(?:${list.map(escape).join("|")})(?![${NAME}])`, flags);
}

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`(?<![\\d.])${OCTET}(?:\\.${OCTET}){3}(?![\\d.]*\\d)`, "g");
const HEX = "[0-9A-Fa-f]{1,4}";
// A full address, or one with :: in it, never a time like 12:30:45.
const IPV6 = new RegExp(`(?<![0-9A-Za-z:.])(?:(?:${HEX}:){7}${HEX}|(?:${HEX}:){1,7}:(?:${HEX}(?::${HEX}){0,6})?|::${HEX}(?::${HEX}){0,6})(?![0-9A-Za-z:])`, "g");
// A path in quotes, which may hold spaces, like 'C:\Program Files\...\shop.bak'.
const QUOTED_PATH = /(['"])((?:[A-Za-z]:)?[\\/][^'"]*[\\/][^'"]*)\1/g;
// A path of two parts or more, like /var/opt/mssql/backup/shop.bak.
const PATH = /(?<![A-Za-z0-9_.~$-])(?:[A-Za-z]:)?[\\/](?:[^\s'"\\/<>|(),;]+[\\/])+[^\s'"<>|(),;]*/g;
// Another archive, like one of an incremental chain.
const ARCHIVE = /[^\s'"(),;=]+\.tar\b(?:\.[A-Za-z0-9]+)*/g;

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
        // The name of the master of a Sentinel names the server as much as its host does.
        hosts: pick("host", "sshHost", "sentinelMasterName"),
        ports: pick("port", "sshPort"),
        users: [...pick("user", "username", "sshUsername"), ...strings(privileged.user)],
        secrets: [...pick("password", "sshPassword", "passphrase"), ...strings(privileged.password)],
        paths: [...pick("path", "backupPath", "localBackupPath", "sqliteBinaryPath", "firebirdBinaryPath"), ...listed.flatMap((entry) => strings(entry?.path))],
        databases: [...pick("database", "authenticationDatabase"), ...listed.flatMap((entry) => strings(entry?.name))],
        whole: pick("uri"),
    };

    // A URI and the nodes of a Sentinel name hosts, ports and a login of their own.
    const nodes = pick("sentinelNodes").flatMap((value) => value.split(","));
    for (const uri of hidden.whole) {
        const parts = /^[a-z][a-z0-9+.-]*:\/\/(?:([^@/?#]*)@)?([^/?#]*)/i.exec(uri);
        if (!parts) continue;
        const [user, password] = (parts[1] ?? "").split(":");
        if (user) hidden.users.push(decoded(user));
        if (password) hidden.secrets.push(decoded(password));
        nodes.push(...parts[2].split(","));
    }
    for (const node of nodes) {
        const { host, port } = splitNode(node.trim());
        if (host) hidden.hosts.push(host);
        if (port) hidden.ports.push(port);
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

    const values = (list: readonly string[], as: string, keepNames: boolean, flags?: string): Rule[] => {
        const pattern = whole(list, flags);
        return pattern ? [{ pattern, as, keepNames }] : [];
    };
    // In this order: what may hold spaces before the shapes that end at one, a path before the
    // names that may be a part of it.
    const rules: Rule[] = [
        ...values(usable(connection.secrets), MARK.secret, false),
        ...values(usable(facts.archive ? archiveValues(facts.archive) : []), MARK.backup, false),
        ...values(usable(connection.paths), MARK.path, false),
        ...values(usable(connection.whole), MARK.server, false),
        { pattern: QUOTED_PATH, as: `$1${MARK.path}$1`, keepNames: false },
        { pattern: PATH, as: MARK.path, keepNames: false },
        { pattern: ARCHIVE, as: MARK.archive, keepNames: false },
        ...values(hosts, MARK.server, true, "gi"),
        // Any other host of the same domain. Only the start of a name is tried, never a part of one.
        ...(domains.length > 0 ? [{ pattern: new RegExp(`(?<![${NAME}.])(?:[A-Za-z0-9-]+\\.)*(?:${domains.map(escape).join("|")})(?![${NAME}])`, "gi"), as: MARK.server, keepNames: true }] : []),
        { pattern: IPV4, as: MARK.address, keepNames: true },
        { pattern: IPV6, as: MARK.address, keepNames: true },
        // A port after its server, as in host:3306, or named as one, as in "port 5432".
        ...(ports.length > 0 ? [
            { pattern: new RegExp(`(?<![0-9])[:,](?:${ports.join("|")})(?![0-9])`, "g"), as: "", keepNames: false },
            { pattern: new RegExp(`\\bport[\\s=:]{0,3}(?:${ports.join("|")})(?![0-9])`, "gi"), as: MARK.port, keepNames: false },
        ] : []),
        ...values(usable(connection.users), MARK.user, true),
        ...values(usable(facts.destination ? [facts.destination] : []), MARK.storage, true),
        ...values(databases, MARK.database, true),
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
