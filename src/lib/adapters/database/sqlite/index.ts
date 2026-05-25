import { DatabaseAdapter } from "@/lib/core/interfaces";
import { SQLiteSchema } from "@/lib/adapters/definitions";
import { dump } from "./dump";
import { restore, prepareRestore } from "./restore";
import { test, getDatabases, getDatabasesWithStats } from "./connection";
import { getTables, getTableData } from "./browser";

export const SQLiteAdapter: DatabaseAdapter = {
    id: "sqlite",
    type: "database",
    name: "SQLite",
    configSchema: SQLiteSchema,
    credentials: { ssh: "SSH_KEY" },
    dump,
    restore,
    prepareRestore,
    test,
    getDatabases,
    getDatabasesWithStats,
    getTables,
    getTableData,
};
