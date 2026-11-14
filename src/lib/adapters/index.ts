import { registry } from "@/lib/core/registry";
import { MySQLAdapter } from "./database/mysql";
import { MariaDBAdapter } from "./database/mariadb";
import { PostgresAdapter } from "./database/postgres";
import { MongoDBAdapter } from "./database/mongodb";
import { SQLiteAdapter } from "./database/sqlite";
import { MSSQLAdapter } from "./database/mssql";
import { AzureSQLAdapter } from "./database/azure-sql";
import { RedisAdapter } from "./database/redis";
import { ValkeyAdapter } from "./database/valkey";
import { FirebirdAdapter } from "./database/firebird";
import { LocalFileSystemAdapter } from "./storage/local";
import { DockerVolumeAdapter } from "./storage/docker";
import { S3GenericAdapter, S3AWSAdapter, S3R2Adapter, S3HetznerAdapter } from "./storage/s3";
import { SFTPAdapter } from "./storage/sftp";
import { SMBAdapter } from "./storage/smb";
import { WebDAVAdapter } from "./storage/webdav";
import { FTPAdapter } from "./storage/ftp";
import { RsyncAdapter } from "./storage/rsync";
import { withPinnedRsyncHost } from "./storage/rsync-pin";
import { withRsyncHostKey } from "./storage/rsync-host-key";
import { withPinnedDatabaseHost } from "./database/common/pinned-host";
import { GoogleDriveAdapter } from "./storage/google-drive";
import { DropboxAdapter } from "./storage/dropbox";
import { OneDriveAdapter } from "./storage/onedrive";
import { withCheckedDownloads } from "./storage/common/downloaded-file";
import { DiscordAdapter } from "./notification/discord";
import { SlackAdapter } from "./notification/slack";
import { TeamsAdapter } from "./notification/teams";
import { GenericWebhookAdapter } from "./notification/generic-webhook";
import { GotifyAdapter } from "./notification/gotify";
import { NtfyAdapter } from "./notification/ntfy";
import { TelegramAdapter } from "./notification/telegram";
import { TwilioSmsAdapter } from "./notification/twilio-sms";
import { EmailAdapter } from "./notification/email";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ module: "Adapters" });

let initialized = false;

// Register all available adapters here
export function registerAdapters() {
    if (initialized) return;

    // Pre-detect binary commands asynchronously (non-blocking)

    // The client tools of a tenant that blocks the local network dial the checked address of their
    // host, see `pinned-host.ts`. SQL Server pins in its pool, see `mssql/connector.ts`,
    // and Azure SQL there and for SqlPackage, see `azure-sql/exporter/pinned-server.ts`.
    registry.register(withPinnedDatabaseHost(MySQLAdapter));
    registry.register(withPinnedDatabaseHost(MariaDBAdapter));
    registry.register(withPinnedDatabaseHost(PostgresAdapter));
    registry.register(withPinnedDatabaseHost(MongoDBAdapter));
    registry.register(SQLiteAdapter);
    registry.register(MSSQLAdapter);
    registry.register(AzureSQLAdapter);
    registry.register(withPinnedDatabaseHost(RedisAdapter));
    registry.register(withPinnedDatabaseHost(ValkeyAdapter));
    registry.register(withPinnedDatabaseHost(FirebirdAdapter));

    // Every storage adapter is registered with its downloads checked, so a download that leaves a
    // link or anything else than a regular file fails, see `downloaded-file.ts`.
    registry.register(withCheckedDownloads(LocalFileSystemAdapter));
    registry.register(withCheckedDownloads(DockerVolumeAdapter));
    registry.register(withCheckedDownloads(S3GenericAdapter));
    registry.register(withCheckedDownloads(S3AWSAdapter));
    registry.register(withCheckedDownloads(S3R2Adapter));
    registry.register(withCheckedDownloads(S3HetznerAdapter));
    registry.register(withCheckedDownloads(SFTPAdapter));
    registry.register(withCheckedDownloads(SMBAdapter));
    registry.register(withCheckedDownloads(WebDAVAdapter));
    registry.register(withCheckedDownloads(FTPAdapter));
    registry.register(withCheckedDownloads(withPinnedRsyncHost(withRsyncHostKey(RsyncAdapter))));
    registry.register(withCheckedDownloads(GoogleDriveAdapter));
    registry.register(withCheckedDownloads(DropboxAdapter));
    registry.register(withCheckedDownloads(OneDriveAdapter));

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
