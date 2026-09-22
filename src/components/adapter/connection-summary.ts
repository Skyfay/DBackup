import { DEFAULT_DOCKER_SOCKET } from "@/lib/adapters/definitions/storage";

type Config = Record<string, unknown>;

function parse(json: string | undefined): Config | null {
    if (!json) return null;
    try {
        const value = JSON.parse(json);
        return value && typeof value === "object" ? (value as Config) : null;
    } catch {
        return null;
    }
}

const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

function recipients(value: unknown): string {
    if (!Array.isArray(value)) return text(value);
    return value.length > 2 ? `${value.slice(0, 2).join(", ")} +${value.length - 2}` : value.join(", ");
}

/**
 * Where a connection points, in one line: host and port, bucket, path, or recipients.
 * Undefined when the config can not be read, null when the adapter has nothing to show.
 */
export function connectionAddress(adapterId: string, configJson: string): string | null | undefined {
    const config = parse(configJson);
    if (!config) return undefined;
    const hostPort = `${text(config.host)}:${text(config.port)}`;

    switch (adapterId) {
        case "mysql":
        case "postgres":
        case "mariadb":
        case "mssql":
        case "azure-sql":
        case "mongodb":
            return hostPort;
        case "redis":
        case "valkey":
            return `${hostPort}, DB ${text(config.database ?? 0)}`;
        case "firebird": {
            const count = Array.isArray(config.databases) ? config.databases.length : 0;
            return `${hostPort}, ${count} database${count === 1 ? "" : "s"}`;
        }
        case "sqlite":
            return text(config.path) || null;
        case "local-filesystem":
            return text(config.basePath) || null;
        case "docker-volume": {
            // The socket is this adapter's whole address. An empty field means the default one.
            const socket = text(config.socketPath) || DEFAULT_DOCKER_SOCKET;
            return config.connectionMode === "ssh" && config.sshHost ? `${text(config.sshHost)} · ${socket}` : socket;
        }
        case "smb":
            return text(config.pathPrefix) || text(config.address) || null;
        case "sftp":
        case "ftp":
        case "rsync":
            return text(config.pathPrefix) || hostPort;
        case "webdav":
            return text(config.pathPrefix) || text(config.url) || null;
        case "google-drive":
            return config.folderId ? `Folder ${text(config.folderId).slice(0, 12)}...` : "Root folder";
        case "dropbox":
        case "onedrive":
            return text(config.folderPath) || "/";
        case "discord":
        case "slack":
        case "teams":
            return "Webhook";
        case "generic-webhook":
            return `${text(config.method) || "POST"} ${text(config.webhookUrl)}`;
        case "gotify":
            return text(config.serverUrl) || null;
        case "ntfy":
            return `${text(config.serverUrl)}/${text(config.topic)}`;
        case "telegram":
            return `Chat ${text(config.chatId)}`;
        case "twilio-sms":
            return `${text(config.from)} → ${text(config.to)}`;
        case "email":
            return `${text(config.from)} → ${recipients(config.to)}`;
        default:
            // All S3 flavours (aws, generic, r2, hetzner, minio) are addressed by their bucket.
            return adapterId.startsWith("s3") ? text(config.bucket) || null : null;
    }
}

/** The jump host of a connection that goes through SSH, null for a direct one. */
export function connectionSshHost(configJson: string): string | null {
    const config = parse(configJson);
    if (!config) return null;
    const viaSsh = config.connectionMode === "ssh" || config.mode === "ssh";
    return viaSsh && config.sshHost ? text(config.sshHost) : null;
}

/** The server version found by the last version check, for database connections. */
export function connectionVersion(metadataJson: string | undefined): string | null {
    const metadata = parse(metadataJson);
    return metadata?.engineVersion ? text(metadata.engineVersion) : null;
}
