import { DatabaseAdapter } from "@/lib/core/interfaces";
import { MongoDBSchema } from "@/lib/adapters/definitions";
import { dump, dumpOne } from "./dump";
import { restore, restoreOne, prepareRestore } from "./restore";
import { test, getDatabases, getDatabasesWithStats } from "./connection";
import { analyzeDump } from "./analyze";
import { getTables, getTableData } from "./browser";

export const MongoDBAdapter: DatabaseAdapter = {
    id: "mongodb",
    type: "database",
    name: "MongoDB",
    configSchema: MongoDBSchema,
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
