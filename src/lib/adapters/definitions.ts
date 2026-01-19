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

export const LocalStorageSchema = z.object({
    basePath: z.string().min(1, "Base path is required").default("/backups").describe("Absolute path to store backups (e.g., /backups)"),
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

export const ADAPTER_DEFINITIONS: AdapterDefinition[] = [
    { id: "mysql", type: "database", name: "MySQL / MariaDB", configSchema: MySQLSchema },
    { id: "postgres", type: "database", name: "PostgreSQL", configSchema: PostgresSchema },
    { id: "mongodb", type: "database", name: "MongoDB", configSchema: MongoDBSchema },
    { id: "local-filesystem", type: "storage", name: "Local Filesystem", configSchema: LocalStorageSchema },
    { id: "discord", type: "notification", name: "Discord Webhook", configSchema: DiscordSchema },
    { id: "email", type: "notification", name: "Email (SMTP)", configSchema: EmailSchema },
];

export function getAdapterDefinition(id: string) {
    return ADAPTER_DEFINITIONS.find(d => d.id === id);
}
