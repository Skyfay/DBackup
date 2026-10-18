import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockMeta, mockIsMultiDbTar, mockExtractSelected, mockCreateTempDir, mockCleanupTempDir, mockShouldRestore, mockGetTargetName } =
    vi.hoisted(() => ({
        mockMeta: vi.fn(),
        mockIsMultiDbTar: vi.fn(),
        mockExtractSelected: vi.fn(),
        mockCreateTempDir: vi.fn(),
        mockCleanupTempDir: vi.fn(),
        mockShouldRestore: vi.fn(),
        mockGetTargetName: vi.fn(),
    }));

vi.mock("@/lib/adapters/database/mongodb/meta", () => ({
    withMongoMeta: (_config: unknown, _host: unknown, fn: (meta: unknown) => unknown) => fn(mockMeta()),
}));

vi.mock("@/lib/adapters/database/common/tar-utils", () => ({
    isMultiDbTar: (...args: unknown[]) => mockIsMultiDbTar(...args),
    extractSelectedDatabases: (...args: unknown[]) => mockExtractSelected(...args),
    createTempDir: (...args: unknown[]) => mockCreateTempDir(...args),
    cleanupTempDir: (...args: unknown[]) => mockCleanupTempDir(...args),
    shouldRestoreDatabase: (...args: unknown[]) => mockShouldRestore(...args),
    getTargetDatabaseName: (...args: unknown[]) => mockGetTargetName(...args),
}));

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { restore, restoreOne, prepareRestore } from "@/lib/adapters/database/mongodb/restore";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = {
    host: "mongo.internal",
    port: 27017,
    user: "root",
    password: "secret",
    database: "shop",
};

function restoreHost(kind: HostKind, opts: { code?: number; stderr?: string } = {}): FakeHost {
    return createFakeHost({ kind, onSpawn: () => opts });
}

function meta(overrides: Record<string, unknown> = {}) {
    mockMeta.mockReturnValue({
        checkWritable: vi.fn(() => null),
        close: vi.fn(),
        ...overrides,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    meta();
    mockIsMultiDbTar.mockResolvedValue(false);
    mockCreateTempDir.mockResolvedValue("/tmp/mongo-restore-x");
    mockCleanupTempDir.mockResolvedValue(undefined);
    mockShouldRestore.mockReturnValue(true);
    mockGetTargetName.mockImplementation((n: string) => n);
});

describe.each<HostKind>(["direct", "ssh"])("MongoDB restore over a %s host", (kind) => {
    describe("prepareRestore()", () => {
        it("probes write access when the transport supports it", async () => {
            const checkWritable = vi.fn(() => Promise.resolve());
            meta({ checkWritable });

            await prepareRestore(baseConfig as never, ["shop"], restoreHost(kind));
            expect(checkWritable).toHaveBeenCalledWith("shop");
        });

        it("continues when the transport cannot probe", async () => {
            // mongorestore reports permission problems itself in that case.
            meta({ checkWritable: vi.fn(() => null) });
            await expect(prepareRestore(baseConfig as never, ["shop"], restoreHost(kind)))
                .resolves.toBeUndefined();
        });

        it("surfaces a denied probe", async () => {
            meta({ checkWritable: vi.fn(() => Promise.reject(new Error("Access denied to database 'shop'. Permissions?"))) });

            await expect(prepareRestore(baseConfig as never, ["shop"], restoreHost(kind)))
                .rejects.toThrow(/Access denied to database 'shop'/);
        });
    });

    describe("restore()", () => {
        it("restores a single archive", async () => {
            const host = restoreHost(kind);
            const result = await restore(baseConfig as never, "/tmp/in.archive", host);

            expect(result.success).toBe(true);
            const argv = host.calls.spawn[0];
            expect(argv[0]).toBe("mongorestore");
            expect(argv).toContain("--gzip");
            expect(argv).toContain("--drop");
        });

        it("reads the archive from a path rather than through stdin", async () => {
            // The single-archive path used to pipe the file into mongorestore
            // while the multi-database path passed --archive=<path>.
            const host = restoreHost(kind);
            await restore(baseConfig as never, "/tmp/in.archive", host);

            expect(host.calls.spawn[0].some(a => a.startsWith("--archive="))).toBe(true);
            expect(host.calls.spawn[0]).not.toContain("--archive");
        });

        it("fails when mongorestore exits non-zero", async () => {
            const result = await restore(baseConfig as never, "/tmp/in.archive", restoreHost(kind, { code: 1 }));

            expect(result.success).toBe(false);
            expect(result.error).toContain("exited with code 1");
        });
    });

    describe("restoreOne()", () => {
        it("remaps the namespace when restoring under a new name", async () => {
            const host = restoreHost(kind);
            await restoreOne(baseConfig as never, "/tmp/a.archive", "target", host, undefined, undefined, "source");

            const argv = host.calls.spawn[0];
            expect(argv[argv.indexOf("--nsFrom") + 1]).toBe("source.*");
            expect(argv[argv.indexOf("--nsTo") + 1]).toBe("target.*");
        });

        it("runs no mongorestore for a target or a source name that starts with -", async () => {
            const host = restoreHost(kind);
            await expect(restoreOne(baseConfig as never, "/tmp/a.archive", "--dir=/tmp", host, undefined, undefined, "source")).rejects.toThrow(/starts with -/);
            await expect(restoreOne(baseConfig as never, "/tmp/a.archive", "target", host, undefined, undefined, "-source")).rejects.toThrow(/starts with -/);
            expect(host.calls.spawn).toHaveLength(0);
        });

        it("limits the restore to the target namespace when there is no rename", async () => {
            const host = restoreHost(kind);
            await restoreOne(baseConfig as never, "/tmp/a.archive", "target", host);

            const argv = host.calls.spawn[0];
            expect(argv[argv.indexOf("--nsInclude") + 1]).toBe("target.*");
        });
    });

    describe("multi database archives", () => {
        beforeEach(() => {
            mockIsMultiDbTar.mockResolvedValue(true);
            mockExtractSelected.mockResolvedValue({
                manifest: { databases: [{ name: "a", filename: "a.archive" }, { name: "b", filename: "b.archive" }] },
                files: ["/tmp/mongo-restore-x/a.archive", "/tmp/mongo-restore-x/b.archive"],
            });
        });

        it("restores every database in the archive", async () => {
            const host = restoreHost(kind);
            const result = await restore(baseConfig as never, "/tmp/multi.tar", host);

            expect(result.success).toBe(true);
            expect(host.calls.spawn).toHaveLength(2);
        });

        it("cleans up the temp directory when extraction fails", async () => {
            mockExtractSelected.mockRejectedValue(new Error("extract failed"));

            const result = await restore(baseConfig as never, "/tmp/multi.tar", restoreHost(kind));

            expect(result.success).toBe(false);
            expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/mongo-restore-x");
        });
    });
});
