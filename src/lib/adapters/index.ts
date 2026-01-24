import { registry } from "@/lib/core/registry";
import { MySQLAdapter } from "./database/mysql";
import { MariaDBAdapter } from "./database/mariadb";
import { PostgresAdapter } from "./database/postgres";
import { MongoDBAdapter } from "./database/mongodb";
import { LocalFileSystemAdapter } from "./storage/local";
import { S3GenericAdapter, S3AWSAdapter, S3R2Adapter, S3HetznerAdapter } from "./storage/s3";
import { DiscordAdapter } from "./notification/discord";
import { EmailAdapter } from "./notification/email";

let initialized = false;

// Register all available adapters here
export function registerAdapters() {
    if (initialized) return;

    registry.register(MySQLAdapter);
    registry.register(MariaDBAdapter);
    registry.register(PostgresAdapter);
    registry.register(MongoDBAdapter);

    registry.register(LocalFileSystemAdapter);
    registry.register(S3GenericAdapter);
    registry.register(S3AWSAdapter);
    registry.register(S3R2Adapter);
    registry.register(S3HetznerAdapter);

    registry.register(DiscordAdapter);
    registry.register(EmailAdapter);

    initialized = true;
    console.log("Adapters registered:", registry.getAll().map(a => a.id));
}
