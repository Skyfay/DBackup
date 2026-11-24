import { DatabaseAdapter } from "@/lib/core/interfaces";
import { CloudflareD1Schema } from "@/lib/adapters/definitions";
import { test, ping, getDatabases, getDatabasesWithStats } from "./connection";
import { dump, dumpOne } from "./dump";
import { restore, restoreOne, prepareRestore } from "./restore";
import { getTables, getTableData } from "./browser";

/**
 * Cloudflare D1, through its REST API alone.
 *
 * No binary and no SSH: the export and import of Cloudflare do the work, this adapter starts and
 * polls them and moves the dump. The connection is a Cloudflare account, its token comes from a
 * credential profile of the type Token, and a job picks D1 databases of that account by name.
 *
 * The transport answers a DirectHost whatever the config holds, since nothing here runs on a host.
 */
export const CloudflareD1Adapter: DatabaseAdapter = {
    id: "cloudflare-d1",
    type: "database",
    name: "Cloudflare D1",
    configSchema: CloudflareD1Schema,
    credentials: { primary: "TOKEN" },
    transport: () => ({ kind: "direct" }),
    dump,
    dumpOne,
    restore,
    restoreOne,
    prepareRestore,
    test,
    ping,
    getDatabases,
    getDatabasesWithStats,
    getTables,
    getTableData,
};
