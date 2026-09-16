import { DatabaseAdapter } from "@/lib/core/interfaces";
import { MSSQLSchema } from "@/lib/adapters/definitions";
import { mssqlTransport } from "./transport";
import { dump } from "./dump";
import { restore, prepareRestore } from "./restore";
import { dumpOne } from "./dump-one";
import { restoreOne } from "./restore-bak";
import { test, getDatabases, getDatabasesWithStats } from "./connection";
import { analyzeDump } from "./analyze";
import { getTables, getTableData } from "./browser";

export const MSSQLAdapter: DatabaseAdapter = {
    id: "mssql",
    type: "database",
    name: "Microsoft SQL Server",
    configSchema: MSSQLSchema,
    credentials: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    // MSSQL has two settings: connectionMode for commands and TDS, plus the
    // older fileTransferMode for how the .bak file travels.
    transport: mssqlTransport,
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
