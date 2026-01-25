import { DatabaseAdapter } from "@/lib/core/interfaces";
import { SQLiteSchema } from "@/lib/adapters/definitions";
import { dump } from "./dump";
import { restore, prepareRestore } from "./restore";
import { test, getDatabases } from "./connection";

export const SQLiteAdapter: DatabaseAdapter = {
    id: "sqlite",
    type: "database",
    name: "SQLite",
    configSchema: SQLiteSchema,
    dump,
    restore,
    prepareRestore,
    test,
    getDatabases
};
