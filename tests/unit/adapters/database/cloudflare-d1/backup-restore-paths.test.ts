import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareD1Adapter } from "@/lib/adapters/database/cloudflare-d1";
import { DB_ID, DUMP, NEW_ID, R2_URL, config, fakeCloudflare, importing, listing, ok, refused, type Answer, type Call } from "./fake-cloudflare";

const host = {} as never;

let dir: string;
let dumpPath: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "d1-paths-"));
    dumpPath = path.join(dir, "dump.sql");
    fs.writeFileSync(dumpPath, DUMP);
});
afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
});

const target = () => path.join(dir, `${Math.random().toString(36).slice(2)}.sql`);

describe("a backup that does not go as planned", () => {
    /** The database shop, whose export answers `exportAnswer` per poll and whose dump R2 serves by `download`. */
    function exporting(exportAnswer: (poll: number) => Answer, download: () => Answer = () => ({ text: DUMP })) {
        let polls = 0;
        return fakeCloudflare((call) => {
            if (call.url === R2_URL) return download();
            if (call.path.endsWith("/export")) return exportAnswer(++polls);
            return listing({ shop: DB_ID })(call);
        });
    }
    const complete = () => ok({ status: "complete", result: { signed_url: R2_URL } });

    it("fails on an export that came back empty, rather than storing an empty backup", async () => {
        exporting(complete, () => ({ text: "" }));
        await expect(CloudflareD1Adapter.dumpOne!(config, "shop", target(), host)).rejects.toThrow(/export of shop is empty/);
    });

    it("fails when R2 refuses the download of the export", async () => {
        exporting(complete, () => ({ status: 403, text: "AccessDenied" }));
        await expect(CloudflareD1Adapter.dumpOne!(config, "shop", target(), host)).rejects.toThrow(/Downloading the export from abc123\.r2\.cloudflarestorage\.com failed with 403/);
    });

    it("fails an export that Cloudflare reports running but gives no bookmark to poll", async () => {
        exporting(() => ok({ status: "active" }));
        await expect(CloudflareD1Adapter.dumpOne!(config, "shop", target(), host)).rejects.toThrow(/status "active" and no bookmark to poll/);
    });

    it("passes on why Cloudflare failed an export", async () => {
        exporting(() => ok({ status: "error", error: "storage unavailable" }));
        await expect(CloudflareD1Adapter.dumpOne!(config, "shop", target(), host)).rejects.toThrow("The export failed: storage unavailable");
    });

    it("does not poll again when Cloudflare refuses a poll, since only a failure on the way is worth another try", async () => {
        const fake = exporting((poll) => (poll === 1 ? ok({ status: "active", at_bookmark: "bm" }) : refused(400, 7400, "bookmark unknown")));
        await expect(CloudflareD1Adapter.dumpOne!(config, "shop", target(), host)).rejects.toThrow(/bookmark unknown/);
        expect(fake.calls.filter((call) => call.path.endsWith("/export"))).toHaveLength(2);
    });

    it("reads no table before the export when the connection turns the check off", async () => {
        const fake = exporting(complete);
        await CloudflareD1Adapter.dumpOne!({ ...config, checkValues: false }, "shop", target(), host);
        expect(fake.calls.some((call) => call.path.endsWith("/query"))).toBe(false);
    });

    it("still answers the dump of earlier versions for a job of one database, and refuses one of several", async () => {
        exporting(complete);
        expect(await CloudflareD1Adapter.dump({ ...config, database: "shop" }, target(), host)).toMatchObject({ success: true, size: Buffer.byteLength(DUMP) });
        expect(await CloudflareD1Adapter.dump({ ...config, database: "shop,other" }, target(), host))
            .toMatchObject({ success: false, error: expect.stringMatching(/exactly one database/) });
    });
});

describe("where a restore puts a new database", () => {
    function creating(names: Record<string, string>, jurisdiction?: string) {
        return fakeCloudflare((call) => {
            if (call.method === "POST" && call.path === "/d1/database") return ok({ uuid: NEW_ID, name: "copy" });
            return importing(NEW_ID)(call) ?? listing(names, jurisdiction)(call);
        });
    }
    const created = (calls: Call[]) => calls.find((call) => call.method === "POST" && call.path === "/d1/database")?.body;

    it("puts it into the jurisdiction the connection names", async () => {
        const { calls } = creating({});
        await CloudflareD1Adapter.restoreOne!({ ...config, newDatabaseLocation: "eu" }, dumpPath, "copy", host);
        expect(created(calls)).toEqual({ name: "copy", jurisdiction: "eu" });
    });

    it("lets Cloudflare pick when the original has no jurisdiction", async () => {
        const { calls } = creating({ shop: DB_ID });
        await CloudflareD1Adapter.restoreOne!(config, dumpPath, "copy", host, undefined, undefined, "shop");
        expect(created(calls)).toEqual({ name: "copy" });
    });

    it("lets Cloudflare pick when the original is gone from the account", async () => {
        const { calls } = creating({});
        await CloudflareD1Adapter.restoreOne!(config, dumpPath, "copy", host, undefined, undefined, "shop");
        expect(created(calls)).toEqual({ name: "copy" });
    });

    it("throws why the import failed, also when the empty database cannot be deleted again", async () => {
        fakeCloudflare((call) => {
            if (call.method === "POST" && call.path === "/d1/database") return ok({ uuid: NEW_ID, name: "copy" });
            if (call.method === "DELETE") return refused(500, 0, "try later");
            return importing(NEW_ID, { status: "error", error: "syntax error" })(call) ?? listing({})(call);
        });
        await expect(CloudflareD1Adapter.restoreOne!(config, dumpPath, "copy", host)).rejects.toThrow(/left as it was: syntax error/);
    });

    it("keeps the database when Cloudflare answers the import as running without a bookmark to follow", async () => {
        const { calls } = fakeCloudflare((call) => {
            if (call.method === "POST" && call.path === "/d1/database") return ok({ uuid: NEW_ID, name: "copy" });
            if (call.method === "DELETE") return ok(null);
            return importing(NEW_ID, { status: "active" })(call) ?? listing({})(call);
        });
        await expect(CloudflareD1Adapter.restoreOne!(config, dumpPath, "copy", host)).rejects.toThrow(/may still finish it/);
        expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    });

    it("explains a statement over 100 KB, which D1 cannot import", async () => {
        fakeCloudflare((call) => {
            if (call.method === "POST" && call.path === "/d1/database") return ok({ uuid: NEW_ID, name: "copy" });
            if (call.method === "DELETE") return ok(null);
            return importing(NEW_ID, { status: "error", error: "statement too long: SQLITE_TOOBIG" })(call) ?? listing({})(call);
        });
        await expect(CloudflareD1Adapter.restoreOne!(config, dumpPath, "copy", host)).rejects.toThrow(/D1 takes no statement over 100 KB/);
    });
});

