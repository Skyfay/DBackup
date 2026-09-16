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
 * No `transport` resolver and no `connectionMode` in the schema, which is what
 * makes `standardTransport` resolve to a DirectHost. That is the correct answer for
 * a public PaaS endpoint, and it is also what bounds the argv exception documented
 * in exporter/sqlpackage.ts.
 */
export const AzureSQLAdapter: DatabaseAdapter = {
    id: "azure-sql",
    type: "database",
    name: "Azure SQL Database",
    configSchema: AzureSQLSchema,
    credentials: { primary: "USERNAME_PASSWORD" },
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
