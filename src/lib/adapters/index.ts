import { registry } from "@/lib/core/registry";
import { MySQLAdapter } from "./database/mysql";
import { MariaDBAdapter } from "./database/mariadb";
import { PostgresAdapter } from "./database/postgres";
import { MongoDBAdapter } from "./database/mongodb";
import { SQLiteAdapter } from "./database/sqlite";
import { MSSQLAdapter } from "./database/mssql";
import { RedisAdapter } from "./database/redis";
import { ValkeyAdapter } from "./database/valkey";
import { FirebirdAdapter } from "./database/firebird";
import { LocalFileSystemAdapter } from "./storage/local";
import { S3GenericAdapter, S3AWSAdapter, S3R2Adapter, S3HetznerAdapter } from "./storage/s3";
import { SFTPAdapter } from "./storage/sftp";
import { SMBAdapter } from "./storage/smb";
import { WebDAVAdapter } from "./storage/webdav";
import { FTPAdapter } from "./storage/ftp";
import { RsyncAdapter } from "./storage/rsync";
import { GoogleDriveAdapter } from "./storage/google-drive";
import { DropboxAdapter } from "./storage/dropbox";
import { OneDriveAdapter } from "./storage/onedrive";
import { DiscordAdapter } from "./notification/discord";
import { SlackAdapter } from "./notification/slack";
import { TeamsAdapter } from "./notification/teams";
import { GenericWebhookAdapter } from "./notification/generic-webhook";
import { GotifyAdapter } from "./notification/gotify";
import { NtfyAdapter } from "./notification/ntfy";
import { TelegramAdapter } from "./notification/telegram";
import { TwilioSmsAdapter } from "./notification/twilio-sms";
import { EmailAdapter } from "./notification/email";
import { initMysqlTools } from "./database/mysql/tools";
import { initFirebirdTools } from "./database/firebird/tools";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ module: "Adapters" });

let initialized = false;

// Register all available adapters here
export function registerAdapters() {
    if (initialized) return;

    // Pre-detect binary commands asynchronously (non-blocking)
    initMysqlTools().catch(() => { /* fallback to defaults */ });
    initFirebirdTools().catch(() => { /* fallback to defaults */ });

    registry.register(MySQLAdapter);
    registry.register(MariaDBAdapter);
    registry.register(PostgresAdapter);
    registry.register(MongoDBAdapter);
    registry.register(SQLiteAdapter);
    registry.register(MSSQLAdapter);
    registry.register(RedisAdapter);
    registry.register(ValkeyAdapter);
    registry.register(FirebirdAdapter);

    registry.register(LocalFileSystemAdapter);
    registry.register(S3GenericAdapter);
    registry.register(S3AWSAdapter);
    registry.register(S3R2Adapter);
    registry.register(S3HetznerAdapter);
    registry.register(SFTPAdapter);
    registry.register(SMBAdapter);
    registry.register(WebDAVAdapter);
    registry.register(FTPAdapter);
    registry.register(RsyncAdapter);
    registry.register(GoogleDriveAdapter);
    registry.register(DropboxAdapter);
    registry.register(OneDriveAdapter);

    registry.register(DiscordAdapter);
    registry.register(SlackAdapter);
    registry.register(TeamsAdapter);
    registry.register(GenericWebhookAdapter);
    registry.register(GotifyAdapter);
    registry.register(NtfyAdapter);
    registry.register(TelegramAdapter);
    registry.register(TwilioSmsAdapter);
    registry.register(EmailAdapter);

    initialized = true;
    log.debug("Adapters registered", { adapters: registry.getAll().map(a => a.id) });
}
