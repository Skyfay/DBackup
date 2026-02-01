import { DatabaseAdapter } from "@/lib/core/interfaces";
import { MongoDBSchema } from "@/lib/adapters/definitions";
import { dump } from "./dump";
import { restore, prepareRestore } from "./restore";
import { test, getDatabases } from "./connection";
import { analyzeDump } from "./analyze";

export const MongoDBAdapter: DatabaseAdapter = {
    id: "mongodb",
    type: "database",
    name: "MongoDB",
    configSchema: MongoDBSchema,
    dump,
    restore,
    prepareRestore,
    test,
    getDatabases,
    analyzeDump
};
