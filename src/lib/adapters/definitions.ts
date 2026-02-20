import { z } from "zod";

export type AdapterDefinition = {
    id: string;
    type: 'database' | 'storage' | 'notification';
    name: string;
    group?: string;
    configSchema: z.ZodObject<any>;
}

export const MySQLSchema = z.object({
    host: z.string().default("localhost"),
    port: z.coerce.number().default(3306),
    user: z.string().min(1, "User is required"),
    password: z.string().optional(),
    database: z.union([z.string(), z.array(z.string())]).default(""),
    options: z.string().optional().describe("Additional mysqldump options"),
    disableSsl: z.boolean().default(false).describe("Disable SSL (Use for self-signed development DBs)"),
});

export const MariaDBSchema = z.object({
    host: z.string().default("localhost"),
    port: z.coerce.number().default(3306),
    user: z.string().min(1, "User is required"),
    password: z.string().optional(),
    database: z.union([z.string(), z.array(z.string())]).default(""),
    options: z.string().optional().describe("Additional mariadb-dump options"),
    disableSsl: z.boolean().default(false).describe("Disable SSL (Use for self-signed development DBs)"),
});

export const PostgresSchema = z.object({
    host: z.string().default("localhost"),
    port: z.coerce.number().default(5432),
    user: z.string().min(1, "User is required"),
    password: z.string().optional(),
    database: z.union([z.string(), z.array(z.string())]).default(""),
    options: z.string().optional().describe("Additional pg_dump options"),
});

export const MongoDBSchema = z.object({
    uri: z.string().optional().describe("Connection URI (overrides other settings)"),
    host: z.string().default("localhost"),
    port: z.coerce.number().default(27017),
    user: z.string().optional(),
    password: z.string().optional(),
    authenticationDatabase: z.string().default("admin").optional(),
    database: z.union([z.string(), z.array(z.string())]).default(""),
    options: z.string().optional().describe("Additional mongodump options"),
});

export const SQLiteSchema = z.object({
    mode: z.enum(["local", "ssh"]).describe("Connection Mode"),

    // Common
    path: z.string().min(1, "Database path is required").describe("Absolute path to .sqlite file"),
    sqliteBinaryPath: z.string().default("sqlite3").optional().describe("Path to sqlite3 binary (default: sqlite3)"),

    // SSH Specific
    host: z.string().optional().describe("SSH Host (Required for SSH mode)"),
    port: z.coerce.number().default(22).optional(),
    username: z.string().optional().describe("SSH Username"),
    authType: z.enum(["password", "privateKey", "agent"]).default("password").optional().describe("Authentication Method"),
    password: z.string().optional().describe("SSH Password"),
    privateKey: z.string().optional().describe("SSH Private Key"),
    passphrase: z.string().optional().describe("SSH Key Passphrase"),
});

export const MSSQLSchema = z.object({
    host: z.string().default("localhost"),
    port: z.coerce.number().default(1433),
    user: z.string().min(1, "User is required"),
    password: z.string().optional(),
    database: z.union([z.string(), z.array(z.string())]).default(""),
    encrypt: z.boolean().default(true).describe("Encrypt connection (required for Azure SQL)"),
    trustServerCertificate: z.boolean().default(false).describe("Trust self-signed certificates (for development)"),
    backupPath: z.string().default("/var/opt/mssql/backup").describe("Server-side path where SQL Server writes .bak files"),
    fileTransferMode: z.enum(["local", "ssh"]).default("local").describe("How to access .bak files from the SQL Server"),
    localBackupPath: z.string().default("/tmp").optional().describe("Host-side path (Docker volume mount or shared filesystem)"),
    sshHost: z.string().optional().describe("SSH host of the SQL Server (defaults to DB host)"),
    sshPort: z.coerce.number().default(22).optional().describe("SSH port"),
    sshUsername: z.string().optional().describe("SSH username"),
    sshAuthType: z.enum(["password", "privateKey", "agent"]).default("password").optional().describe("SSH authentication method"),
    sshPassword: z.string().optional().describe("SSH password"),
    sshPrivateKey: z.string().optional().describe("SSH private key (PEM format)"),
    sshPassphrase: z.string().optional().describe("Passphrase for SSH private key"),
    requestTimeout: z.coerce.number().default(300000).describe("Request timeout in ms (default: 5 minutes, increase for large databases)"),
    options: z.string().optional().describe("Additional backup options"),
});

