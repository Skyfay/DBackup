import { DatabaseAdapter } from "@/lib/core/interfaces";
import { MariaDBSchema } from "@/lib/adapters/definitions";
// Temporary re-use of MySQL logic until Dialect-Switch is implemented in Phase 2
import { dump, dumpOne } from "../mysql/dump";
import { restore, restoreOne, prepareRestore } from "../mysql/restore";
import { test, getDatabases, getDatabasesWithStats } from "../mysql/connection";
import { getTables, getTableData } from "../mysql/browser";

export const MariaDBAdapter: DatabaseAdapter = {
    id: "mariadb",
    type: "database",
    name: "MariaDB",
    configSchema: MariaDBSchema,
    credentials: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    dump,
    dumpOne,
    restore,
    restoreOne,
    prepareRestore,
    test,
    getDatabases,
    getDatabasesWithStats,
    getTables,
    getTableData,
};
