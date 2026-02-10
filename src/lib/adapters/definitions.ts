import { z } from "zod";

export type AdapterDefinition = {
    id: string;
    type: 'database' | 'storage' | 'notification';
    name: string;
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
    backupPath: z.string().default("/var/opt/mssql/backup").describe("Server-side path for .bak files (inside container)"),
    localBackupPath: z.string().default("/tmp").describe("Host-side path where Docker volume is mounted (must match your docker-compose volume)"),
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

export const DiscordSchema = z.object({
    webhookUrl: z.string().url("Valid Webhook URL is required"),
    username: z.string().optional().default("Backup Manager"),
    avatarUrl: z.string().url().optional(),
});

export const EmailSchema = z.object({
    host: z.string().min(1, "SMTP Host is required"),
    port: z.coerce.number().default(587),
    secure: z.enum(["none", "ssl", "starttls"]).default("starttls"),
    user: z.string().optional(),
    password: z.string().optional(),
    from: z.string().min(1, "From email is required"),
    to: z.string().email("Valid To email is required"),
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

// Notification Adapters
export type DiscordConfig = z.infer<typeof DiscordSchema>;
export type EmailConfig = z.infer<typeof EmailSchema>;

// Union types for adapter categories
export type DatabaseConfig = MySQLConfig | MariaDBConfig | PostgresConfig | MongoDBConfig | SQLiteConfig | MSSQLConfig | RedisConfig;
export type StorageConfig = LocalStorageConfig | S3GenericConfig | S3AWSConfig | S3R2Config | S3HetznerConfig | SFTPConfig | SMBConfig | WebDAVConfig;
export type NotificationConfig = DiscordConfig | EmailConfig;

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

    { id: "local-filesystem", type: "storage", name: "Local Filesystem", configSchema: LocalStorageSchema },
    { id: "s3-generic", type: "storage", name: "S3 Compatible (Generic)", configSchema: S3GenericSchema },
    { id: "s3-aws", type: "storage", name: "Amazon S3", configSchema: S3AWSSchema },
    { id: "s3-r2", type: "storage", name: "Cloudflare R2", configSchema: S3R2Schema },
    { id: "s3-hetzner", type: "storage", name: "Hetzner Object Storage", configSchema: S3HetznerSchema },
    { id: "sftp", type: "storage", name: "SFTP (SSH)", configSchema: SFTPSchema },
    { id: "smb", type: "storage", name: "SMB (Samba)", configSchema: SMBSchema },
    { id: "webdav", type: "storage", name: "WebDAV", configSchema: WebDAVSchema },

    { id: "discord", type: "notification", name: "Discord Webhook", configSchema: DiscordSchema },
    { id: "email", type: "notification", name: "Email (SMTP)", configSchema: EmailSchema },
];

export function getAdapterDefinition(id: string) {
    return ADAPTER_DEFINITIONS.find(d => d.id === id);
}
