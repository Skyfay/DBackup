import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { PREFIXED_SSH_KEYS } from "@/lib/adapters/ssh-key-convention";
import { credentialManagedKeys, loginRequired } from "./connection-form-schema";
import { LOGIN_KEY, NAME_KEY, SSH_LOGIN_KEY, type SectionLayout } from "./connection-form-layout";

/** The program each adapter runs on the server when it works over SSH, named on the mode cards. */
const SSH_TOOL: Record<string, string> = {
    mysql: "mysqldump",
    mariadb: "mariadb-dump",
    postgres: "pg_dump",
    mongodb: "mongodump",
    redis: "redis-cli",
    valkey: "redis-cli",
    firebird: "gbak",
    sqlite: "sqlite3",
};

export function sshToolOf(adapterId: string): string | undefined {
    return SSH_TOOL[adapterId];
}

/**
 * Settings that tune the dump rather than reach the server, in the order the form lists them.
 * The Redis database index lives here too, which is why `database` only counts for Redis.
 */
const OPTION_KEYS = [
    "authenticationDatabase", "mode", "sentinelMasterName", "sentinelNodes", "database",
    "firebirdBinaryPath", "requestTimeout", "options", "tls", "disableSsl", "encrypt", "trustServerCertificate",
];

const REDIS_IDS = new Set(["redis", "valkey"]);

/**
 * Keys another part of the form owns, or that the form never shows: the databases a job
 * backs up are picked in the job, and `uri` is MongoDB's retired connection string.
 */
const NOT_OPTIONS = new Set([
    "host", "port", "connectionMode", "sshHost", "sshPort", ...PREFIXED_SSH_KEYS,
    "databases", "database", "uri", "backupPath", "fileTransferMode", "localBackupPath",
]);

/**
 * The settings with a working default. Besides the list above, any key of the schema that no
 * part claims lands here, so a field added to an adapter is never left out of the form.
 */
function optionKeys(adapter: AdapterDefinition, config: Record<string, unknown>): string[] {
    const shape = adapter.configSchema.shape as Record<string, unknown>;
    const isRedis = REDIS_IDS.has(adapter.id);
    const managed = credentialManagedKeys(adapter);
    const keys = OPTION_KEYS.filter((key) => {
        if (!(key in shape)) return false;
        if (key === "mode" || key === "database") return isRedis;
        // Only a Sentinel setup has a master name and Sentinel nodes.
        if (key === "sentinelMasterName" || key === "sentinelNodes") return config.mode === "sentinel";
        return true;
    });
    const unlisted = Object.keys(shape).filter((key) =>
        !OPTION_KEYS.includes(key) && !NOT_OPTIONS.has(key) && !managed.has(key)
    );
    // Over SSH, SQL Server's backup folder has no transfer to go with, so it moves here.
    if (adapter.id === "mssql" && config.connectionMode === "ssh") keys.push("backupPath");
    return [...keys, ...unlisted];
}

function sshDescription(adapterId: string): string {
    if (adapterId === "mssql") return "DBackup logs in here and reaches SQL Server through it. The backup file comes back the same way.";
    return `DBackup logs in here and runs ${sshToolOf(adapterId) ?? "the backup"} on this machine.`;
}

function behavior(): SectionLayout {
    return { id: "behavior", label: "Behavior", keys: [], expects: [] };
}

function sqliteLayout(config: Record<string, unknown>): SectionLayout[] {
    const mode = config.mode;
    const connection: SectionLayout = {
        id: "connection",
        label: "Connection",
        description: "What to call it and where the database file is.",
        keys: [NAME_KEY, "mode"],
        expects: [NAME_KEY, "mode"],
    };
    if (mode === "local") {
        connection.keys.push("path");
        connection.expects.push("path");
    }
    const sections = [connection];
    if (mode === "ssh") {
        sections.push(
            { id: "ssh", label: "SSH server", description: sshDescription("sqlite"), keys: ["host", "port", SSH_LOGIN_KEY], expects: ["host", SSH_LOGIN_KEY] },
            { id: "file", label: "Database file", description: "Where the file and sqlite3 are on the SSH server.", keys: ["path", "sqliteBinaryPath"], expects: ["path"] },
        );
    }
    return [...sections, behavior()];
}

/**
 * The parts of the form for a database, for the mode picked so far.
 *
 * Until a mode is picked, the parts that depend on it are left out and the rest stays, so
 * the list does not jump about more than it has to.
 */
export function databaseLayout(adapter: AdapterDefinition, config: Record<string, unknown>): SectionLayout[] {
    if (adapter.id === "sqlite") return sqliteLayout(config);

    const shape = adapter.configSchema.shape as Record<string, unknown>;
    const hasMode = "connectionMode" in shape;
    const mode = hasMode ? config.connectionMode : "direct";
    const login = adapter.credentials?.primary ? [LOGIN_KEY] : [];
    const expectedLogin = loginRequired(adapter) ? [LOGIN_KEY] : [];

    const connection: SectionLayout = {
        id: "connection",
        label: "Connection",
        keys: hasMode ? [NAME_KEY, "connectionMode"] : [NAME_KEY],
        expects: hasMode ? [NAME_KEY, "connectionMode"] : [NAME_KEY],
    };
    if (mode === "direct") {
        connection.description = "Where the database runs and how DBackup logs in.";
        connection.keys.push("host", "port", ...login);
        connection.expects.push("host", "port", ...expectedLogin);
    } else {
        connection.description = "What to call it and how DBackup reaches it.";
    }

    const sections: SectionLayout[] = [connection];

    if (mode === "ssh") {
        sections.push(
            { id: "ssh", label: "SSH server", description: sshDescription(adapter.id), keys: ["sshHost", "sshPort", SSH_LOGIN_KEY], expects: ["sshHost", SSH_LOGIN_KEY] },
            { id: "database", label: "Database", description: "As seen from the SSH server, usually 127.0.0.1.", keys: ["host", "port", ...login], expects: ["host", "port", ...expectedLogin] },
        );
    }

    if ("databases" in shape) {
        sections.push({
            id: "aliases",
            label: "Aliases",
            description: "Firebird cannot list its databases, so give each one a name and its path on the server.",
            keys: ["databases"],
            expects: ["databases"],
        });
    }

    // How a SQL Server backup file gets to DBackup. Over SSH it travels back on the same
    // connection, so there is nothing to choose.
    if (adapter.id === "mssql" && mode === "direct") {
        const transfer = config.fileTransferMode;
        sections.push({
            id: "transfer",
            label: "Backup file",
            description: "SQL Server writes the backup file on its own machine. This is how DBackup gets to it.",
            keys: ["backupPath", "fileTransferMode", "localBackupPath", "sshHost", "sshPort", SSH_LOGIN_KEY],
            expects: ["backupPath", ...(transfer === "ssh" ? [SSH_LOGIN_KEY] : transfer === "local" ? ["localBackupPath"] : [])],
        });
    }

    const options = optionKeys(adapter, config);
    if (options.length > 0) {
        sections.push({ id: "options", label: "Options", description: "Only needed when the defaults do not fit.", keys: options, expects: [] });
    }

    return [...sections, behavior()];
}