export const RedisSchema = z.object({
    mode: z.enum(["standalone", "sentinel"]).default("standalone").describe("Connection mode"),
    host: z.string().default("localhost"),
    port: z.coerce.number().default(6379),
    username: z.string().optional().describe("Username (Redis 6+ ACL, leave empty for default)"),
    password: z.string().optional(),
    database: z.coerce.number().min(0).max(15).default(0).describe("Database index (0-15)"),
    tls: z.boolean().default(false).describe("Enable TLS/SSL connection"),
    sentinelMasterName: z.string().optional().describe("Master name for Sentinel mode"),
    sentinelNodes: z.string().optional().describe("Comma-separated sentinel nodes (host:port,host:port)"),
    options: z.string().optional().describe("Additional redis-cli options"),
});

export const LocalStorageSchema = z.object({
    basePath: z.string().min(1, "Base path is required").default("/backups").describe("Absolute path to store backups (e.g., /backups)"),
});

// --- S3 / Cloud Storage Schemas ---

export const S3GenericSchema = z.object({
    endpoint: z.string().min(1, "Endpoint is required (e.g. https://s3.example.com)"),
    region: z.string().default("us-east-1"),
    bucket: z.string().min(1, "Bucket name is required"),
    accessKeyId: z.string().min(1, "Access Key is required"),
    secretAccessKey: z.string().min(1, "Secret Key is required"),
    forcePathStyle: z.boolean().default(false).describe("Use path-style URLs (Required for MinIO)"),
    pathPrefix: z.string().optional().describe("Optional folder prefix (e.g. /backups)"),
});

export const S3AWSSchema = z.object({
    region: z.string().min(1, "Region is required (e.g. us-east-1)"),
    bucket: z.string().min(1, "Bucket name is required"),
    accessKeyId: z.string().min(1, "Access Key is required"),
    secretAccessKey: z.string().min(1, "Secret Key is required"),
    pathPrefix: z.string().optional().describe("Optional folder prefix"),
    storageClass: z.enum(["STANDARD", "STANDARD_IA", "GLACIER", "DEEP_ARCHIVE"]).default("STANDARD").describe("Storage Class for uploaded files"),
});

export const S3R2Schema = z.object({
    accountId: z.string().min(1, "Cloudflare Account ID is required"),
    bucket: z.string().min(1, "Bucket name is required"),
    accessKeyId: z.string().min(1, "Access Key is required"),
    secretAccessKey: z.string().min(1, "Secret Key is required"),
    pathPrefix: z.string().optional().describe("Optional folder prefix"),
});

export const S3HetznerSchema = z.object({
    region: z.enum(["fsn1", "nbg1", "hel1", "ash"]).default("fsn1").describe("Hetzner Region"),
    bucket: z.string().min(1, "Bucket name is required"),
    accessKeyId: z.string().min(1, "Access Key is required"),
    secretAccessKey: z.string().min(1, "Secret Key is required"),
    pathPrefix: z.string().min(1, "Path prefix is required for Hetzner").describe("Folder prefix (Required)"),
});

export const SFTPSchema = z.object({
    host: z.string().min(1, "Host is required"),
    port: z.coerce.number().default(22),
    username: z.string().min(1, "Username is required"),
    authType: z.enum(["password", "privateKey", "agent"]).default("password").describe("Authentication Method"),
    password: z.string().optional().describe("Password"),
    privateKey: z.string().optional().describe("Private Key (PEM format, optional)"),
    passphrase: z.string().optional().describe("Passphrase for Private Key (optional)"),
    pathPrefix: z.string().optional().describe("Remote destination folder"),
});

export const SMBSchema = z.object({
    address: z.string().min(1, "Share address is required (e.g. //server/share)"),
    username: z.string().default("guest").describe("Username (default: guest)"),
    password: z.string().optional().describe("Password"),
    domain: z.string().optional().describe("Workgroup or domain name"),
    maxProtocol: z.enum(["SMB3", "SMB2", "NT1"]).default("SMB3").describe("Maximum SMB protocol version"),
    pathPrefix: z.string().optional().describe("Remote destination folder"),
});

export const WebDAVSchema = z.object({
    url: z.string().url("WebDAV server URL is required (e.g. https://nextcloud.example.com/remote.php/dav/files/user/)"),
    username: z.string().min(1, "Username is required"),
    password: z.string().optional().describe("Password"),
    pathPrefix: z.string().optional().describe("Remote destination folder"),
});

export const FTPSchema = z.object({
    host: z.string().min(1, "Host is required"),
    port: z.coerce.number().default(21),
    username: z.string().default("anonymous").describe("Username (default: anonymous)"),
    password: z.string().optional().describe("Password"),
    tls: z.boolean().default(false).describe("Enable TLS (FTPS)"),
    pathPrefix: z.string().optional().describe("Remote destination folder"),
});

