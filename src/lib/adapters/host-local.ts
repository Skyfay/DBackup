import { getAdapterDefinition } from "./definitions";

/**
 * Which connections reach the server DBackup runs on instead of a server of their own: its files,
 * its Docker, its sockets, the tools it runs with arguments of the connection, and its SSH keys.
 * That server holds the key of every secret and the database of every tenant, so only a platform
 * admin with a session adds, changes, copies, tests or browses such a connection, and only in the
 * home tenant, never in the tenant of a customer. Other members of the home tenant may still pick
 * one that exists in their jobs. A plain module, since the server refuses them and the connection
 * form offers them to a platform admin alone.
 */

const HOST = "the server DBackup runs on";

/** Adapters that reach the server DBackup runs on in every mode. */
const ALWAYS_HOST_LOCAL: ReadonlySet<string> = new Set(["local-filesystem"]);

/** Database adapters whose `host` names the server in direct mode. */
const DATABASE_HOSTS: ReadonlySet<string> = new Set(["mysql", "mariadb", "postgres", "mongodb", "mssql", "azure-sql", "redis", "valkey", "firebird"]);

/**
 * Database adapters whose dump tools take the additional options of the connection as arguments.
 * In direct mode the tools run on the server DBackup runs on, where an option like `--result-file`
 * or `-f` writes any file DBackup may write. Redis and SQL Server store the field and never read it.
 */
const TOOL_OPTIONS: ReadonlySet<string> = new Set(["mysql", "mariadb", "postgres", "mongodb", "firebird"]);

/**
 * The rsync options that change how files move and name no file and no command. Anything else may,
 * like `-e`, which runs a command of its own on the server DBackup runs on, or a second path, which
 * rsync sends along with the backup.
 */
const SAFE_RSYNC_OPTION = new RegExp(
    "^(?:-[avzcrlptgoWhqPI46]+"
    + "|--(?:compress|no-compress|verbose|quiet|checksum|whole-file|no-whole-file|inplace|human-readable|stats|size-only|ignore-times|no-perms|no-owner|no-group|no-times|ipv4|ipv6|partial|progress)"
    + "|--(?:compress-level|bwlimit|timeout|contimeout)=[0-9.]+[kmgKMG]?)$"
);

const blank = (value: unknown) => value === undefined || value === null || String(value).trim() === "";

/** Zod defaults do not run on a stored config, so a missing mode is direct, as at run time. */
const direct = (config: Record<string, unknown>) => config.connectionMode !== "ssh";

/**
 * Whether the host field of a database names a Unix socket of the server DBackup runs on: a path.
 * libpq reads every entry of a comma list on its own, a path or an abstract socket (`@name`) in
 * any of them, and an empty entry of a list as its default socket. The MongoDB tools and driver
 * take a host that ends in `.sock` or holds an encoded `/` (`%2F`) as a socket path.
 */
