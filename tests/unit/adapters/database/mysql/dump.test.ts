import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks: only the filesystem and TAR packing, never the transport ---

const { mockGetDatabases, mockCreateMultiDbTar, mockCreateTempDir, mockCleanupTempDir, mockFsStat } =
    vi.hoisted(() => ({
        mockGetDatabases: vi.fn(),
        mockCreateMultiDbTar: vi.fn(),
        mockCreateTempDir: vi.fn(),
        mockCleanupTempDir: vi.fn(),
        mockFsStat: vi.fn(),
    }));

vi.mock("@/lib/adapters/database/mysql/connection", () => ({
    getDatabases: (...args: unknown[]) => mockGetDatabases(...args),
}));

vi.mock("@/lib/adapters/database/common/tar-utils", () => ({
    isMultiDbTar: vi.fn(),
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
import { dump, dumpOne } from "@/lib/adapters/database/mysql/dump";
import type { HostKind } from "@/lib/transport/types";
import type { MySQLConfig } from "@/lib/adapters/definitions";

const baseConfig = {
    host: "db.internal",
    port: 3306,
    user: "root",
    password: "secret",
    database: "shop",
} as unknown as MySQLConfig;

/** A host whose mysqldump writes `stdout` and exits with `code`. */
function dumpHost(kind: HostKind, opts: { stdout?: string; stderr?: string; code?: number } = {}): FakeHost {
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

describe.each<HostKind>(["direct", "ssh"])("MySQL dump over a %s host", (kind) => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 2048 });
        mockCreateTempDir.mockResolvedValue("/tmp/mysql-multidb-x");
        mockCleanupTempDir.mockResolvedValue(undefined);
    });

    it("dumps a single database and reports the size", async () => {
        const host = dumpHost(kind);
        const result = await dump(baseConfig, "/tmp/out.sql", host);

        expect(result.success).toBe(true);
        expect(result.size).toBe(2048);
        expect(result.path).toBe("/tmp/out.sql");
    });

    it("runs the dump binary with the database as a separate argument", async () => {
        const host = dumpHost(kind);
        await dump(baseConfig, "/tmp/out.sql", host);

        const argv = host.calls.spawn[0];
        expect(argv[0]).toBe("mariadb-dump");
        expect(argv).toContain("--databases");
        expect(argv[argv.indexOf("--databases") + 1]).toBe("shop");
    });

    it("applies the version specific dialect flags", async () => {
        // The SSH path used to hand-roll a smaller argument set and never saw these.
        const host = dumpHost(kind);
        await dump({ ...baseConfig, detectedVersion: "8.0.44" } as never, "/tmp/out.sql", host);

        expect(host.calls.spawn[0]).toContain("--default-character-set=utf8mb4");
        expect(host.calls.spawn[0]).toContain("--net-buffer-length=16384");
    });

    it("skips the utf8mb4 flag and warns for MySQL below 5.5.3", async () => {
        // utf8mb4 does not exist before 5.5.3, an old mysqldump rejects the flag
        // and the dump comes back empty (#151).
        const host = dumpHost(kind);
        const onLog = vi.fn();
        await dump({ ...baseConfig, detectedVersion: "5.1.66" } as never, "/tmp/out.sql", host, onLog);

        expect(host.calls.spawn[0]).not.toContain("--default-character-set=utf8mb4");
        const warning = onLog.mock.calls.find(([, level]) => level === "warning");
        expect(warning?.[0]).toContain("5.1.66");
        expect(warning?.[0]).toContain("5.7");
    });

    it("does not warn about the version for a supported MySQL", async () => {
        const host = dumpHost(kind);
        const onLog = vi.fn();
        await dump({ ...baseConfig, detectedVersion: "8.0.44" } as never, "/tmp/out.sql", host, onLog);

        expect(onLog.mock.calls.some(([, level]) => level === "warning")).toBe(false);
    });

    it("appends extra options from the config", async () => {
        const host = dumpHost(kind);
        await dump({ ...baseConfig, options: "--single-transaction --quick" } as never, "/tmp/out.sql", host);

        expect(host.calls.spawn[0]).toContain("--single-transaction");
        expect(host.calls.spawn[0]).toContain("--quick");
    });

    it("fails when the dump file ends up empty", async () => {
        mockFsStat.mockResolvedValue({ size: 0 });
        const result = await dump(baseConfig, "/tmp/out.sql", dumpHost(kind));

        expect(result.success).toBe(false);
        expect(result.error).toContain("is empty");
    });

    it("fails when the dump binary exits non-zero", async () => {
        const result = await dump(baseConfig, "/tmp/out.sql", dumpHost(kind, { code: 1 }));

        expect(result.success).toBe(false);
        expect(result.error).toContain("exited with code 1");
    });

    it("fails when the dump binary exits non-zero after its output was already flushed", async () => {
        const result = await dump(baseConfig, "/tmp/out.sql", lateExitHost(kind, 1));

        expect(result.success).toBe(false);
        expect(result.error).toContain("exited with code 1");
    });

    it("forwards real stderr output to the log", async () => {
        const logs: string[] = [];
        await dump(baseConfig, "/tmp/out.sql", dumpHost(kind, { stderr: "table is corrupt" }), (m) => logs.push(m));

        await vi.waitFor(() => expect(logs.some(l => l.includes("table is corrupt"))).toBe(true));
    });

    it.each(["mysqldump: [Warning] Using a password on the command line", "Deprecated program name"])(
        "filters the benign warning %s",
        async (warning) => {
            const logs: string[] = [];
            await dump(baseConfig, "/tmp/out.sql", dumpHost(kind, { stderr: warning }), (m) => logs.push(m));

            expect(logs.some(l => l.includes(warning))).toBe(false);
        },
    );

    it("discovers the databases when the config names none", async () => {
        mockGetDatabases.mockResolvedValue(["shop"]);
        const host = dumpHost(kind);

        const result = await dump({ ...baseConfig, database: "" } as never, "/tmp/out.sql", host);

        expect(mockGetDatabases).toHaveBeenCalledWith(expect.anything(), host);
        expect(result.success).toBe(true);
    });

    it("fails when the server has no databases at all", async () => {
        mockGetDatabases.mockResolvedValue([]);
        const result = await dump({ ...baseConfig, database: "" } as never, "/tmp/out.sql", dumpHost(kind));

        expect(result.success).toBe(false);
        expect(result.error).toContain("No databases found");
    });

    it("splits a comma separated database list", async () => {
        mockCreateMultiDbTar.mockResolvedValue({ databases: [{ name: "a" }, { name: "b" }] });
        const host = dumpHost(kind);

        const result = await dump({ ...baseConfig, database: "a,b" } as never, "/tmp/out.tar", host);

        expect(host.calls.spawn).toHaveLength(2);
        expect(result.metadata?.multiDb?.databases).toEqual(["a", "b"]);
    });

    it("packs several databases into a TAR with a manifest", async () => {
        mockCreateMultiDbTar.mockResolvedValue({ databases: [{ name: "shop" }, { name: "analytics" }] });
        const host = dumpHost(kind);

        const result = await dump({ ...baseConfig, database: ["shop", "analytics"] } as never, "/tmp/out.tar", host);

        expect(result.success).toBe(true);
        expect(result.metadata?.multiDb?.format).toBe("tar");
        expect(mockCreateMultiDbTar).toHaveBeenCalled();
    });

    it("cleans up the temp directory when a multi database dump fails", async () => {
        mockCreateMultiDbTar.mockRejectedValue(new Error("tar failed"));

        const result = await dump({ ...baseConfig, database: ["a", "b"] } as never, "/tmp/out.tar", dumpHost(kind));

        expect(result.success).toBe(false);
        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/mysql-multidb-x");
    });

    describe("dumpOne()", () => {
        it("writes a plain file with no TAR wrapping", async () => {
            const host = dumpHost(kind);
            const result = await dumpOne(baseConfig, "shop", "/tmp/shop.sql", host);

            expect(result.size).toBe(2048);
            expect(mockCreateMultiDbTar).not.toHaveBeenCalled();
        });

        it("works without a log callback", async () => {
            await expect(dumpOne(baseConfig, "shop", "/tmp/shop.sql", dumpHost(kind))).resolves.toBeDefined();
        });

        it("forwards log messages when one is given", async () => {
            const logs: string[] = [];
            await dumpOne(baseConfig, "shop", "/tmp/shop.sql", dumpHost(kind), (m) => logs.push(m));

            expect(logs.some(l => l.includes("Dumping database: shop"))).toBe(true);
        });
    });
});

describe("MySQL dump transport differences", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 2048 });
    });

    it("forces TCP only when the client runs beside DBackup", async () => {
        const direct = dumpHost("direct");
        const ssh = dumpHost("ssh");

        await dump(baseConfig, "/tmp/out.sql", direct);
        await dump(baseConfig, "/tmp/out.sql", ssh);

        expect(direct.calls.spawn[0]).toContain("--protocol=tcp");
        expect(ssh.calls.spawn[0]).not.toContain("--protocol=tcp");
    });

    it("keeps the password out of argv on both transports", async () => {
        for (const kind of ["direct", "ssh"] as HostKind[]) {
            const host = dumpHost(kind);
            await dump(baseConfig, "/tmp/out.sql", host);

            expect(host.calls.spawn[0].join(" ")).not.toContain("secret");
            expect(host.calls.tempFiles[0]).toMatchObject({ mode: 0o600 });
        }
    });

    it("masks the password in the logged command", async () => {
        const logs: Array<string | undefined> = [];
        await dump(baseConfig, "/tmp/out.sql", dumpHost("ssh"), (_m, _l, _t, details) => logs.push(details));

        expect(logs.join(" ")).not.toContain("secret");
    });
});