export const RsyncSchema = z.object({
    host: z.string().min(1, "Host is required"),
    port: z.coerce.number().default(22).describe("SSH port"),
    username: z.string().min(1, "Username is required"),
    authType: z.enum(["password", "privateKey", "agent"]).default("password").describe("Authentication Method"),
    password: z.string().optional().describe("Password"),
    privateKey: z.string().optional().describe("Private Key (PEM format, optional)"),
    passphrase: z.string().optional().describe("Passphrase for Private Key (optional)"),
    pathPrefix: z.string().min(1, "Remote destination path is required").describe("Remote destination folder (e.g. /backups)"),
    options: z.string().optional().describe("Additional rsync options"),
});

export const GoogleDriveSchema = z.object({
    clientId: z.string().min(1, "Client ID is required").describe("OAuth Client ID (from Google Cloud Console)"),
    clientSecret: z.string().min(1, "Client Secret is required").describe("OAuth Client Secret"),
    refreshToken: z.string().optional().describe("OAuth Refresh Token (auto-filled after authorization)"),
    folderId: z.string().optional().describe("Google Drive Folder ID (leave empty for root)"),
});

export const DropboxSchema = z.object({
    clientId: z.string().min(1, "App Key is required").describe("Dropbox App Key (from Dropbox App Console)"),
    clientSecret: z.string().min(1, "App Secret is required").describe("Dropbox App Secret"),
    refreshToken: z.string().optional().describe("OAuth Refresh Token (auto-filled after authorization)"),
    folderPath: z.string().optional().describe("Dropbox folder path (e.g. /backups, leave empty for root)"),
});

export const OneDriveSchema = z.object({
    clientId: z.string().min(1, "Application (Client) ID is required").describe("Azure App Registration Client ID"),
    clientSecret: z.string().min(1, "Client Secret is required").describe("Azure App Registration Client Secret"),
    refreshToken: z.string().optional().describe("OAuth Refresh Token (auto-filled after authorization)"),
    folderPath: z.string().optional().describe("OneDrive folder path (e.g. /backups, leave empty for root)"),
});

export const DiscordSchema = z.object({
    webhookUrl: z.string().url("Valid Webhook URL is required"),
    username: z.string().optional().default("Backup Manager"),
    avatarUrl: z.string().url().optional(),
});

export const SlackSchema = z.object({
    webhookUrl: z.string().url("Valid Webhook URL is required"),
    channel: z.string().optional().describe("Override channel (optional)"),
    username: z.string().optional().default("DBackup").describe("Bot display name"),
    iconEmoji: z.string().optional().describe("Bot icon emoji (e.g. :shield:)"),
});

export const TeamsSchema = z.object({
    webhookUrl: z.string().url("Valid Webhook URL is required"),
});

export const GenericWebhookSchema = z.object({
    webhookUrl: z.string().url("Valid URL is required"),
    method: z.enum(["POST", "PUT", "PATCH"]).default("POST").describe("HTTP method"),
    contentType: z.string().default("application/json").describe("Content-Type header"),
    authHeader: z.string().optional().describe("Authorization header value (e.g. Bearer token)"),
    customHeaders: z.string().optional().describe("Additional headers (one per line, Key: Value)"),
    payloadTemplate: z.string().optional().describe("Custom JSON payload template with {{variable}} placeholders"),
});

export const GotifySchema = z.object({
    serverUrl: z.string().url("Valid Gotify server URL is required"),
    appToken: z.string().min(1, "App Token is required").describe("Application token (from Gotify Apps)"),
    priority: z.coerce.number().min(0).max(10).default(5).describe("Default message priority (0-10)"),
});

export const NtfySchema = z.object({
    serverUrl: z.string().url("Valid ntfy server URL is required").default("https://ntfy.sh"),
    topic: z.string().min(1, "Topic is required").describe("Notification topic name"),
    accessToken: z.string().optional().describe("Access token (required for protected topics)"),
    priority: z.coerce.number().min(1).max(5).default(3).describe("Default message priority (1-5)"),
});

export const TelegramSchema = z.object({
    botToken: z.string().min(1, "Bot Token is required").describe("Telegram Bot API token (from @BotFather)"),
    chatId: z.string().min(1, "Chat ID is required").describe("Chat, group, or channel ID"),
    parseMode: z.enum(["MarkdownV2", "HTML", "Markdown"]).default("HTML").describe("Message parse mode"),
    disableNotification: z.boolean().default(false).describe("Send silently (no notification sound)"),
});

export const TwilioSmsSchema = z.object({
    accountSid: z.string().min(1, "Account SID is required").describe("Twilio Account SID"),
    authToken: z.string().min(1, "Auth Token is required").describe("Twilio Auth Token"),
    from: z.string().min(1, "From number is required").describe("Sender phone number (E.164 format, e.g. +1234567890)"),
    to: z.string().min(1, "To number is required").describe("Recipient phone number (E.164 format, e.g. +1234567890)"),
});

