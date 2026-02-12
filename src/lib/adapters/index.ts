import { registry } from "@/lib/core/registry";
import { MySQLAdapter } from "./database/mysql";
import { MariaDBAdapter } from "./database/mariadb";
import { PostgresAdapter } from "./database/postgres";
import { MongoDBAdapter } from "./database/mongodb";
import { SQLiteAdapter } from "./database/sqlite";
import { MSSQLAdapter } from "./database/mssql";
import { RedisAdapter } from "./database/redis";
import { LocalFileSystemAdapter } from "./storage/local";
import { S3GenericAdapter, S3AWSAdapter, S3R2Adapter, S3HetznerAdapter } from "./storage/s3";
import { SFTPAdapter } from "./storage/sftp";
import { SMBAdapter } from "./storage/smb";
import { WebDAVAdapter } from "./storage/webdav";
import { FTPAdapter } from "./storage/ftp";
import { DiscordAdapter } from "./notification/discord";
import { EmailAdapter } from "./notification/email";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "Adapters" });

let initialized = false;

// Register all available adapters here
export function registerAdapters() {
    if (initialized) return;

    registry.register(MySQLAdapter);
    registry.register(MariaDBAdapter);
    registry.register(PostgresAdapter);
    registry.register(MongoDBAdapter);
    registry.register(SQLiteAdapter);
    registry.register(MSSQLAdapter);
    registry.register(RedisAdapter);

    registry.register(LocalFileSystemAdapter);
    registry.register(S3GenericAdapter);
    registry.register(S3AWSAdapter);
    registry.register(S3R2Adapter);
    registry.register(S3HetznerAdapter);
    registry.register(SFTPAdapter);
    registry.register(SMBAdapter);
    registry.register(WebDAVAdapter);
    registry.register(FTPAdapter);

    registry.register(DiscordAdapter);
    registry.register(EmailAdapter);

    initialized = true;
    log.debug("Adapters registered", { adapters: registry.getAll().map(a => a.id) });
}
