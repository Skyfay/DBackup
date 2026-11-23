import { describe, it, expect } from "vitest";

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import {
    test as testConnection,
    getDatabases,
    getDatabasesWithStats,
} from "@/lib/adapters/database/redis/connection";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = {
    host: "redis.internal",
    port: 6379,
    password: "secret",
    database: 0,
};

/** The redis command a recorded call issued. */
function commandOf(argv: string[]): string {
    const known = ["PING", "INFO", "CONFIG", "DBSIZE"];
    return argv.find(a => known.includes(a)) ?? "";
}

function redisHost(kind: HostKind, responses: { ping?: string; info?: string; config?: string; codes?: Record<string, number> }): FakeHost {
    return createFakeHost({
        kind,
        onExec: (argv) => {
            const command = commandOf(argv);
            const code = responses.codes?.[command];
            switch (command) {
                case "PING": return { stdout: responses.ping ?? "PONG\n", code };
                case "INFO": return { stdout: responses.info ?? "", code };
                case "CONFIG": return { stdout: responses.config ?? "", code };
                default: return { stdout: "", code };
            }
        },
    });
}

describe.each<HostKind>(["direct", "ssh"])("Redis connection over a %s host", (kind) => {
    describe("test()", () => {
        it("reports success with the Redis version", async () => {
            const host = redisHost(kind, { info: "redis_version:7.2.4\r\n" });
            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(true);
            expect(result.version).toBe("7.2.4");
        });

        it("prefers the Valkey version when the server reports one", async () => {
            const host = redisHost(kind, { info: "valkey_version:8.0.1\r\nredis_version:7.2.4\r\n" });
            expect((await testConnection(baseConfig as never, host)).version).toBe("8.0.1");
        });

        it("fails when the server does not answer with PONG", async () => {
            const host = redisHost(kind, { ping: "", codes: { PING: 1 } });
            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Connection failed");
        });

        it("fails when the reply is not PONG even on a zero exit", async () => {
            const host = redisHost(kind, { ping: "NOAUTH Authentication required\n" });
            expect((await testConnection(baseConfig as never, host)).success).toBe(false);
        });

        it("succeeds without a version when INFO fails", async () => {
            const host = redisHost(kind, { codes: { INFO: 1 } });
            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(true);
            expect(result.version).toBeUndefined();
        });

        it("turns a thrown transport error into a failure result", async () => {
            const host = createFakeHost({ kind, onWhich: () => null });
            expect((await testConnection(baseConfig as never, host)).success).toBe(false);
        });
    });

    describe("getDatabases()", () => {
        it("returns one entry per configured database", async () => {
            const host = redisHost(kind, { config: "databases\n4\n" });
            expect(await getDatabases(baseConfig as never, host)).toEqual(["0", "1", "2", "3"]);
        });

        it("falls back to sixteen when the server refuses the query", async () => {
            const host = redisHost(kind, { codes: { CONFIG: 1 } });
            expect(await getDatabases(baseConfig as never, host)).toHaveLength(16);
        });

        it("falls back to sixteen when the reply is unparseable", async () => {
            const host = redisHost(kind, { config: "databases\nnot-a-number\n" });
            expect(await getDatabases(baseConfig as never, host)).toHaveLength(16);
        });

        it("queries database zero regardless of the configured one", async () => {
            const host = redisHost(kind, { config: "databases\n16\n" });
            await getDatabases({ ...baseConfig, database: 5 } as never, host);

            expect(host.calls.exec[0]).not.toContain("-n");
        });
    });

    describe("getDatabasesWithStats()", () => {
        it("adds the key count per database", async () => {
            const host = redisHost(kind, {
                config: "databases\n3\n",
                info: "# Keyspace\r\ndb0:keys=10,expires=0\r\ndb2:keys=5,expires=1\r\n",
            });

            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([
                { name: "0", tableCount: 10 },
                { name: "1", tableCount: 0 },
                { name: "2", tableCount: 5 },
            ]);
        });

        it("reports zero counts when the keyspace query fails", async () => {
            const host = redisHost(kind, { config: "databases\n2\n", codes: { INFO: 1 } });

            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([
                { name: "0", tableCount: 0 },
                { name: "1", tableCount: 0 },
            ]);
        });
    });
});

describe("Redis connection transport handling", () => {
    it("hands redis-cli the password in REDISCLI_AUTH on every call, never in its argv", async () => {
        for (const kind of ["direct", "ssh"] as HostKind[]) {
            const envs: Array<Record<string, string | undefined> | undefined> = [];
            const host = createFakeHost({ kind, onExec: (_argv, options) => { envs.push(options?.env); return { stdout: "PONG" }; } });
            await testConnection(baseConfig as never, host);
            await getDatabases(baseConfig as never, host);

            expect(host.calls.exec.length).toBeGreaterThan(1);
            for (const argv of host.calls.exec) {
                expect(argv).not.toContain("-a");
                expect(argv.join(" ")).not.toContain(String(baseConfig.password));
            }
            for (const env of envs) expect(env).toEqual({ REDISCLI_AUTH: baseConfig.password });
        }
    });

    it("rejects a call made without a transport", async () => {
        await expect(getDatabases(baseConfig as never, undefined as never))
            .rejects.toThrow(/requires an execution host/);

        const result = await testConnection(baseConfig as never, undefined);
        expect(result.success).toBe(false);
        expect(result.message).toContain("requires an execution host");
    });
});
