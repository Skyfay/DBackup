import { DatabaseAdapter } from "@/lib/core/interfaces";
import { FirebirdSchema } from "@/lib/adapters/definitions";
import { dump } from "./dump";
import { restore } from "./restore";
import { test, ping, getDatabases, getDatabasesWithStats } from "./connection";
import { analyzeDump } from "./analyze";
import { getTables, getTableData } from "./browser";

export const FirebirdAdapter: DatabaseAdapter = {
    id: "firebird",
    type: "database",
    name: "Firebird",
    configSchema: FirebirdSchema,
    credentials: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    dump,
    restore,
    test,
    ping,
    getDatabases,
    getDatabasesWithStats,
    analyzeDump,
    getTables,
    getTableData,
};
