import { registry } from "@/lib/core/registry";
import { MySQLAdapter } from "./database/mysql";
import { PostgresAdapter } from "./database/postgres";
import { MongoDBAdapter } from "./database/mongodb";
import { LocalFileSystemAdapter } from "./storage/local";
import { DiscordAdapter } from "./notification/discord";
import { EmailAdapter } from "./notification/email";

// Register all available adapters here
export function registerAdapters() {
    registry.register(MySQLAdapter);
    registry.register(PostgresAdapter);
    registry.register(MongoDBAdapter);

    registry.register(LocalFileSystemAdapter);

    registry.register(DiscordAdapter);
    registry.register(EmailAdapter);

    console.log("Adapters registered:", registry.getAll().map(a => a.id));
}
