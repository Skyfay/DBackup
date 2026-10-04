import { describe, it, expect } from "vitest";

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { getTables, getTableData } from "@/lib/adapters/database/redis/browser";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = {
    host: "redis.internal",
    port: 6379,
    password: "secret",
    database: 0,
};

/** The redis command a recorded call issued, ignoring connection flags. */
function commandOf(argv: string[]): string {
    const known = ["DBSIZE", "SCAN", "EVAL", "PING", "INFO", "CONFIG", "ACL"];
    return argv.find(a => known.includes(a)) ?? "";
}

function browserHost(kind: HostKind, responses: { dbsize?: string; scan?: string; evalOut?: string }): FakeHost {
    return createFakeHost({
        kind,
        onExec: (argv) => {
            switch (commandOf(argv)) {
                case "DBSIZE": return { stdout: responses.dbsize ?? "0\n" };
                case "SCAN": return { stdout: responses.scan ?? "0\n" };
                case "EVAL": return { stdout: responses.evalOut ?? "" };
                default: return { stdout: "" };
            }
        },
    });
}

describe.each<HostKind>(["direct", "ssh"])("Redis browser over a %s host", (kind) => {
    describe("getTables()", () => {
        it("reports the key count as a single pseudo table", async () => {
            const host = browserHost(kind, { dbsize: "42\n" });
            const result = await getTables(baseConfig as never, "0", host);

            expect(result).toEqual([{ name: "Keys", type: "table", rowCount: 42 }]);
        });

        it("reports zero when DBSIZE fails", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 1, stderr: "NOAUTH" }) });
            const result = await getTables(baseConfig as never, "0", host);

            expect(result[0].rowCount).toBe(0);
        });

        it("selects the database being browsed", async () => {
            const host = browserHost(kind, {});
            await getTables(baseConfig as never, "3", host);

            const argv = host.calls.exec[0];
            expect(argv[argv.indexOf("-n") + 1]).toBe("3");
        });

        it("states database zero explicitly rather than relying on the default", async () => {
            const host = browserHost(kind, {});
            await getTables(baseConfig as never, "0", host);

            expect(host.calls.exec[0]).toContain("-n");
            expect(host.calls.exec[0][host.calls.exec[0].indexOf("-n") + 1]).toBe("0");
        });
    });

    describe("getTableData()", () => {
        const options = { database: "0", table: "Keys", page: 1, pageSize: 10 };

        it("returns scanned keys with their type and ttl", async () => {
            const host = browserHost(kind, {
                dbsize: "2\n",
                scan: "0\nuser:1\nuser:2\n",
                evalOut: '1) "string\t-1"\n2) "hash\t60"\n',
            });

            const result = await getTableData(baseConfig as never, options as never, host);

            expect(result.totalCount).toBe(2);
            expect(result.rows).toEqual([
                { key: "user:1", type: "string", ttl: "no expiry" },
                { key: "user:2", type: "hash", ttl: "60s" },
            ]);
        });

        it("labels an expired key", async () => {
            const host = browserHost(kind, {
                dbsize: "1\n",
                scan: "0\ngone\n",
                evalOut: '1) "string\t-2"\n',
            });

            const result = await getTableData(baseConfig as never, options as never, host);
            expect(result.rows[0].ttl).toBe("expired");
        });

        it("returns nothing when the database is empty", async () => {
            const host = browserHost(kind, { dbsize: "0\n", scan: "0\n" });
            const result = await getTableData(baseConfig as never, options as never, host);

            expect(result.rows).toEqual([]);
            expect(result.totalCount).toBe(0);
        });

        it("falls back to unknown when the key lookup fails", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => {
                    switch (commandOf(argv)) {
                        case "DBSIZE": return { stdout: "1\n" };
                        case "SCAN": return { stdout: "0\nuser:1\n" };
                        default: return { code: 1, stderr: "NOSCRIPT" };
                    }
                },
            });

            const result = await getTableData(baseConfig as never, options as never, host);
            expect(result.rows[0]).toMatchObject({ key: "user:1", type: "unknown" });
        });

        it("filters on the key with MATCH, escaping what MATCH reads as a pattern", async () => {
            const host = browserHost(kind, { scan: "0\nses*ion:1\n", evalOut: '1) "hash\t60"\n' });

            const result = await getTableData(baseConfig as never, { ...options, search: "ses*ion", searchColumn: "key", matchMode: "starts" } as never, host);

            const scan = host.calls.exec.find(a => a.includes("SCAN"))!;
            expect(scan.slice(scan.indexOf("MATCH"), scan.indexOf("MATCH") + 2)).toEqual(["MATCH", "ses\\*ion*"]);
            expect(result.rows).toEqual([{ key: "ses*ion:1", type: "hash", ttl: "60s" }]);
            expect(result.totalCount).toBe(1);
            expect(host.calls.exec.some(a => a.includes("DBSIZE"))).toBe(false);
        });

        it("goes on scanning while a round finds no match, until the keyspace ends", async () => {
            const answers = ["17\n", "0\nsession:9\n"];
            const host = createFakeHost({
                kind,
                onExec: (argv) => {
                    switch (commandOf(argv)) {
                        case "SCAN": return { stdout: answers.shift() ?? "0\n" };
                        case "EVAL": return { stdout: '1) "string\t-1"\n' };
                        default: return { stdout: "" };
                    }
                },
            });

            const result = await getTableData(baseConfig as never, { ...options, search: "session", searchColumn: "key" } as never, host);

            const scans = host.calls.exec.filter(a => a.includes("SCAN"));
            expect(scans.map(a => a[a.indexOf("SCAN") + 1])).toEqual(["0", "17"]);
            expect(scans[0]).toContain("*session*");
            expect(result.rows.map(row => row.key)).toEqual(["session:9"]);
        });

        it("passes each key as its own argument", async () => {
            // The SSH path used to paste keys into a shell string, so a key with
            // a quote or a space could break out of the command.
            const host = browserHost(kind, {
                dbsize: "1\n",
                scan: `0\nweird key'with"quotes\n`,
                evalOut: '1) "string\t-1"\n',
            });

            await getTableData(baseConfig as never, options as never, host);

            const evalCall = host.calls.exec.find(a => a.includes("EVAL"))!;
            expect(evalCall).toContain(`weird key'with"quotes`);
        });
    });
});
