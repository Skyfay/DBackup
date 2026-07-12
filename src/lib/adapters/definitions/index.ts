import { ADAPTER_CREDENTIAL_REQUIREMENTS } from "@/lib/core/credential-requirements";
import type { AdapterDefinition } from "./shared";
import {
    MySQLSchema, MariaDBSchema, PostgresSchema, MongoDBSchema,
    SQLiteSchema, MSSQLSchema, RedisSchema, FirebirdSchema,
} from "./database";
import {
    LocalStorageSchema, S3GenericSchema, S3AWSSchema, S3R2Schema, S3HetznerSchema,
    SFTPSchema, SMBSchema, WebDAVSchema, FTPSchema, RsyncSchema,
    GoogleDriveSchema, DropboxSchema, OneDriveSchema,
} from "./storage";
import {
    DiscordSchema, SlackSchema, TeamsSchema, GenericWebhookSchema,
    GotifySchema, NtfySchema, TelegramSchema, TwilioSmsSchema, EmailSchema,
} from "./notification";

// Re-export everything for backward compatibility
export * from "./shared";
export * from "./database";
export * from "./storage";
export * from "./notification";

export const ADAPTER_DEFINITIONS: AdapterDefinition[] = [
    { id: "mysql", type: "database", name: "MySQL", configSchema: MySQLSchema },
    { id: "mariadb", type: "database", name: "MariaDB", configSchema: MariaDBSchema },
    { id: "postgres", type: "database", name: "PostgreSQL", configSchema: PostgresSchema },
    { id: "mongodb", type: "database", name: "MongoDB", configSchema: MongoDBSchema },
    { id: "sqlite", type: "database", name: "SQLite", configSchema: SQLiteSchema },
    { id: "mssql", type: "database", name: "Microsoft SQL Server", configSchema: MSSQLSchema },
    { id: "redis", type: "database", name: "Redis", configSchema: RedisSchema },
    { id: "valkey", type: "database", name: "Valkey", configSchema: RedisSchema },
    { id: "firebird", type: "database", name: "Firebird", beta: true, configSchema: FirebirdSchema },

    { id: "local-filesystem", type: "storage", group: "Local", name: "Local Filesystem", configSchema: LocalStorageSchema },
    { id: "s3-aws", type: "storage", group: "Cloud Storage (S3)", name: "Amazon S3", configSchema: S3AWSSchema },
    { id: "s3-generic", type: "storage", group: "Cloud Storage (S3)", name: "S3 Compatible (Generic)", configSchema: S3GenericSchema },
    { id: "s3-r2", type: "storage", group: "Cloud Storage (S3)", name: "Cloudflare R2", configSchema: S3R2Schema },
    { id: "s3-hetzner", type: "storage", group: "Cloud Storage (S3)", name: "Hetzner Object Storage", configSchema: S3HetznerSchema },
    { id: "google-drive", type: "storage", group: "Cloud Drives", name: "Google Drive", configSchema: GoogleDriveSchema },
    { id: "dropbox", type: "storage", group: "Cloud Drives", name: "Dropbox", configSchema: DropboxSchema },
    { id: "onedrive", type: "storage", group: "Cloud Drives", name: "Microsoft OneDrive", configSchema: OneDriveSchema },
    { id: "sftp", type: "storage", group: "Network", name: "SFTP (SSH)", configSchema: SFTPSchema },
    { id: "ftp", type: "storage", group: "Network", name: "FTP / FTPS", configSchema: FTPSchema },
    { id: "webdav", type: "storage", group: "Network", name: "WebDAV", configSchema: WebDAVSchema },
    { id: "smb", type: "storage", group: "Network", name: "SMB (Samba)", configSchema: SMBSchema },
    { id: "rsync", type: "storage", group: "Network", name: "Rsync (SSH)", configSchema: RsyncSchema },

    { id: "discord", type: "notification", name: "Discord Webhook", configSchema: DiscordSchema },
    { id: "slack", type: "notification", name: "Slack Webhook", configSchema: SlackSchema },
    { id: "teams", type: "notification", name: "Microsoft Teams", configSchema: TeamsSchema },
    { id: "generic-webhook", type: "notification", name: "Generic Webhook", configSchema: GenericWebhookSchema },
    { id: "gotify", type: "notification", name: "Gotify", configSchema: GotifySchema },
    { id: "ntfy", type: "notification", name: "ntfy", configSchema: NtfySchema },
    { id: "telegram", type: "notification", name: "Telegram", configSchema: TelegramSchema },
    { id: "twilio-sms", type: "notification", name: "SMS (Twilio)", configSchema: TwilioSmsSchema },
    { id: "email", type: "notification", name: "Email (SMTP)", configSchema: EmailSchema },
];

// Attach credential requirements to every definition for the client form layer.
for (const def of ADAPTER_DEFINITIONS) {
    const reqs = ADAPTER_CREDENTIAL_REQUIREMENTS[def.id];
    if (reqs) def.credentials = reqs;
}

export function getAdapterDefinition(id: string) {
    return ADAPTER_DEFINITIONS.find(d => d.id === id);
}
