import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareD1Adapter } from "@/lib/adapters/database/cloudflare-d1";
import { DB_ID, NEW_ID, R2_URL, config, fakeCloudflare, ok, refused, type Call } from "./fake-cloudflare";

const host = {} as never;
const DUMP = "PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE t (id INTEGER PRIMARY KEY);\nINSERT INTO \"t\" VALUES(1);\n";
const md5 = (text: string) => createHash("md5").update(text).digest("hex");

let dir: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "d1-test-"));
});
afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
});

/** The list of databases the account answers. */
const listing = (names: Record<string, string>, jurisdiction?: string) => (call: Call) =>
    call.method === "GET" && call.path.startsWith("/d1/database?")
        ? ok(Object.entries(names).map(([name, uuid]) => ({ name, uuid, jurisdiction: jurisdiction ?? null })))
        : undefined;

describe("a backup of a D1 database", () => {
    it("exports by polling until Cloudflare is done and stores its dump unchanged", async () => {
        let polls = 0;
        const { calls } = fakeCloudflare((call) => {
            if (call.url === R2_URL) return { text: DUMP };
            if (call.path === `/d1/database/${DB_ID}/export`) {
                polls++;
                return polls === 1 ? ok({ status: "active", at_bookmark: "bm-1" }) : ok({ status: "complete", result: { signed_url: R2_URL } });
            }
            return listing({ shop: DB_ID })(call);
        });

        const target = path.join(dir, "dump.sql");
        const { size } = await CloudflareD1Adapter.dumpOne!(config, "shop", target, host);

        expect(fs.readFileSync(target, "utf8")).toBe(DUMP);
        expect(size).toBe(Buffer.byteLength(DUMP));
        const exports = calls.filter((call) => call.path.endsWith("/export"));
        expect(exports.map((call) => call.body)).toEqual([
            { output_format: "polling" },
            { output_format: "polling", current_bookmark: "bm-1" },
        ]);
    });

    it("names the missing permission when the token may read but not export", async () => {
        fakeCloudflare((call) => (call.path.endsWith("/export") ? refused(401, 10000, "Authentication error") : listing({ shop: DB_ID })(call)));
        await expect(CloudflareD1Adapter.dumpOne!(config, "shop", path.join(dir, "d.sql"), host)).rejects.toThrow(/needs the permission D1 Edit/);
    });

    it("explains a database with an FTS5 table, which Cloudflare cannot export", async () => {
        fakeCloudflare((call) =>
            call.path.endsWith("/export")
                ? ok({ status: "error", error: "D1 Export error: cannot export databases with virtual tables (like FTS5)" })
                : listing({ shop: DB_ID })(call));
        await expect(CloudflareD1Adapter.dumpOne!(config, "shop", path.join(dir, "d.sql"), host)).rejects.toThrow(/Drop the virtual tables before the backup/);
    });

    it("refuses a download URL that is not on R2", async () => {
        fakeCloudflare((call) =>
            call.path.endsWith("/export")
                ? ok({ status: "complete", result: { signed_url: "https://attacker.example/x.sql" } })
                : listing({ shop: DB_ID })(call));
        await expect(CloudflareD1Adapter.dumpOne!(config, "shop", path.join(dir, "d.sql"), host)).rejects.toThrow(/not R2/);
    });

    it("fails for a database the account does not have", async () => {
        fakeCloudflare(listing({ other: DB_ID }));
        await expect(CloudflareD1Adapter.dumpOne!(config, "shop", path.join(dir, "d.sql"), host)).rejects.toThrow(/no D1 database named "shop"/);
    });

    it("checks for large integers first when the connection asks for it, and backs up anyway", async () => {
        const { calls } = fakeCloudflare((call) => {
            if (call.url === R2_URL) return { text: DUMP };
            if (call.path.endsWith("/export")) return ok({ status: "complete", result: { signed_url: R2_URL } });
            if (call.path.endsWith("/query")) {
                const sql = (call.body as { sql: string }).sql;
                if (sql.startsWith("SELECT name FROM sqlite_master")) return ok([{ success: true, results: [{ name: "big" }] }]);
                if (sql.includes("pragma_table_info")) return ok([{ success: true, results: [{ name: "n" }] }]);
                return ok([{ success: true, results: [{ c0: 1 }] }]);
            }
            return listing({ shop: DB_ID })(call);
        });
        await CloudflareD1Adapter.dumpOne!({ ...config, checkLargeIntegers: true }, "shop", path.join(dir, "d.sql"), host);
        const scan = calls.find((call) => (call.body as { sql?: string })?.sql?.startsWith("SELECT SUM("));
        expect((scan?.body as { sql: string }).sql).toContain(`typeof("n") = 'integer'`);
        expect(calls.some((call) => call.path.endsWith("/export"))).toBe(true);
    });
});

