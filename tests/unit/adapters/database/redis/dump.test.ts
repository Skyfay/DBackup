import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFsStat } = vi.hoisted(() => ({ mockFsStat: vi.fn() }));

vi.mock("fs/promises", () => ({
    default: { stat: (...args: unknown[]) => mockFsStat(...args) },
    stat: (...args: unknown[]) => mockFsStat(...args),
}));

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { dump } from "@/lib/adapters/database/redis/dump";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = {
    host: "redis.internal",
    port: 6379,
    password: "secret",
    database: 0,
};

function dumpHost(kind: HostKind, opts: { code?: number; stderr?: string; stdout?: string } = {}): FakeHost {
    return createFakeHost({ kind, onExec: () => opts });
}

describe.each<HostKind>(["direct", "ssh"])("Redis dump over a %s host", (kind) => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 2048 });
    });

    it("writes an RDB snapshot and reports the size", async () => {
        const result = await dump(baseConfig as never, "/tmp/out.rdb", dumpHost(kind));

        expect(result.success).toBe(true);
        expect(result.size).toBe(2048);
        expect(result.path).toBe("/tmp/out.rdb");
    });

    it("asks redis-cli to write the RDB to a path", async () => {
        const host = dumpHost(kind);
        await dump(baseConfig as never, "/tmp/out.rdb", host);

        const argv = host.calls.exec[0];
        expect(argv[0]).toBe("redis-cli");
        expect(argv).toContain("--rdb");
        expect(argv[argv.indexOf("--rdb") + 1]).toBeTruthy();
    });

    it("fails when redis-cli exits non-zero", async () => {
        const result = await dump(baseConfig as never, "/tmp/out.rdb", dumpHost(kind, { code: 1, stderr: "NOAUTH" }));

        expect(result.success).toBe(false);
        expect(result.error).toContain("NOAUTH");
    });

    it("fails when the snapshot ends up empty", async () => {
        mockFsStat.mockResolvedValue({ size: 0 });
        const result = await dump(baseConfig as never, "/tmp/out.rdb", dumpHost(kind));

        expect(result.success).toBe(false);
        expect(result.error).toContain("empty");
    });

    it("keeps the password out of the logged command", async () => {
        const details: Array<string | undefined> = [];
        await dump(baseConfig as never, "/tmp/out.rdb", dumpHost(kind), (_m, _l, _t, d) => details.push(d));

        const logged = details.filter(Boolean).join(" ");
        expect(logged).toContain("--rdb");
        expect(logged).not.toContain("secret");
    });

    it("forwards redis-cli output to the log", async () => {
        const logs: string[] = [];
        await dump(baseConfig as never, "/tmp/out.rdb", dumpHost(kind, { stdout: "Transfer finished\n" }), (m) => logs.push(m));

        expect(logs.some(l => l.includes("Transfer finished"))).toBe(true);
    });
});

describe("Redis dump transport handling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 2048 });
    });

    it("hands redis-cli the password in REDISCLI_AUTH, never in the command a process list or an SSH server shows", async () => {
        for (const kind of ["direct", "ssh"] as HostKind[]) {
            const envs: Array<Record<string, string | undefined> | undefined> = [];
            const host = createFakeHost({ kind, onExec: (_argv, options) => { envs.push(options?.env); return {}; } });
            await dump({ ...baseConfig, username: "backup" } as never, "/tmp/out.rdb", host);

            expect(host.calls.exec[0]).not.toContain("-a");
            expect(host.calls.exec[0].join(" ")).not.toContain("secret");
            expect(host.calls.exec[0]).toEqual(expect.arrayContaining(["--user", "backup"]));
            expect(envs[0]).toEqual({ REDISCLI_AUTH: "secret" });
        }
    });
});
