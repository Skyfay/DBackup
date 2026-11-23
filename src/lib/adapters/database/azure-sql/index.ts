import { DatabaseAdapter } from "@/lib/core/interfaces";
import { AzureSQLSchema } from "@/lib/adapters/definitions";
import { dump, dumpOne } from "./dump";
import { restore, restoreOne, analyzeDump } from "./restore";
import { prepareRestore } from "./preflight";
import { test, getDatabases } from "./connection";
import { getDatabasesWithStats } from "./catalog";
import { getTables, getTableData } from "./browser";

/**
 * Azure SQL Database.
 *
 * Separate from the MSSQL adapter rather than a mode on it, because almost nothing
 * is shared below the wire protocol. Azure SQL Database has no BACKUP DATABASE
 * statement, no server-scoped catalog views and no three-part names, so the backup
 * format is a BACPAC and every catalog read needs its own connection.
 *
 * No `connectionMode` in the schema, and a `transport` resolver that answers a
 * DirectHost whatever the config holds. That is the correct answer for a public
 * PaaS endpoint, and it is also what bounds the argv exception documented in
 * exporter/sqlpackage.ts. `standardTransport` would read a `connectionMode` and SSH
 * fields a stored config brings beside its schema, and put the connection string
 * on the command line of a remote shell.
 */
export const AzureSQLAdapter: DatabaseAdapter = {
    id: "azure-sql",
    type: "database",
    name: "Azure SQL Database",
    configSchema: AzureSQLSchema,
    credentials: { primary: "USERNAME_PASSWORD" },
    transport: () => ({ kind: "direct" }),
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
