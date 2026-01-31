import { DatabaseAdapter } from "@/lib/core/interfaces";
import { MSSQLSchema } from "@/lib/adapters/definitions";
import { dump } from "./dump";
import { restore, prepareRestore } from "./restore";
import { test, getDatabases } from "./connection";
import { analyzeDump } from "./analyze";

export const MSSQLAdapter: DatabaseAdapter = {
    id: "mssql",
    type: "database",
    name: "Microsoft SQL Server",
    configSchema: MSSQLSchema,
    dump,
    restore,
    prepareRestore,
    test,
    getDatabases,
    analyzeDump
};
