import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseIdOf, findDatabase, isPermissionRefusal, listDatabases, rawQuery } from "@/lib/adapters/database/cloudflare-d1/api";
import { CloudflareD1Adapter } from "@/lib/adapters/database/cloudflare-d1";
import { DB_ID, config, fakeCloudflare, ok, refused } from "./fake-cloudflare";

const host = {} as never;

afterEach(() => vi.unstubAllGlobals());

/** `fetch` replaced by a function that throws or answers as given. */
function stubFetch(answer: () => Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(answer));
}

describe("a Cloudflare API that does not answer as expected", () => {
    it("says the API did not answer in time, without anything of the request", async () => {
        stubFetch(async () => {
            throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
        });
        await expect(listDatabases(config)).rejects.toThrow("The Cloudflare API did not answer in time.");
    });

    it("says the API could not be reached when the network fails", async () => {
        stubFetch(async () => {
            throw new TypeError("fetch failed");
        });
        await expect(listDatabases(config)).rejects.toThrow("The Cloudflare API could not be reached.");
    });

    it("names the status of an answer that is no JSON, like the HTML page of a gateway error", async () => {
        stubFetch(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
        const error = await listDatabases(config).catch((e: Error) => e);
        expect((error as Error).message).toMatch(/Cloudflare answered 502\.$/);
        // A server error is worth another try, a refusal is not.
        expect(isPermissionRefusal(error)).toBe(false);
    });

    it("stops reading an answer larger than the call allows, during the transfer", async () => {
        stubFetch(async () => new Response(JSON.stringify({ success: true, result: [{ results: { columns: ["x"], rows: [["y".repeat(5_000)]] } }] })));
        await expect(rawQuery(config, DB_ID, "SELECT x FROM t", undefined, 1_000)).rejects.toThrow("answered more than DBackup reads of one answer");
    });

    it("names a refused permission apart from a refused token", async () => {
        fakeCloudflare(() => refused(403, 9109, "Unauthorized to access requested resource"));
        const error = await listDatabases(config).catch((e: Error) => e);
        expect((error as Error).message).toMatch(/missing a permission/);
        expect(isPermissionRefusal(error)).toBe(true);
    });

    it("passes on the words of a failed statement, since D1 answers 7500 for any SQL error", async () => {
        fakeCloudflare(() => refused(400, 7500, "no such table: missing: SQLITE_ERROR"));
        const error = await rawQuery(config, DB_ID, "SELECT * FROM missing").catch((e: Error) => e);
        expect((error as Error).message).toMatch(/400: no such table: missing/);
        expect(isPermissionRefusal(error)).toBe(false);
    });

    it("refuses a database ID from an answer that is no UUID before it becomes part of a URL", () => {
        expect(() => databaseIdOf("../../tokens")).toThrow(/not a UUID/);
        expect(() => databaseIdOf(undefined)).toThrow(/not a UUID/);
        expect(databaseIdOf(DB_ID.toUpperCase())).toBe(DB_ID);
    });
});

describe("the list of databases", () => {
    it("stops after a bound of pages when the API keeps answering full pages", async () => {
        const full = Array.from({ length: 1000 }, (_, i) => ({ uuid: DB_ID, name: `db-${i}` }));
        const { calls } = fakeCloudflare(() => ok(full));
        expect(await listDatabases(config)).toHaveLength(100_000);
        expect(calls).toHaveLength(100);
    });

    it("finds a name the wide filter of the API hides behind a full page in the whole list", async () => {
        const decoys = Array.from({ length: 100 }, (_, i) => ({ uuid: DB_ID, name: `shop-${i}` }));
        fakeCloudflare((call) => (call.path.includes("name=shop") ? ok(decoys) : ok([...decoys, { uuid: DB_ID, name: "shop" }])));
        expect((await findDatabase(config, "shop"))?.name).toBe("shop");
    });

    it("leaves out entries without a name or an ID", async () => {
        fakeCloudflare(() => ok([{ uuid: DB_ID, name: "shop" }, { name: "no-id" }, { uuid: DB_ID }]));
        expect((await listDatabases(config)).map((db) => db.name)).toEqual(["shop"]);
    });
});

describe("the health check and the job form of a D1 connection", () => {
    it("pings with one small page of the list", async () => {
        const { calls } = fakeCloudflare(() => ok([]));
        expect(await CloudflareD1Adapter.ping!(config, host)).toEqual({ success: true, message: "Cloudflare D1 answered" });
        expect(calls.map((call) => call.path)).toEqual(["/d1/database?per_page=10"]);
    });

    it("reports a ping the token fails, without the prefix of the adapter error", async () => {
        fakeCloudflare(() => refused(401, 10000, "Authentication error"));
        const answer = await CloudflareD1Adapter.ping!(config, host);
        expect(answer.success).toBe(false);
        expect(answer.message).toMatch(/^Cloudflare refused the API token/);
    });

    it("offers the names of the databases sorted, for the job form", async () => {
        fakeCloudflare(() => ok([{ uuid: DB_ID, name: "web" }, { uuid: DB_ID, name: "api" }]));
        expect(await CloudflareD1Adapter.getDatabases!(config, host)).toEqual(["api", "web"]);
    });

    it("runs in DBackup itself whatever the config holds, since nothing reaches a host of the customer", () => {
        expect(CloudflareD1Adapter.transport!({ connectionMode: "ssh", sshHost: "elsewhere" })).toEqual({ kind: "direct" });
    });
});
