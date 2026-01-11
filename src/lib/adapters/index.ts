import { registry } from "@/lib/core/registry";
import { MySQLAdapter } from "./database/mysql";
import { LocalFileSystemAdapter } from "./storage/local";

// Register all available adapters here
export function registerAdapters() {
    registry.register(MySQLAdapter);
    registry.register(LocalFileSystemAdapter);

    console.log("Adapters registered:", registry.getAll().map(a => a.id));
}
