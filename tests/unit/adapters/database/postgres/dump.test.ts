import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks: filesystem and TAR packing only, never the transport ---

const { mockGetDatabases, mockCreateMultiDbTar, mockCreateTempDir, mockCleanupTempDir, mockFsStat } =
    vi.hoisted(() => ({
        mockGetDatabases: vi.fn(),
        mockCreateMultiDbTar: vi.fn(),
        mockCreateTempDir: vi.fn(),
        mockCleanupTempDir: vi.fn(),
        mockFsStat: vi.fn(),
    }));

vi.mock("@/lib/adapters/database/postgres/connection", () => ({
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

vi.mock("fs", async (importOriginal) => {
    const { PassThrough } = await import("stream");
    const createWriteStream = vi.fn(() => {
        // The dump pipes into this stream, so finish has to fire for the write
        // to be considered complete.
        const stream = new PassThrough();
        stream.on("pipe", () => { process.nextTick(() => stream.emit("finish")); });
        return stream;
    });
    return { ...(await importOriginal<typeof import("fs")>()), default: { createWriteStream }, createWriteStream };
});

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { dump, dumpOne } from "@/lib/adapters/database/postgres/dump";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = {
    host: "db.internal",
    port: 5432,
    user: "postgres",
    password: "secret",
    database: "shop",
};

function dumpHost(kind: HostKind, opts: { stderr?: string; code?: number } = {}): FakeHost {
    return createFakeHost({ kind, onSpawn: () => opts });
}

/**
 * A host whose exit code arrives only after stdout has closed and been flushed,
 * which is the order a real connect-time failure produces. The fake host's
 * default exit resolves immediately and never exercises that race.
 */
function lateExitHost(kind: HostKind, code: number): FakeHost {
    const host = createFakeHost({ kind });
    const spawn = host.spawn.bind(host);
    host.spawn = async (argv, opts) => {
        const proc = await spawn(argv, opts);
        return {
            ...proc,
            exit: () => new Promise((resolve) => setTimeout(() => resolve({ code }), 20)),
        };
    };
    return host;
}

describe.each<HostKind>(["direct", "ssh"])("PostgreSQL dump over a %s host", (kind) => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 4096 });
        mockCreateTempDir.mockResolvedValue("/tmp/pg-multidb-x");
        mockCleanupTempDir.mockResolvedValue(undefined);
    });

    it("dumps a single database and reports the size", async () => {
        const result = await dump(baseConfig as never, "/tmp/out.dump", dumpHost(kind));

        expect(result.success).toBe(true);
        expect(result.size).toBe(4096);
    });

    it("uses the custom format and names the database", async () => {
        const host = dumpHost(kind);
        await dump(baseConfig as never, "/tmp/out.dump", host);

        const argv = host.calls.spawn[0];
        expect(argv[0]).toBe("pg_dump");
        expect(argv[argv.indexOf("-F") + 1]).toBe("c");
        expect(argv[argv.indexOf("-d") + 1]).toBe("shop");
    });

    it("passes connection settings as separate arguments", async () => {
        const host = dumpHost(kind);
        await dump(baseConfig as never, "/tmp/out.dump", host);

        const argv = host.calls.spawn[0];
        expect(argv[argv.indexOf("-h") + 1]).toBe("db.internal");
        expect(argv[argv.indexOf("-p") + 1]).toBe("5432");
        expect(argv[argv.indexOf("-U") + 1]).toBe("postgres");
    });

    it.each([
        ["GZIP:9", ["-Z", "9"]],
        ["LZ4:1", ["-Z", "lz4:1"]],
        ["ZSTD:3", ["-Z", "zstd:3"]],
        ["NONE", ["-Z", "0"]],
    ])("maps the %s compression setting onto pg_dump flags", async (setting, expected) => {
        const host = dumpHost(kind);
        await dump({ ...baseConfig, pgCompression: setting } as never, "/tmp/out.dump", host);

        const argv = host.calls.spawn[0];
        const at = argv.indexOf(expected[0]);
        expect(at).toBeGreaterThan(-1);
        expect(argv[at + 1]).toBe(expected[1]);
    });

    it("appends quoted extra options as single arguments", async () => {
        const host = dumpHost(kind);
        await dump({ ...baseConfig, options: `--exclude-table="my table" --verbose` } as never, "/tmp/out.dump", host);

        expect(host.calls.spawn[0]).toContain("my table");
        expect(host.calls.spawn[0]).toContain("--verbose");
    });

    it("fails when pg_dump exits non-zero", async () => {
        const result = await dump(baseConfig as never, "/tmp/out.dump", dumpHost(kind, { code: 1 }));

        expect(result.success).toBe(false);
        expect(result.error).toContain("exited with code 1");
    });

    it("fails when pg_dump exits non-zero after its output was already flushed", async () => {
        const result = await dump(baseConfig as never, "/tmp/out.dump", lateExitHost(kind, 1));

        expect(result.success).toBe(false);
        expect(result.error).toContain("exited with code 1");
    });

    it("fails when pg_dump exits zero but wrote nothing", async () => {
        mockFsStat.mockResolvedValue({ size: 0 });
        const result = await dump(baseConfig as never, "/tmp/out.dump", dumpHost(kind));

        expect(result.success).toBe(false);
        expect(result.error).toContain("is empty");
    });

    it("forwards real stderr but filters NOTICE lines", async () => {
        const logs: string[] = [];
        await dump(baseConfig as never, "/tmp/out.dump", dumpHost(kind, { stderr: "NOTICE:  skipping\n" }), (m) => logs.push(m));
        expect(logs.some(l => l.includes("NOTICE:"))).toBe(false);

        const logs2: string[] = [];
        await dump(baseConfig as never, "/tmp/out.dump", dumpHost(kind, { stderr: "could not read block\n" }), (m) => logs2.push(m));
        await vi.waitFor(() => expect(logs2.some(l => l.includes("could not read block"))).toBe(true));
    });

    it("discovers the databases when the config names none", async () => {
        mockGetDatabases.mockResolvedValue(["shop"]);
        const host = dumpHost(kind);

        await dump({ ...baseConfig, database: "" } as never, "/tmp/out.dump", host);

        expect(mockGetDatabases).toHaveBeenCalledWith(expect.anything(), host);
    });

    it("packs several databases into a TAR", async () => {
        mockCreateMultiDbTar.mockResolvedValue({ databases: [{ name: "a" }, { name: "b" }] });
        const host = dumpHost(kind);

        const result = await dump({ ...baseConfig, database: ["a", "b"] } as never, "/tmp/out.tar", host);

        expect(result.success).toBe(true);
        expect(host.calls.spawn).toHaveLength(2);
    });

    it("cleans up the temp directory when a multi database dump fails", async () => {
        mockCreateMultiDbTar.mockRejectedValue(new Error("tar failed"));

        const result = await dump({ ...baseConfig, database: ["a", "b"] } as never, "/tmp/out.tar", dumpHost(kind));

        expect(result.success).toBe(false);
        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/pg-multidb-x");
    });

    describe("dumpOne()", () => {
        it("writes a plain file with no TAR wrapping", async () => {
            const result = await dumpOne(baseConfig as never, "shop", "/tmp/shop.dump", dumpHost(kind));

            expect(result.size).toBe(4096);
            expect(mockCreateMultiDbTar).not.toHaveBeenCalled();
        });

        it("works without a log callback", async () => {
            await expect(dumpOne(baseConfig as never, "shop", "/tmp/shop.dump", dumpHost(kind)))
                .resolves.toBeDefined();
        });
    });
});

describe("PostgreSQL dump transport handling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 4096 });
    });

    it("passes the password through the environment, never through argv", async () => {
        for (const kind of ["direct", "ssh"] as HostKind[]) {
            const host = dumpHost(kind);
            await dump(baseConfig as never, "/tmp/out.dump", host);

            expect(host.calls.spawn[0].join(" ")).not.toContain("secret");
        }
    });
});
