import { afterEach, describe, expect, it, vi } from "vitest";
import { accountIdOf, d1Request, findDatabase, isPermissionRefusal, listDatabases } from "@/lib/adapters/database/cloudflare-d1/api";
import { signedUrlOf } from "@/lib/adapters/database/cloudflare-d1/transfer";
import { CloudflareD1Adapter } from "@/lib/adapters/database/cloudflare-d1";
import { ACCOUNT, DB_ID, config, fakeCloudflare, ok, refused } from "./fake-cloudflare";

const host = {} as never;

afterEach(() => vi.unstubAllGlobals());

describe("the account of a D1 connection", () => {
    it("takes the 32 hex characters of the dashboard, in any case", () => {
        expect(accountIdOf({ accountId: ` ${ACCOUNT.toUpperCase()} ` })).toBe(ACCOUNT);
    });

    it("refuses anything else before it becomes part of a URL", () => {
        expect(() => accountIdOf({ accountId: "../../zones" })).toThrow(/32 hex characters/);
        expect(() => accountIdOf({ accountId: `${ACCOUNT}/d1` })).toThrow(/32 hex characters/);
    });
});

describe("a call of the Cloudflare API", () => {
    it("sends the token as a bearer token and answers the result of the envelope", async () => {
        const { calls } = fakeCloudflare(() => ok([{ uuid: DB_ID, name: "shop" }]));
        const { result } = await d1Request(config, "list", "GET", "/d1/database");
        expect(result).toEqual([{ uuid: DB_ID, name: "shop" }]);
        expect(calls[0].headers.Authorization).toBe("Bearer test-token");
    });

    it("names the token, not the request, when Cloudflare refuses it, and never repeats the token", async () => {
        fakeCloudflare(() => refused(401, 10000, "Authentication error"));
        const error = await d1Request(config, "list", "GET", "/d1/database").catch((e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/refused the API token/);
        expect((error as Error).message).not.toContain("test-token");
        expect(isPermissionRefusal(error)).toBe(true);
    });

    it("tells a broken request from a missing right", async () => {
        fakeCloudflare(() => refused(400, 7400, "bad SQL"));
        const error = await d1Request(config, "query", "POST", "/x", {}).catch((e: Error) => e);
        expect((error as Error).message).toMatch(/400: bad SQL/);
        expect(isPermissionRefusal(error)).toBe(false);
    });

    it("refuses a connection without a token before anything is sent", async () => {
        const { calls } = fakeCloudflare(() => ok([]));
        await expect(d1Request({ accountId: ACCOUNT }, "list", "GET", "/d1/database")).rejects.toThrow(/No API token/);
        expect(calls).toHaveLength(0);
    });
});

describe("the databases of an account", () => {
    it("reads every page of the list", async () => {
        const page = (n: number, count: number) => Array.from({ length: count }, (_, i) => ({ uuid: DB_ID, name: `db-${n}-${i}` }));
        fakeCloudflare((call) => ok(call.path.includes("page=1&") ? page(1, 1000) : page(2, 3), { result_info: { total_count: 1003 } }));
        expect(await listDatabases(config)).toHaveLength(1003);
    });

    it("finds a database by its exact name, not by the wider name filter of the API", async () => {
        fakeCloudflare(() => ok([{ uuid: DB_ID, name: "shop-staging" }, { uuid: DB_ID, name: "shop" }]));
        expect((await findDatabase(config, "shop"))?.name).toBe("shop");
        expect(await findDatabase(config, "sho")).toBeNull();
    });

    it("lists names and sizes for the job form and the explorer from one call", async () => {
        const { calls } = fakeCloudflare(() => ok([{ uuid: DB_ID, name: "b", file_size: 2048, num_tables: 3 }, { uuid: DB_ID, name: "a" }]));
        expect(await CloudflareD1Adapter.getDatabasesWithStats!(config, host)).toEqual([
            { name: "a", sizeInBytes: undefined, tableCount: undefined },
            { name: "b", sizeInBytes: 2048, tableCount: 3 },
        ]);
        expect(calls).toHaveLength(1);
    });
});

describe("Test connection", () => {
    it("succeeds with a token that can list D1 and says that backups need D1 Edit", async () => {
        fakeCloudflare(() => ok([{ uuid: DB_ID, name: "shop" }]));
        const answer = await CloudflareD1Adapter.test!(config, host);
        expect(answer.success).toBe(true);
        expect(answer.message).toMatch(/1 database/);
        expect(answer.message).toMatch(/D1 Edit/);
    });

    it("fails with the reason alone, without the prefix of the adapter error", async () => {
        fakeCloudflare(() => refused(401, 1000, "Invalid API Token"));
        const answer = await CloudflareD1Adapter.test!(config, host);
        expect(answer.success).toBe(false);
        expect(answer.message).toMatch(/^Cloudflare refused the API token/);
    });
});

describe("the transfer URL of an export or import", () => {
    it("accepts R2, also in the EU", () => {
        expect(signedUrlOf("https://abc.r2.cloudflarestorage.com/x.sql?sig=1", "export").hostname).toBe("abc.r2.cloudflarestorage.com");
        expect(signedUrlOf("https://abc.eu.r2.cloudflarestorage.com/x.sql", "import").hostname).toBe("abc.eu.r2.cloudflarestorage.com");
    });

    it("refuses any other host, plain HTTP, a port or a login, so a tampered answer cannot point the dump elsewhere", () => {
        for (const url of [
            "https://evil.example.com/x.sql",
            "https://r2.cloudflarestorage.com.evil.example/x.sql",
            "http://abc.r2.cloudflarestorage.com/x.sql",
            "https://abc.r2.cloudflarestorage.com:8443/x.sql",
            "https://user:pw@abc.r2.cloudflarestorage.com/x.sql",
            "not a url",
        ]) {
            expect(() => signedUrlOf(url, "export"), url).toThrow();
        }
    });
});