describe("a restore over an existing database", () => {
    /** The database shop holding `objects`, with `extra` answering first. */
    function replacing(objects: { type: string; name: string; sql: string }[], extra?: (call: Call) => Answer | undefined) {
        return fakeCloudflare((call) => {
            const answer = extra?.(call);
            if (answer) return answer;
            if (call.path.endsWith("/time_travel/bookmark")) return ok({ bookmark: "bm" });
            if (call.path.endsWith("/query")) return ok([{ success: true, results: objects }]);
            return importing(DB_ID)(call) ?? listing({ shop: DB_ID })(call);
        });
    }

    it("drops a virtual table after the views and before the tables, which takes its shadow tables along", async () => {
        const { calls } = replacing([
            { type: "table", name: "notes_fts_data", sql: "CREATE TABLE 'notes_fts_data'(id INTEGER PRIMARY KEY, block BLOB)" },
            { type: "table", name: "notes_fts", sql: "CREATE VIRTUAL TABLE notes_fts USING fts5(body)" },
            { type: "view", name: "recent", sql: "CREATE VIEW recent AS SELECT 1" },
        ]);
        await CloudflareD1Adapter.restoreOne!(config, dumpPath, "shop", host);
        const uploaded = calls.find((call) => call.method === "PUT")?.uploaded ?? "";
        const order = ['DROP VIEW IF EXISTS "recent"', 'DROP TABLE IF EXISTS "notes_fts";', 'DROP TABLE IF EXISTS "notes_fts_data"'].map((line) => uploaded.indexOf(line));
        expect(order.every((at) => at >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it("still restores when Cloudflare answers no Time Travel bookmark", async () => {
        replacing([], (call) => (call.path.endsWith("/time_travel/bookmark") ? refused(404, 0, "not found") : undefined));
        await expect(CloudflareD1Adapter.restoreOne!(config, dumpPath, "shop", host)).resolves.toBeUndefined();
    });

    it("succeeds when only dropping the check table fails, which a person can do by hand", async () => {
        replacing([], (call) => ((call.body as { sql?: string } | undefined)?.sql?.startsWith('DROP TABLE IF EXISTS "_dbackup_restore_') ? refused(500, 0, "busy") : undefined));
        await expect(CloudflareD1Adapter.restoreOne!(config, dumpPath, "shop", host)).resolves.toBeUndefined();
    });

    it("fails when R2 refuses the upload of the dump, before Cloudflare imports anything", async () => {
        const { calls } = replacing([], (call) => (call.method === "PUT" ? { status: 500, text: "InternalError" } : undefined));
        await expect(CloudflareD1Adapter.restoreOne!(config, dumpPath, "shop", host)).rejects.toThrow(/Uploading the dump to abc\.r2\.cloudflarestorage\.com failed with 500/);
        expect(calls.some((call) => (call.body as { action?: string } | undefined)?.action === "ingest")).toBe(false);
    });
});

describe("before and around a restore", () => {
    it("checks before it starts that the token reaches the account", async () => {
        fakeCloudflare(() => refused(401, 10000, "Authentication error"));
        await expect(CloudflareD1Adapter.prepareRestore!(config, ["shop"], host)).rejects.toThrow(/refused the API token/);
    });

    it("still restores a single dump through the restore of earlier versions, into the database the mapping picks", async () => {
        const { calls } = fakeCloudflare((call) => {
            if (call.method === "POST" && call.path === "/d1/database") return ok({ uuid: NEW_ID, name: "copy" });
            return importing(NEW_ID)(call) ?? listing({ shop: DB_ID })(call);
        });
        const databaseMapping = [{ originalName: "shop", targetName: "copy", selected: true }];
        expect(await CloudflareD1Adapter.restore({ ...config, databaseMapping }, dumpPath, host)).toMatchObject({ success: true });
        expect(calls.find((call) => call.method === "POST" && call.path === "/d1/database")?.body).toMatchObject({ name: "copy" });
    });

    it("answers a restore of earlier versions without a target as failed, instead of guessing one", async () => {
        fakeCloudflare(() => ok([]));
        expect(await CloudflareD1Adapter.restore(config, dumpPath, host)).toMatchObject({ success: false, error: expect.stringMatching(/No target database/) });
    });
});
