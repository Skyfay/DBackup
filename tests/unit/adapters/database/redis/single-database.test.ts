import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFsStat } = vi.hoisted(() => ({ mockFsStat: vi.fn() }));

vi.mock("fs/promises", () => ({
    default: { stat: (...args: unknown[]) => mockFsStat(...args) },
    stat: (...args: unknown[]) => mockFsStat(...args),
}));

import { createFakeHost } from "@/lib/testing/fake-host";
import { dumpOne, listDumpEntries } from "@/lib/adapters/database/redis/dump";
import { restoreOne } from "@/lib/adapters/database/redis/restore";
import { REDIS_SNAPSHOT_ENTRY } from "@/lib/adapters/database/redis/constants";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = { host: "redis.internal", port: 6379, password: "secret", database: 0 };

describe.each<HostKind>(["direct", "ssh"])("Redis single-entry backup over a %s host", (kind) => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 2048 });
    });

    it("backs up one snapshot no matter how many logical databases were selected", async () => {
        expect(await listDumpEntries()).toEqual([REDIS_SNAPSHOT_ENTRY]);
    });

    it("writes the RDB and reports its size", async () => {
        const host = createFakeHost({ kind });
        const { size } = await dumpOne(baseConfig as never, REDIS_SNAPSHOT_ENTRY, "/tmp/0001.rdb", host);

        expect(size).toBe(2048);
        expect(host.calls.exec[0]).toContain("--rdb");
    });

    it("throws when redis-cli fails", async () => {
        const host = createFakeHost({ kind, onExec: () => ({ code: 1, stderr: "NOAUTH" }) });
        await expect(dumpOne(baseConfig as never, REDIS_SNAPSHOT_ENTRY, "/tmp/0001.rdb", host)).rejects.toThrow(/NOAUTH/);
    });

    it("prepares the manual restore and throws only when that fails", async () => {
        await expect(restoreOne(baseConfig as never, "/tmp/restore-db-1.rdb", REDIS_SNAPSHOT_ENTRY, createFakeHost({ kind })))
            .resolves.toBeUndefined();

        mockFsStat.mockRejectedValue(new Error("ENOENT"));
        await expect(restoreOne(baseConfig as never, "/tmp/missing.rdb", REDIS_SNAPSHOT_ENTRY, createFakeHost({ kind })))
            .rejects.toThrow(/ENOENT/);
    });
});
