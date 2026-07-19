import { DatabaseAdapter } from "@/lib/core/interfaces";
import { MySQLSchema } from "@/lib/adapters/definitions";
import { dump, dumpOne } from "./dump";
import { restore, restoreOne, prepareRestore } from "./restore";
import { test, getDatabases, getDatabasesWithStats } from "./connection";
import { analyzeDump } from "./analyze";
import { getTables, getTableData } from "./browser";

export const MySQLAdapter: DatabaseAdapter = {
    id: "mysql",
    type: "database",
    name: "MySQL",
    configSchema: MySQLSchema,
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
