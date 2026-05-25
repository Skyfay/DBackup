import { DatabaseAdapter } from "@/lib/core/interfaces";
import { MSSQLSchema } from "@/lib/adapters/definitions";
import { dump } from "./dump";
import { restore, prepareRestore } from "./restore";
import { test, getDatabases, getDatabasesWithStats } from "./connection";
import { analyzeDump } from "./analyze";
import { getTables, getTableData } from "./browser";

export const MSSQLAdapter: DatabaseAdapter = {
    id: "mssql",
    type: "database",
    name: "Microsoft SQL Server",
    configSchema: MSSQLSchema,
    credentials: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    dump,
    restore,
    prepareRestore,
    test,
    getDatabases,
    getDatabasesWithStats,
    analyzeDump,
    getTables,
    getTableData,
};
