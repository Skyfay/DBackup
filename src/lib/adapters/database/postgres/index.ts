import { DatabaseAdapter } from "@/lib/core/interfaces";
import { PostgresSchema } from "@/lib/adapters/definitions";
import { dump, dumpOne } from "./dump";
import { restore, restoreOne, prepareRestore } from "./restore";
import { test, getDatabases, getDatabasesWithStats } from "./connection";
import { analyzeDump } from "./analyze";
import { getTables, getTableData } from "./browser";

export const PostgresAdapter: DatabaseAdapter = {
    id: "postgres",
    type: "database",
    name: "PostgreSQL",
    configSchema: PostgresSchema,
    credentials: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    dump,
    dumpOne,
    restore,
    restoreOne,
    prepareRestore,
    test,
    getDatabases,
    getDatabasesWithStats,
    analyzeDump,
    getTables,
    getTableData,
};
