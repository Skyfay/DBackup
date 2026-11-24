import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareD1Adapter } from "@/lib/adapters/database/cloudflare-d1";
import { DB_ID, config, fakeCloudflare, ok, type Call } from "./fake-cloudflare";

const host = {} as never;

afterEach(() => vi.unstubAllGlobals());

/** A database with one table `orders (id, note)`. */
function shop(extra?: (call: Call) => ReturnType<typeof ok> | undefined) {
    return fakeCloudflare((call) => {
        const answer = extra?.(call);
        if (answer) return answer;
        if (call.method === "GET") return ok([{ uuid: DB_ID, name: "shop" }]);
        const { sql, params } = call.body as { sql: string; params?: unknown[] };
        if (sql.includes("count(*) AS n FROM sqlite_master")) return ok([{ success: true, results: [{ n: params?.[0] === "orders" ? 1 : 0 }] }]);
        if (sql.includes("pragma_table_info")) {
            return ok([{ success: true, results: [
                { name: "id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
                { name: "note", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
            ] }]);
        }
        if (sql.startsWith("SELECT count(*) AS n FROM")) return ok([{ success: true, results: [{ n: 1 }] }]);
        if (call.path.endsWith("/raw")) return ok([{ success: true, results: { columns: ["a", "b"], rows: [["9007199254740993", "hi"]] } }]);
        return undefined;
    });
}

describe("the Database Explorer of a D1 database", () => {
    it("reads a page with the search as a parameter and maps the rows to the column names", async () => {
        const { calls } = shop();
        const page = await CloudflareD1Adapter.getTableData!(config, { database: "shop", table: "orders", page: 2, pageSize: 10, search: "x'; DROP", searchColumn: "note", sortBy: "id", sortDir: "desc" }, host);
        expect(page.rows).toEqual([{ id: "9007199254740993", note: "hi" }]);
        expect(page.totalCount).toBe(1);
        const raw = calls.find((call) => call.path.endsWith("/raw"))?.body as { sql: string; params: unknown[] };
        expect(raw.params).toEqual(["%x'; DROP%"]);
        expect(raw.sql).not.toContain("DROP");
        expect(raw.sql).toContain(`ORDER BY "id" DESC LIMIT 10 OFFSET 10`);
        // A large integer comes as text, so the page shows it exactly.
        expect(raw.sql).toContain(`CAST("id" AS TEXT)`);
    });

    it("refuses a table sqlite_master does not list, like sqlite_master itself", async () => {
        const { calls } = shop();
        await expect(CloudflareD1Adapter.getTableData!(config, { database: "shop", table: "sqlite_master", page: 1, pageSize: 10 }, host)).rejects.toThrow(/does not exist/);
        expect(calls.some((call) => call.path.endsWith("/raw"))).toBe(false);
    });

    it("refuses a sort or search column the table does not have", async () => {
        shop();
        await expect(CloudflareD1Adapter.getTableData!(config, { database: "shop", table: "orders", page: 1, pageSize: 10, sortBy: "id\" DESC; --" }, host)).rejects.toThrow(/column does not exist/);
    });

    it("caps the page size, whatever the caller asks", async () => {
        const { calls } = shop();
        await CloudflareD1Adapter.getTableData!(config, { database: "shop", table: "orders", page: 1, pageSize: 1_000_000 }, host);
        expect((calls.find((call) => call.path.endsWith("/raw"))?.body as { sql: string }).sql).toContain("LIMIT 500 OFFSET 0");
    });

    it("shows a BLOB cut to its first KB with its size, so a page stays small", async () => {
        const { calls } = shop();
        await CloudflareD1Adapter.getTableData!(config, { database: "shop", table: "orders", page: 1, pageSize: 10 }, host);
        const sql = (calls.find((call) => call.path.endsWith("/raw"))?.body as { sql: string }).sql;
        expect(sql).toContain(`hex(substr("note", 1, 1024))`);
        expect(sql).toContain(`' bytes)'`);
    });

    it("matches a search exactly, at the start or at the end, as the page asks", async () => {
        const { calls } = shop();
        for (const matchMode of ["equals", "starts", "ends"] as const) {
            await CloudflareD1Adapter.getTableData!(config, { database: "shop", table: "orders", page: 1, pageSize: 10, search: "abc", searchColumn: "note", matchMode }, host);
        }
        const searches = calls.filter((call) => call.path.endsWith("/raw")).map((call) => call.body as { sql: string; params: unknown[] });
        expect(searches.map((search) => search.params)).toEqual([["abc"], ["abc%"], ["%abc"]]);
        expect(searches[0].sql).toContain(`WHERE "note" = ?`);
        expect(searches[1].sql).toContain(`WHERE "note" LIKE ?`);
    });
});

describe("the tables of a D1 database", () => {
    /** A database with the objects given, whose counts answer `counts`. */
    function objects(list: { name: string; type: string }[], counts: () => ReturnType<typeof ok>) {
        return fakeCloudflare((call) => {
            if (call.method === "GET") return ok([{ uuid: DB_ID, name: "shop" }]);
            const { sql } = call.body as { sql: string };
            if (sql.startsWith("SELECT name, type FROM sqlite_master")) return ok([{ success: true, results: list }]);
            if (sql.includes("UNION ALL") || sql.startsWith("SELECT count(*) AS n FROM")) return counts();
            return undefined;
        });
    }

    it("lists tables with their rows and views without, leaving out what belongs to SQLite and Cloudflare", async () => {
        const { calls } = objects(
            [{ name: "customers", type: "table" }, { name: "open_orders", type: "view" }, { name: "orders", type: "table" }],
            () => ok([{ success: true, results: [{ n: 3 }, { n: 7 }] }]),
        );
        expect(await CloudflareD1Adapter.getTables!(config, "shop", host)).toEqual([
            { name: "customers", type: "table", rowCount: 3 },
            { name: "open_orders", type: "view" },
            { name: "orders", type: "table", rowCount: 7 },
        ]);
        const listed = (calls.find((call) => (call.body as { sql?: string } | undefined)?.sql?.startsWith("SELECT name, type"))?.body as { sql: string }).sql;
        expect(listed).toContain("NOT LIKE 'sqlite\\_%'");
        expect(listed).toContain("NOT LIKE '\\_cf\\_%'");
    });

    it("still lists the tables when counting their rows fails, like on a virtual table", async () => {
        objects([{ name: "notes_fts", type: "table" }], () => ({ status: 400, json: { success: false, errors: [{ code: 7500, message: "no such module: fts5" }] } }));
        expect(await CloudflareD1Adapter.getTables!(config, "shop", host)).toEqual([{ name: "notes_fts", type: "table" }]);
    });

    it("asks for no counts in a database of views only", async () => {
        const { calls } = objects([{ name: "v", type: "view" }], () => ok([]));
        expect(await CloudflareD1Adapter.getTables!(config, "shop", host)).toEqual([{ name: "v", type: "view" }]);
        expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    });
});
