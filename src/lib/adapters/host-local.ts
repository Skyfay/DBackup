import { getAdapterDefinition } from "./definitions";

/**
 * Which connections reach the server DBackup runs on instead of a server of their own: its files,
 * its Docker, its sockets, the tools it runs with arguments of the connection, and its SSH keys.
 * That server holds the key of every secret and the database of every tenant, so only the platform
 * adds such a connection, never a customer. A plain module, since the server refuses them and the
 * adapter pickers of a customer leave out what reaches the server in every mode.
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

/** Whether an SSH login of the connection goes through the SSH agent of the server DBackup runs on. */
function usesHostAgent(adapterId: string, config: Record<string, unknown>): boolean {
    // SQLite keeps its SSH fields without the prefix, see `sqlite/transport.ts`.
    if (adapterId === "sqlite") return config.mode === "ssh" && config.authType === "agent";
    return config.connectionMode === "ssh" && config.sshAuthType === "agent";
}

/**
 * Why a connection reaches the server DBackup runs on, as the sentence that refuses it, or null when
 * it reaches a server of its own. Takes the config with its credential profiles laid over it.
 *
 * - Local Filesystem reads and writes the files of that server in any mode.
 * - Docker Volumes without SSH talk to its Docker socket, which mounts any of its folders.
 * - SQLite in local mode opens a file of it, like the database of DBackup.
 * - A database in direct mode through a socket path, or with additional options for its tools,
 *   or MongoDB with a connection URI, whose options name files of it.
 * - Rsync with an option that names a file or a command, or without a login of its own.
 * - An SSH login through the agent of that server.
 *
 * SQL Server in local file transfer mode is left out on purpose: it reads and deletes only a file
 * with a name it made up itself, with a time stamp to the millisecond, in the folder of the config.
 */
export function hostLocalReason(adapterId: string, config: Record<string, unknown>): string | null {
    const name = getAdapterDefinition(adapterId)?.name ?? adapterId;

    if (ALWAYS_HOST_LOCAL.has(adapterId)) return `${name} reaches ${HOST}, which only the platform adds.`;

    if (adapterId === "docker-volume" && direct(config)) {
        return `${name} without SSH reach the Docker of ${HOST}, which only the platform adds. Connect to the Docker host over SSH instead.`;
    }

    if (adapterId === "sqlite" && config.mode !== "ssh") {
        return `${name} in local mode reads a file on ${HOST}, which only the platform adds. Reach the file over SSH instead.`;
    }

    if (DATABASE_HOSTS.has(adapterId) && direct(config)) {
        if (typeof config.host === "string" && config.host.trim().startsWith("/")) {
            return `${name} through a socket path reaches ${HOST}, which only the platform adds. Connect over the network or over SSH instead.`;
        }
        if (TOOL_OPTIONS.has(adapterId) && !blank(config.options)) {
            return `The additional options of ${name} run its tools on ${HOST}, which only the platform sets. Leave them empty or connect over SSH.`;
        }
        if (adapterId === "mongodb" && !blank(config.uri)) {
            return `A connection URI of ${name} runs its tools on ${HOST} with the options it holds, which only the platform sets. Use the host, the port and a credential profile instead.`;
        }
    }

    if (adapterId === "rsync") {
        const unsafe = String(config.options ?? "").split(/\s+/).filter(Boolean).find((token) => !SAFE_RSYNC_OPTION.test(token));
        if (unsafe) return `The rsync option ${unsafe} reaches ${HOST}, which only the platform sets.`;
        if (rsyncUsesHostKeys(config)) {
            return `${name} without a password or a private key of its own logs in with the SSH keys of ${HOST}, which only the platform uses.`;
        }
    }

    if (usesHostAgent(adapterId, config)) {
        return `An SSH agent login uses the keys of ${HOST}, which only the platform uses. Use a password or a private key instead.`;
    }

    return null;
}
