import { z } from "zod";
import { safePath } from "./shared";

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
    storageClass: z.enum(["STANDARD", "STANDARD_IA", "GLACIER", "DEEP_ARCHIVE"]).default("STANDARD").describe("Storage Class for uploaded files. Warning: GLACIER and DEEP_ARCHIVE are archived storage classes. Backups stored with these classes cannot be downloaded or restored directly through DBackup."),
});

export const S3R2Schema = z.object({
    accountId: z.string().min(1, "Cloudflare Account ID is required"),
    bucket: z.string().min(1, "Bucket name is required"),
    jurisdiction: z.enum(["default", "eu", "fedramp"]).default("default").describe("Bucket Jurisdiction (Standard, EU, or FedRAMP - must match the bucket's location)"),
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
    // Directory sources only, and only accepted once the server has been probed - see the
    // check-snapshot route. Snapshotting a backup destination gains nothing.
    useVss: z.boolean().default(false).describe("Read from a VSS shadow copy instead of the live share"),
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
    pathPrefix: safePath("Remote destination path").describe("Remote destination folder (e.g. /backups)"),
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

// Inferred TypeScript Types
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

export type StorageConfig = LocalStorageConfig | S3GenericConfig | S3AWSConfig | S3R2Config | S3HetznerConfig | SFTPConfig | SMBConfig | WebDAVConfig | FTPConfig | RsyncConfig | GoogleDriveConfig | DropboxConfig | OneDriveConfig;
