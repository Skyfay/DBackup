import { vi } from "vitest";
import type { DatabaseOverview, DatabaseRuns, ExplorerDatabase } from "@/services/databases/database-explorer-types";

const HOUR = 3_600_000;
export const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

const database = (entry: Pick<ExplorerDatabase, "key" | "serverId" | "name" | "sizeInBytes" | "tableCount" | "jobIds" | "lastBackup">): ExplorerDatabase => ({
    kind: "database", keyCount: null, logical: [], emptyLogical: 0, ...entry,
});

export const overview: DatabaseOverview = {
    coverage: true,
    servers: [
        { id: "s1", name: "Shop cluster", adapterId: "postgres", version: "16.4", versionSince: ago(240), previousVersion: "16.2", status: "ONLINE", readAt: ago(0.1), readError: null },
        { id: "s2", name: "ERP", adapterId: "mssql", version: "16.0.4135", versionSince: null, previousVersion: null, status: "ONLINE", readAt: ago(0.1), readError: null },
        { id: "s3", name: "Cache", adapterId: "redis", version: "7.2.5", versionSince: null, previousVersion: null, status: "ONLINE", readAt: ago(0.1), readError: null },
    ],
    jobs: [
        { id: "nightly", name: "Shop nightly", serverId: "s1", enabled: true, databases: ["shop"], schedule: "0 3 * * *" },
        { id: "erp-nightly", name: "ERP nightly", serverId: "s2", enabled: true, databases: null, schedule: "30 4 * * *" },
        { id: "cache-daily", name: "Cache daily", serverId: "s3", enabled: true, databases: null, schedule: "0 21 * * *" },
    ],
    databases: [
        database({ key: "s1/shop", serverId: "s1", name: "shop", sizeInBytes: 2_100_000_000, tableCount: 46, jobIds: ["nightly"], lastBackup: { at: ago(6), jobId: "nightly", executionId: "r1", size: 104_000_000, status: "Success" } }),
        database({ key: "s1/analytics", serverId: "s1", name: "analytics", sizeInBytes: 12_400_000_000, tableCount: 130, jobIds: [], lastBackup: null }),
        database({ key: "s2/erp", serverId: "s2", name: "erp", sizeInBytes: null, tableCount: null, jobIds: ["erp-nightly"], lastBackup: null }),
        {
            key: "s3", serverId: "s3", kind: "instance", name: "Cache", sizeInBytes: null, tableCount: null, keyCount: 184_344,
            logical: [{ name: "0", keys: 184_332 }, { name: "3", keys: 12 }], emptyLogical: 14, jobIds: ["cache-daily"], lastBackup: null,
        },
    ],
};

const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
export const fetchMock = vi.fn();

/** Answers the routes of the Database Explorer, the tables and rows of a server included. */
export function serve({ data = overview, runs, tables }: { data?: DatabaseOverview; runs?: DatabaseRuns; tables?: unknown } = {}) {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/databases") return json({ success: true, data });
        if (url === "/api/databases/read") return json({ success: true, data });
        if (url.startsWith("/api/databases/runs")) return json({ success: true, data: runs ?? { runs: [], versionChanges: [], planned: [] } });
        if (url === "/api/adapters/database-tables") {
            return json(tables ?? { success: true, tables: [{ name: "orders", rowCount: 1204332, sizeInBytes: 820_000_000 }, { name: "coupons", rowCount: 1210, sizeInBytes: 1_000_000 }] });
        }
        if (url === "/api/adapters/database-table-data") {
            const body = JSON.parse(String(init?.body ?? "{}"));
            if (body.table === "Keys") {
                const keys = body.search ? ["session:1", "session:2"] : ["session:1", "session:2", "cart:1"];
                return json({
                    success: true,
                    totalCount: body.search ? keys.length : 184_332,
                    columns: [{ name: "key", dataType: "string" }, { name: "type", dataType: "string" }, { name: "ttl", dataType: "integer" }],
                    rows: keys.map((key) => ({ key, type: "hash", ttl: "no expiry" })),
                });
            }
            return json({ success: true, totalCount: 2, columns: [{ name: "id", dataType: "bigint", primaryKey: true }, { name: "status", dataType: "text" }], rows: [{ id: 1, status: body.sortBy ? "shipped" : "paid" }, { id: 2, status: null }] });
        }
        return json({ success: false, error: `Unexpected ${url}` });
    });
    vi.stubGlobal("fetch", fetchMock);
}

/** The bodies posted to a route, oldest first. */
export const posted = (url: string) => fetchMock.mock.calls.filter(([called]) => called === url).map(([, init]) => JSON.parse(String(init?.body ?? "{}")));
