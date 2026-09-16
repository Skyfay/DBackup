import { DatabaseAdapter } from "@/lib/core/interfaces";
import { RedisSchema } from "@/lib/adapters/definitions";
import { dump, dumpOne, listDumpEntries } from "./dump";
import { restore, restoreOne, prepareRestore } from "./restore";
import { test, getDatabases, getDatabasesWithStats } from "./connection";
import { analyzeDump } from "./analyze";
import { getTables, getTableData } from "./browser";

export const RedisAdapter: DatabaseAdapter = {
    id: "redis",
    type: "database",
    name: "Redis",
    configSchema: RedisSchema,
    credentials: { primary: "USERNAME_PASSWORD", primaryOptional: true, ssh: "SSH_KEY" },
    dump,
    dumpOne,
    listDumpEntries,
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