function namesSocket(adapterId: string, host: unknown): boolean {
    if (host === undefined || host === null) return false;
    // A host that is no text, like a list, reads as its text for the tool and as nothing here, so it counts.
    if (typeof host !== "string") return true;
    const value = host.trim();
    if (value.startsWith("/")) return true;
    if (adapterId === "postgres") {
        const entries = value.split(",").map((entry) => entry.trim());
        return entries.some((entry) => entry.startsWith("/") || entry.startsWith("@")) || (entries.length > 1 && entries.includes(""));
    }
    if (adapterId === "mongodb") {
        // The hosts as `parseMongoTarget` cuts them: after the scheme and the user info, before a path.
        const hosts = value.replace(/^mongodb(?:\+srv)?:\/\//i, "").split("@").pop()!.split(/[/?#]/)[0];
        return hosts.split(",").some((entry) => /\.sock(?::\d+)?$/i.test(entry.trim()) || /%2f/i.test(entry));
    }
    return false;
}

/**
 * Whether SQL Server moves its backup files through a folder of the server DBackup runs on, as its
 * transport decides at run time, see `mssql/transport.ts`: neither over SSH nor with the older SSH
 * file transfer and a login for it.
 */
export function mssqlUsesLocalFolder(config: Record<string, unknown>): boolean {
    if (config.connectionMode === "ssh") return false;
    return !(config.fileTransferMode === "ssh" && !blank(config.sshUsername));
}

/** Whether an adapter reaches the server DBackup runs on in every mode, which a picker of a customer leaves out. */
export function isAlwaysHostLocal(adapterId: string): boolean {
    return ALWAYS_HOST_LOCAL.has(adapterId);
}

/**
 * Rsync logs in with the keys of the server DBackup runs on, its agent and its default identities,
 * unless it has a password or a key of its own, see `buildSshCommand` in `storage/rsync.ts`.
 */
function rsyncUsesHostKeys(config: Record<string, unknown>): boolean {
    if (config.authType === "password") return false;
    return !(config.authType === "privateKey" && !blank(config.privateKey));
}

/** What someone reads whose SSH login would go through the agent of the server DBackup runs on. */
const AGENT_LOGIN = `An SSH agent login uses the keys of ${HOST}, which only a platform admin uses. Use a password or a private key instead.`;

/**
 * Why a saved login logs in with the identity of the server DBackup runs on, as the sentence that
 * refuses it, or null. An SSH key profile with `authType: "agent"` hands its connections the SSH
 * agent of that server, rsync its default keys as well, see `rsyncUsesHostKeys`. A change of the
 * profile reaches every connection that logs in with it without a save of the connection, so the
 * profile is checked on its own when it is created or changed. SFTP never asks the agent, it fails
 * such a login instead.
 */
export function loginHostReason(type: string, data: unknown): string | null {
    if (type !== "SSH_KEY" || !data || typeof data !== "object") return null;
    return (data as { authType?: unknown }).authType === "agent" ? AGENT_LOGIN : null;
}

/**
 * Whether the connection opens an SSH login with its `ssh*` fields, as its transport decides at run
 * time: in SSH mode, and for SQL Server also with the older SSH file transfer and a login for it in
 * direct mode, which `mssqlTransport` in `mssql/transport.ts` dials over SSH as well.
 */
function usesSshLogin(adapterId: string, config: Record<string, unknown>): boolean {
    if (config.connectionMode === "ssh") return true;
    return adapterId === "mssql" && config.fileTransferMode === "ssh" && Boolean(config.sshUsername);
}

/** Whether an SSH login of the connection goes through the SSH agent of the server DBackup runs on. */
function usesHostAgent(adapterId: string, config: Record<string, unknown>): boolean {
    // SQLite keeps its SSH fields without the prefix, see `sqlite/transport.ts`.
    if (adapterId === "sqlite") return config.mode === "ssh" && config.authType === "agent";
    return usesSshLogin(adapterId, config) && config.sshAuthType === "agent";
}

/**
 * Why a connection reaches the server DBackup runs on, as the sentence that refuses it, or null when
 * it reaches a server of its own. Takes the config with its credential profiles laid over it.
 *
 * - Local Filesystem reads and writes the files of that server in any mode.
 * - Docker Volumes without SSH talk to its Docker socket, which mounts any of its folders.
 * - SQLite in local mode opens a file of it, like the database of DBackup.
 * - A database in direct mode through a socket, in any entry of a PostgreSQL host list too (see
 *   `namesSocket`), or with additional options for its tools,
 *   or MongoDB with a connection URI, whose options name files of it.
 * - Rsync with an option that names a file or a command, or without a login of its own.
 * - An SSH login through the agent of that server, whichever SSH login of the connection uses it.
 * - SQL Server that moves its backup files through a folder of that server, see `mssqlUsesLocalFolder`.
 */
export function hostLocalReason(adapterId: string, config: Record<string, unknown>): string | null {
    const name = getAdapterDefinition(adapterId)?.name ?? adapterId;

    if (ALWAYS_HOST_LOCAL.has(adapterId)) return `${name} reaches ${HOST}, which only a platform admin adds.`;

    if (adapterId === "docker-volume" && direct(config)) {
        return `${name} without SSH reach the Docker of ${HOST}, which only a platform admin adds. Connect to the Docker host over SSH instead.`;
    }

    if (adapterId === "sqlite" && config.mode !== "ssh") {
        return `${name} in local mode reads a file on ${HOST}, which only a platform admin adds. Reach the file over SSH instead.`;
    }

    if (DATABASE_HOSTS.has(adapterId) && direct(config)) {
        if (namesSocket(adapterId, config.host)) {
            return `${name} through a socket path reaches ${HOST}, which only a platform admin adds. Connect over the network or over SSH instead.`;
        }
        if (TOOL_OPTIONS.has(adapterId) && !blank(config.options)) {
            return `The additional options of ${name} run its tools on ${HOST}, which only a platform admin sets. Leave them empty or connect over SSH.`;
        }
        if (adapterId === "mongodb" && !blank(config.uri)) {
            return `A connection URI of ${name} runs its tools on ${HOST} with the options it holds, which only a platform admin sets. Use the host, the port and a credential profile instead.`;
        }
    }

    if (adapterId === "mssql" && mssqlUsesLocalFolder(config)) {
        return `${name} with a shared folder moves its backup files through a folder of ${HOST}, which only a platform admin sets. Fetch them over SSH instead.`;
    }

    if (adapterId === "rsync") {
        const unsafe = String(config.options ?? "").split(/\s+/).filter(Boolean).find((token) => !SAFE_RSYNC_OPTION.test(token));
        if (unsafe) return `The rsync option ${unsafe} reaches ${HOST}, which only a platform admin sets.`;
        if (rsyncUsesHostKeys(config)) {
            return `${name} without a password or a private key of its own logs in with the SSH keys of ${HOST}, which only a platform admin uses.`;
        }
    }

    if (usesHostAgent(adapterId, config)) return AGENT_LOGIN;

    return null;
}