export const EmailSchema = z.object({
    host: z.string().min(1, "SMTP Host is required"),
    port: z.coerce.number().default(587),
    secure: z.enum(["none", "ssl", "starttls"]).default("starttls"),
    user: z.string().optional(),
    password: z.string().optional(),
    from: z.string().min(1, "From email is required"),
    to: z.union([
        z.string().email("Valid To email is required"),
        z.array(z.string().email("Valid email required")).min(1, "At least one recipient is required"),
    ]),
});

// =============================================================================
// Inferred TypeScript Types from Zod Schemas
// =============================================================================
// Use these types instead of `any` for type-safe adapter configs

// Database Adapters
export type MySQLConfig = z.infer<typeof MySQLSchema>;
export type MariaDBConfig = z.infer<typeof MariaDBSchema>;
export type PostgresConfig = z.infer<typeof PostgresSchema>;
export type MongoDBConfig = z.infer<typeof MongoDBSchema>;
export type SQLiteConfig = z.infer<typeof SQLiteSchema>;
export type MSSQLConfig = z.infer<typeof MSSQLSchema>;
export type RedisConfig = z.infer<typeof RedisSchema>;

// Storage Adapters
export type LocalStorageConfig = z.infer<typeof LocalStorageSchema>;
export type S3GenericConfig = z.infer<typeof S3GenericSchema>;
export type S3AWSConfig = z.infer<typeof S3AWSSchema>;
export type S3R2Config = z.infer<typeof S3R2Schema>;
export type S3HetznerConfig = z.infer<typeof S3HetznerSchema>;
export type SFTPConfig = z.infer<typeof SFTPSchema>;
export type SMBConfig = z.infer<typeof SMBSchema>;
export type WebDAVConfig = z.infer<typeof WebDAVSchema>;
export type FTPConfig = z.infer<typeof FTPSchema>;
export type RsyncConfig = z.infer<typeof RsyncSchema>;
export type GoogleDriveConfig = z.infer<typeof GoogleDriveSchema>;
export type DropboxConfig = z.infer<typeof DropboxSchema>;
export type OneDriveConfig = z.infer<typeof OneDriveSchema>;

// Notification Adapters
export type DiscordConfig = z.infer<typeof DiscordSchema>;
export type SlackConfig = z.infer<typeof SlackSchema>;
export type TeamsConfig = z.infer<typeof TeamsSchema>;
export type GenericWebhookConfig = z.infer<typeof GenericWebhookSchema>;
export type GotifyConfig = z.infer<typeof GotifySchema>;
export type NtfyConfig = z.infer<typeof NtfySchema>;
export type TelegramConfig = z.infer<typeof TelegramSchema>;
export type TwilioSmsConfig = z.infer<typeof TwilioSmsSchema>;
export type EmailConfig = z.infer<typeof EmailSchema>;

// Union types for adapter categories
export type DatabaseConfig = MySQLConfig | MariaDBConfig | PostgresConfig | MongoDBConfig | SQLiteConfig | MSSQLConfig | RedisConfig;
export type StorageConfig = LocalStorageConfig | S3GenericConfig | S3AWSConfig | S3R2Config | S3HetznerConfig | SFTPConfig | SMBConfig | WebDAVConfig | FTPConfig | RsyncConfig | GoogleDriveConfig | DropboxConfig | OneDriveConfig;
export type NotificationConfig = DiscordConfig | SlackConfig | TeamsConfig | GenericWebhookConfig | GotifyConfig | NtfyConfig | TelegramConfig | TwilioSmsConfig | EmailConfig;

// Generic type alias for dialect base class (accepts any database config)
export type AnyDatabaseConfig = DatabaseConfig;

export const ADAPTER_DEFINITIONS: AdapterDefinition[] = [
    { id: "mysql", type: "database", name: "MySQL", configSchema: MySQLSchema },
    { id: "mariadb", type: "database", name: "MariaDB", configSchema: MariaDBSchema },
    { id: "postgres", type: "database", name: "PostgreSQL", configSchema: PostgresSchema },
    { id: "mongodb", type: "database", name: "MongoDB", configSchema: MongoDBSchema },
    { id: "sqlite", type: "database", name: "SQLite", configSchema: SQLiteSchema },
    { id: "mssql", type: "database", name: "Microsoft SQL Server", configSchema: MSSQLSchema },
    { id: "redis", type: "database", name: "Redis", configSchema: RedisSchema },

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

export function getAdapterDefinition(id: string) {
    return ADAPTER_DEFINITIONS.find(d => d.id === id);
}
