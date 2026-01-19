import { DatabaseAdapter } from "@/lib/core/interfaces";
import { MariaDBSchema } from "@/lib/adapters/definitions";
// Temporary re-use of MySQL logic until Dialect-Switch is implemented in Phase 2
import { dump } from "../mysql/dump";
import { restore, prepareRestore } from "../mysql/restore";
import { test, getDatabases } from "../mysql/connection";

export const MariaDBAdapter: DatabaseAdapter = {
    id: "mariadb",
    type: "database",
    name: "MariaDB",
    configSchema: MariaDBSchema,
    dump,
    restore,
    prepareRestore,
    test,
    getDatabases
};