/** Answers the import flow, keeping what was uploaded. */
function importing(uuid: string, outcome: Record<string, unknown> = { status: "complete", result: { num_queries: 3 } }) {
    return (call: Call) => {
        if (call.method === "PUT") return { headers: { etag: `"${md5(call.uploaded ?? "")}"` } };
        if (call.path !== `/d1/database/${uuid}/import`) return undefined;
        const action = (call.body as { action: string }).action;
        if (action === "init") return ok({ upload_url: "https://abc.r2.cloudflarestorage.com/up?sig=1", filename: "f.sql" });
        return ok(outcome);
    };
}

describe("a restore into D1", () => {
    it("replaces an existing database in one import: drops ahead of the dump, the database and its ID kept", async () => {
        const dumpPath = path.join(dir, "dump.sql");
        fs.writeFileSync(dumpPath, DUMP);
        const { calls } = fakeCloudflare((call) => {
            if (call.path.endsWith("/time_travel/bookmark")) return ok({ bookmark: "bm-before" });
            if (call.path.endsWith("/query")) {
                return ok([{ success: true, results: [
                    { type: "table", name: "orders", sql: "CREATE TABLE orders (x)" },
                    { type: "trigger", name: "touch", sql: "CREATE TRIGGER touch ..." },
                    { type: "view", name: "paid", sql: "CREATE VIEW paid AS ..." },
                ] }]);
            }
            return importing(DB_ID)(call) ?? listing({ shop: DB_ID })(call);
        });

        await CloudflareD1Adapter.restoreOne!(config, dumpPath, "shop", host);

        const uploaded = calls.find((call) => call.method === "PUT")?.uploaded ?? "";
        expect(uploaded.indexOf('DROP TRIGGER IF EXISTS "touch";')).toBeLessThan(uploaded.indexOf('DROP VIEW IF EXISTS "paid";'));
        expect(uploaded.indexOf('DROP VIEW IF EXISTS "paid";')).toBeLessThan(uploaded.indexOf('DROP TABLE IF EXISTS "orders";'));
        expect(uploaded.endsWith(DUMP)).toBe(true);
        const init = calls.find((call) => (call.body as { action?: string })?.action === "init");
        expect((init?.body as { etag: string }).etag).toBe(md5(uploaded));
        expect(calls.some((call) => call.method === "DELETE" || (call.method === "POST" && call.path === "/d1/database"))).toBe(false);
        expect(fs.readdirSync(dir)).toEqual(["dump.sql"]);
    });

    it("leaves Cloudflare's and SQLite's own tables out of the drops", async () => {
        const dumpPath = path.join(dir, "dump.sql");
        fs.writeFileSync(dumpPath, DUMP);
        const { calls } = fakeCloudflare((call) => {
            if (call.path.endsWith("/time_travel/bookmark")) return ok({ bookmark: "bm" });
            if (call.path.endsWith("/query")) return ok([{ success: true, results: [] }]);
            return importing(DB_ID)(call) ?? listing({ shop: DB_ID })(call);
        });
        await CloudflareD1Adapter.restoreOne!(config, dumpPath, "shop", host);
        const filter = (calls.find((call) => call.path.endsWith("/query"))?.body as { sql: string }).sql;
        expect(filter).toContain("NOT LIKE 'sqlite\\_%'");
        expect(filter).toContain("NOT LIKE '\\_cf\\_%'");
        // An empty database gets the dump as it is.
        expect(calls.find((call) => call.method === "PUT")?.uploaded).toBe(DUMP);
    });

    it("creates a database under a new name in the jurisdiction of the database the backup came from", async () => {
        const dumpPath = path.join(dir, "dump.sql");
        fs.writeFileSync(dumpPath, DUMP);
        const { calls } = fakeCloudflare((call) => {
            if (call.method === "POST" && call.path === "/d1/database") return ok({ uuid: NEW_ID, name: "shop-copy" });
            if (call.method === "GET" && call.path.includes("name=shop-copy")) return ok([]);
            return importing(NEW_ID)(call) ?? listing({ shop: DB_ID }, "eu")(call);
        });
        await CloudflareD1Adapter.restoreOne!(config, dumpPath, "shop-copy", host, undefined, undefined, "shop");
        expect(calls.find((call) => call.method === "POST" && call.path === "/d1/database")?.body).toEqual({ name: "shop-copy", jurisdiction: "eu" });
    });

    it("creates a new database where the connection says, as a location hint", async () => {
        const dumpPath = path.join(dir, "dump.sql");
        fs.writeFileSync(dumpPath, DUMP);
        const { calls } = fakeCloudflare((call) => {
            if (call.method === "POST" && call.path === "/d1/database") return ok({ uuid: NEW_ID, name: "copy" });
            return importing(NEW_ID)(call) ?? listing({})(call);
        });
        await CloudflareD1Adapter.restoreOne!({ ...config, newDatabaseLocation: "weur" }, dumpPath, "copy", host);
        expect(calls.find((call) => call.method === "POST" && call.path === "/d1/database")?.body).toEqual({ name: "copy", primary_location_hint: "weur" });
    });

    it("deletes a database it created when the import into it fails", async () => {
        const dumpPath = path.join(dir, "dump.sql");
        fs.writeFileSync(dumpPath, DUMP);
        const { calls } = fakeCloudflare((call) => {
            if (call.method === "POST" && call.path === "/d1/database") return ok({ uuid: NEW_ID, name: "copy" });
            if (call.method === "DELETE") return ok(null);
            return importing(NEW_ID, { status: "error", error: "syntax error" })(call) ?? listing({})(call);
        });
        await expect(CloudflareD1Adapter.restoreOne!(config, dumpPath, "copy", host)).rejects.toThrow(/left as it was: syntax error/);
        expect(calls.find((call) => call.method === "DELETE")?.path).toBe(`/d1/database/${NEW_ID}`);
    });

    it("starts the import without an upload when Cloudflare already holds the file", async () => {
        const dumpPath = path.join(dir, "dump.sql");
        fs.writeFileSync(dumpPath, DUMP);
        const { calls } = fakeCloudflare((call) => {
            if (call.path.endsWith("/time_travel/bookmark")) return ok({ bookmark: "bm" });
            if (call.path.endsWith("/query")) return ok([{ success: true, results: [] }]);
            if (call.path.endsWith("/import")) return ok({ status: "complete", result: { num_queries: 3 } });
            return listing({ shop: DB_ID })(call);
        });
        await CloudflareD1Adapter.restoreOne!(config, dumpPath, "shop", host);
        expect(calls.some((call) => call.method === "PUT")).toBe(false);
    });

    it("refuses an upload that arrived damaged", async () => {
        const dumpPath = path.join(dir, "dump.sql");
        fs.writeFileSync(dumpPath, DUMP);
        fakeCloudflare((call) => {
            if (call.method === "PUT") return { headers: { etag: '"0000"' } };
            if (call.path.endsWith("/time_travel/bookmark")) return ok({ bookmark: "bm" });
            if (call.path.endsWith("/query")) return ok([{ success: true, results: [] }]);
            return importing(DB_ID)(call) ?? listing({ shop: DB_ID })(call);
        });
        await expect(CloudflareD1Adapter.restoreOne!(config, dumpPath, "shop", host)).rejects.toThrow(/arrived damaged/);
    });
});

