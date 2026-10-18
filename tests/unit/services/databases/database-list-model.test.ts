import { describe, expect, it } from "vitest";
import { pageOfDatabases, statesOf } from "@/services/databases/database-list-model";
import type { ExplorerDatabase, ServerBrief } from "@/services/databases/database-explorer-types";

const server = (id: string, name: string, adapterId = "postgres", extra: Partial<ServerBrief> = {}): ServerBrief => ({
    id, name, adapterId, tenantId: "acme", status: "ONLINE", readAt: "2026-10-18T06:00:00.000Z", readError: null, ...extra,
});

const database = (serverId: string, name: string, extra: Partial<ExplorerDatabase> = {}): ExplorerDatabase => ({
    key: `${serverId}/${name}`, serverId, tenantId: "acme", kind: "database", name, sizeInBytes: null, tableCount: null, keyCount: null,
    logical: [], emptyLogical: 0, jobIds: [], lastBackup: null, ...extra,
});

const backup = (at: string) => ({ at, jobId: "nightly", executionId: `run-${at}`, size: 10, status: "Success" as const });

const servers = [
    server("s1", "Shop cluster"),
    server("s2", "ERP", "mssql", { tenantId: "globex" }),
    server("s3", "Old box", "mysql", { readAt: null }),
];
// In the order the servers list them, the order every tie keeps.
const databases = [
    database("s1", "shop", { sizeInBytes: 2_000, tableCount: 40, jobIds: ["nightly"], lastBackup: backup("2026-10-17T03:00:00Z") }),
    database("s1", "analytics", { sizeInBytes: 9_000, tableCount: 120 }),
    database("s1", "shop_archive", { sizeInBytes: 2_000, jobIds: ["nightly", "weekly"] }),
    database("s2", "erp", { tenantId: "globex", sizeInBytes: 5_000, jobIds: ["erp"], lastBackup: backup("2026-10-18T03:00:00Z") }),
    database("s3", "legacy", { tableCount: 3 }),
];

const page = (query: Parameters<typeof pageOfDatabases>[3], byTenant = false) => pageOfDatabases(databases, servers, true, query, byTenant);
const names = (result: { rows: ExplorerDatabase[] }) => result.rows.map((row) => row.name);

describe("a page of the Databases tab", () => {
    it("starts with the biggest, keeps the order of the servers for a tie and puts the unsized last", () => {
        expect(names(page({}))).toEqual(["analytics", "erp", "shop", "shop_archive", "legacy"]);
        expect(names(page({ sort: "size", desc: false }))).toEqual(["legacy", "shop", "shop_archive", "erp", "analytics"]);
    });

    it("sorts by name, server, tables and the last backup when asked", () => {
        expect(names(page({ sort: "database", desc: false }))).toEqual(["analytics", "erp", "legacy", "shop", "shop_archive"]);
        expect(names(page({ sort: "server", desc: false }))[0]).toBe("erp");
        expect(names(page({ sort: "tables" }))).toEqual(["analytics", "shop", "legacy", "shop_archive", "erp"]);
        expect(names(page({ sort: "last" })).slice(0, 2)).toEqual(["erp", "shop"]);
    });

    it("cuts one page and counts every database the search and the filters leave", () => {
        const second = page({ page: 2, pageSize: 2 });
        expect(names(second)).toEqual(["shop", "shop_archive"]);
        expect(second.total).toBe(5);
        expect(page({ page: 9, pageSize: 2 }).rows).toEqual([]);
    });

    it("finds a database by a part of its name in any case", () => {
        const result = page({ search: "SHOP" });
        expect(names(result)).toEqual(["shop", "shop_archive"]);
        expect(result.total).toBe(2);
    });

    it("counts each value of a filter under the other filters and the search, a database once for each of its jobs and states", () => {
        const { facets, total } = page({ engines: ["postgres"], states: ["backed-up"] });
        expect(total).toBe(2);
        // The engine counts under the state filter, the state under the engine filter.
        expect(facets.engine).toEqual({ postgres: 2, mssql: 1 });
        expect(facets.state).toEqual({ "backed-up": 2, "no-job": 1, never: 1 });
        expect(facets.job).toEqual({ nightly: 2, weekly: 1 });
        expect(facets.server).toEqual({ s1: 2 });
        expect(facets.tenant).toBeUndefined();
    });

    it("narrows to the jobs, the databases in no job and the servers not read", () => {
        expect(names(page({ jobIds: ["weekly"] }))).toEqual(["shop_archive"]);
        expect(names(page({ jobIds: ["none"] }))).toEqual(["analytics", "legacy"]);
        expect(names(page({ states: ["unread"] }))).toEqual(["legacy"]);
        expect(names(page({ states: ["never"] }))).toEqual(["shop_archive"]);
        expect(names(page({ serverIds: ["s2", "s3"] }))).toEqual(["erp", "legacy"]);
    });

    it("counts and narrows by tenant only in All tenants", () => {
        const all = page({ tenantIds: ["globex"] }, true);
        expect(names(all)).toEqual(["erp"]);
        expect(all.facets.tenant).toEqual({ acme: 4, globex: 1 });
        // Inside a tenant every database is of that tenant anyway.
        expect(page({ tenantIds: ["globex"] }).total).toBe(5);
    });

    it("leaves the jobs and their states out for a viewer who may not see jobs", () => {
        const result = pageOfDatabases(databases, servers, false, { jobIds: ["weekly"], states: ["unread"] });
        expect(names(result)).toEqual(["legacy"]);
        expect(result.facets.job).toEqual({});
        expect(result.facets.state).toEqual({ unread: 1 });
        expect(statesOf(databases[0], servers[0], false)).toEqual([]);
    });
});
