import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDatabases, mockCreateMultiDbTar, mockCreateTempDir, mockCleanupTempDir, mockFsStat } =
    vi.hoisted(() => ({
        mockGetDatabases: vi.fn(),
        mockCreateMultiDbTar: vi.fn(),
        mockCreateTempDir: vi.fn(),
        mockCleanupTempDir: vi.fn(),
        mockFsStat: vi.fn(),
    }));

vi.mock("@/lib/adapters/database/mongodb/connection", () => ({
    getDatabases: (...args: unknown[]) => mockGetDatabases(...args),
}));

vi.mock("@/lib/adapters/database/common/tar-utils", () => ({
    createMultiDbTar: (...args: unknown[]) => mockCreateMultiDbTar(...args),
    createTempDir: (...args: unknown[]) => mockCreateTempDir(...args),
    cleanupTempDir: (...args: unknown[]) => mockCleanupTempDir(...args),
}));

vi.mock("fs/promises", () => ({
    default: { stat: (...args: unknown[]) => mockFsStat(...args) },
    stat: (...args: unknown[]) => mockFsStat(...args),
}));

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { dump, dumpOne } from "@/lib/adapters/database/mongodb/dump";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = {
    host: "mongo.internal",
    port: 27017,
    user: "root",
    password: "secret",
    database: "shop",
};

function dumpHost(kind: HostKind, opts: { code?: number; stderr?: string } = {}): FakeHost {
    return createFakeHost({ kind, onSpawn: () => opts });
}

describe.each<HostKind>(["direct", "ssh"])("MongoDB dump over a %s host", (kind) => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 4096 });
        mockCreateTempDir.mockResolvedValue("/tmp/mongo-multidb-x");
        mockCleanupTempDir.mockResolvedValue(undefined);
    });

    it("dumps a single database into a gzipped archive", async () => {
        const host = dumpHost(kind);
        const result = await dump(baseConfig as never, "/tmp/out.archive", host);

        expect(result.success).toBe(true);
        const argv = host.calls.spawn[0];
        expect(argv[0]).toBe("mongodump");
        expect(argv).toContain("--gzip");
        expect(argv[argv.indexOf("--db") + 1]).toBe("shop");
        expect(argv.some(a => a.startsWith("--archive="))).toBe(true);
    });

    it("passes connection settings as separate arguments", async () => {
        const host = dumpHost(kind);
        await dump(baseConfig as never, "/tmp/out.archive", host);

        const argv = host.calls.spawn[0];
        expect(argv[argv.indexOf("--host") + 1]).toBe("mongo.internal");
        expect(argv[argv.indexOf("--port") + 1]).toBe("27017");
        expect(argv[argv.indexOf("--authenticationDatabase") + 1]).toBe("admin");
    });

    it("uses a stored connection URI when one is configured", async () => {
        const host = dumpHost(kind);
        await dump({ ...baseConfig, uri: "mongodb://u:p@h:27017" } as never, "/tmp/out.archive", host);

        expect(host.calls.spawn[0]).toContain("--uri=mongodb://u:p@h:27017");
        expect(host.calls.spawn[0]).not.toContain("--host");
    });

    it("appends quoted extra options as single arguments", async () => {
        const host = dumpHost(kind);
        await dump({ ...baseConfig, options: `--excludeCollection="my coll"` } as never, "/tmp/out.archive", host);

        expect(host.calls.spawn[0]).toContain("my coll");
    });

    it("fails when mongodump exits non-zero", async () => {
        const result = await dump(baseConfig as never, "/tmp/out.archive", dumpHost(kind, { code: 1 }));

        expect(result.success).toBe(false);
        expect(result.error).toContain("exited with code 1");
    });

    it("discovers the databases when the config names none", async () => {
        mockGetDatabases.mockResolvedValue(["shop"]);
        const host = dumpHost(kind);

        await dump({ ...baseConfig, database: "" } as never, "/tmp/out.archive", host);
        expect(mockGetDatabases).toHaveBeenCalledWith(expect.anything(), host);
    });

    it("packs several databases into a TAR", async () => {
        mockCreateMultiDbTar.mockResolvedValue({ databases: [{ name: "a" }, { name: "b" }] });
        const host = dumpHost(kind);

        const result = await dump({ ...baseConfig, database: ["a", "b"] } as never, "/tmp/out.tar", host);

        expect(result.success).toBe(true);
        expect(host.calls.spawn).toHaveLength(2);
    });

    it("masks the password in the logged command", async () => {
        const details: Array<string | undefined> = [];
        await dump(baseConfig as never, "/tmp/out.archive", dumpHost(kind), (_m, _l, _t, d) => details.push(d));

        const logged = details.filter(Boolean).join(" ");
        expect(logged).toContain("******");
        expect(logged).not.toContain("secret");
    });

    describe("dumpOne()", () => {
        it("runs no mongodump for a database name that starts with -", async () => {
            const host = dumpHost(kind);
            await expect(dumpOne(baseConfig as never, "--out=/tmp", "/tmp/x.archive", host)).rejects.toThrow(/starts with -/);
            expect(host.calls.spawn).toHaveLength(0);
        });

        it("writes a plain archive with no TAR wrapping", async () => {
            const result = await dumpOne(baseConfig as never, "shop", "/tmp/shop.archive", dumpHost(kind));

            expect(result.size).toBe(4096);
            expect(mockCreateMultiDbTar).not.toHaveBeenCalled();
        });
    });
});
