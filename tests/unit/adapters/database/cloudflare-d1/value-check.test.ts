import { afterEach, describe, expect, it, vi } from "vitest";
import { findRiskyValues, warnAboutRiskyValues } from "@/lib/adapters/database/cloudflare-d1/value-check";
import { DB_ID, config, fakeCloudflare, ok, refused, type Call } from "./fake-cloudflare";

afterEach(() => vi.unstubAllGlobals());

/** A database whose tables, columns and counts the test names. */
function database(tables: Record<string, string[]>, counts: Record<string, Record<string, number | null>>) {
    return fakeCloudflare((call: Call) => {
        const { sql, params } = call.body as { sql: string; params?: unknown[] };
        if (sql.startsWith("SELECT name FROM sqlite_master")) return ok([{ success: true, results: Object.keys(tables).map((name) => ({ name })) }]);
        if (sql.includes("pragma_table_info")) return ok([{ success: true, results: (tables[String(params?.[0])] ?? []).map((name) => ({ name })) }]);
        const table = Object.keys(tables).find((name) => sql.endsWith(`FROM "${name}"`));
        return ok([{ success: true, results: [counts[table ?? ""] ?? {}] }]);
    });
}

describe("the check of the values before a backup", () => {
    it("names each column with integers the export rounds or values too long for the import", async () => {
        database(
            { users: ["id", "discord_id", "bio"], files: ["id", "content"] },
            { users: { i0: 0, l0: 0, i1: 3, l1: 0, i2: 0, l2: null }, files: { i0: 0, l0: 0, i1: 0, l1: 2 } },
        );
        expect(await findRiskyValues(config, DB_ID)).toEqual([
            { table: "users", column: "discord_id", largeIntegers: 3, longValues: 0 },
            { table: "files", column: "content", largeIntegers: 0, longValues: 2 },
        ]);
    });

    it("reads each table once, with both counts for every column, and quotes every name", async () => {
        const { calls } = database({ 'odd "name"': ["a b"] }, {});
        await findRiskyValues(config, DB_ID);
        const scans = calls.map((call) => (call.body as { sql: string }).sql).filter((sql) => sql.startsWith("SELECT SUM("));
        expect(scans).toHaveLength(1);
        expect(scans[0]).toContain(`typeof("a b") = 'integer'`);
        expect(scans[0]).toContain(`length(CAST("a b" AS BLOB)) > 95000`);
        expect(scans[0]).toContain(`length("a b") > 47500`);
        expect(scans[0]).toMatch(/FROM "odd ""name"""$/);
    });

    it("skips a table without columns it can read, instead of sending an empty SELECT", async () => {
        const { calls } = database({ empty: [] }, {});
        expect(await findRiskyValues(config, DB_ID)).toEqual([]);
        expect(calls.some((call) => (call.body as { sql: string }).sql.startsWith("SELECT SUM("))).toBe(false);
    });

    it("never fails the backup when the check itself fails", async () => {
        fakeCloudflare(() => refused(500, 7500, "internal error"));
        await expect(warnAboutRiskyValues(config, DB_ID, "shop", () => undefined)).resolves.toBeUndefined();
    });
});