/** An import into a new database `copy` whose polls answer with `pollAnswer`. */
function importingNew(pollAnswer: (poll: number) => ReturnType<typeof ok>) {
    let polls = 0;
    const fake = fakeCloudflare((call) => {
        if (call.method === "PUT") return { headers: { etag: `"${md5(call.uploaded ?? "")}"` } };
        if (call.method === "POST" && call.path === "/d1/database") return ok({ uuid: NEW_ID, name: "copy" });
        if (call.path === `/d1/database/${NEW_ID}/import`) {
            const action = (call.body as { action: string }).action;
            if (action === "init") return ok({ upload_url: "https://abc.r2.cloudflarestorage.com/up?sig=1", filename: "f.sql" });
            if (action === "ingest") return ok({ status: "active", at_bookmark: "bm" });
            return pollAnswer(++polls);
        }
        return listing({})(call);
    });
    return { ...fake, polls: () => polls };
}

describe("a restore that loses track of Cloudflare", () => {
    it("polls again after a failure on the way and finishes", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1_000 });
        try {
            const dumpPath = path.join(dir, "dump.sql");
            fs.writeFileSync(dumpPath, DUMP);
            const fake = importingNew((poll) => (poll === 1 ? refused(503, 0, "unavailable") : ok({ status: "complete", result: { num_queries: 3 } })));
            await CloudflareD1Adapter.restoreOne!(config, dumpPath, "copy", host);
            expect(fake.polls()).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps a database it created when the import was handed over and the polling broke off, since Cloudflare may still finish it", async () => {
        const dumpPath = path.join(dir, "dump.sql");
        fs.writeFileSync(dumpPath, DUMP);
        const fake = importingNew(() => refused(400, 7400, "bookmark unknown"));
        await expect(CloudflareD1Adapter.restoreOne!(config, dumpPath, "copy", host)).rejects.toThrow(/may still finish it/);
        expect(fake.calls.some((call) => call.method === "DELETE")).toBe(false);
    });
});
