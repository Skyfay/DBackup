import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks: filesystem and TAR handling only, never the transport ---

const {
    mockIsMultiDbTar,
    mockExtractSelected,
    mockCreateTempDir,
    mockCleanupTempDir,
    mockShouldRestore,
    mockGetTargetName,
    mockFsOpen,
} = vi.hoisted(() => ({
    mockIsMultiDbTar: vi.fn(),
    mockExtractSelected: vi.fn(),
    mockCreateTempDir: vi.fn(),
    mockCleanupTempDir: vi.fn(),
    mockShouldRestore: vi.fn(),
    mockGetTargetName: vi.fn(),
    mockFsOpen: vi.fn(),
}));

vi.mock("@/lib/adapters/database/common/tar-utils", () => ({
    isMultiDbTar: (...args: unknown[]) => mockIsMultiDbTar(...args),
    extractSelectedDatabases: (...args: unknown[]) => mockExtractSelected(...args),
    createTempDir: (...args: unknown[]) => mockCreateTempDir(...args),
    cleanupTempDir: (...args: unknown[]) => mockCleanupTempDir(...args),
    shouldRestoreDatabase: (...args: unknown[]) => mockShouldRestore(...args),
    getTargetDatabaseName: (...args: unknown[]) => mockGetTargetName(...args),
}));

vi.mock("fs/promises", () => ({
    default: { open: (...args: unknown[]) => mockFsOpen(...args) },
    open: (...args: unknown[]) => mockFsOpen(...args),
}));

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { restore, restoreOne, prepareRestore } from "@/lib/adapters/database/postgres/restore";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = {
    host: "db.internal",
    port: 5432,
    user: "postgres",
    password: "secret",
    database: "shop",
};

/** psql/pg_restore host whose commands all succeed unless told otherwise. */
function restoreHost(kind: HostKind, onExec?: (argv: string[]) => { code?: number; stdout?: string; stderr?: string } | undefined): FakeHost {
    return createFakeHost({ kind, onExec });
}

/** The SQL passed after -c, if any. */
function queryOf(argv: string[]): string | undefined {
    const i = argv.indexOf("-c");
    return i === -1 ? undefined : argv[i + 1];
}

beforeEach(() => {
    vi.clearAllMocks();
    mockIsMultiDbTar.mockResolvedValue(false);
    mockCreateTempDir.mockResolvedValue("/tmp/pg-restore-x");
    mockCleanupTempDir.mockResolvedValue(undefined);
    mockShouldRestore.mockReturnValue(true);
    mockGetTargetName.mockImplementation((name: string) => name);
    mockFsOpen.mockResolvedValue({
        read: vi.fn().mockImplementation((buffer: Buffer) => {
            Buffer.from("PGDMP").copy(buffer);
            return Promise.resolve({ bytesRead: 5 });
        }),
        close: vi.fn().mockResolvedValue(undefined),
    });
});

describe.each<HostKind>(["direct", "ssh"])("PostgreSQL restore over a %s host", (kind) => {
    describe("prepareRestore()", () => {
        it("skips a database that already exists", async () => {
            const host = restoreHost(kind, (argv) =>
                queryOf(argv)?.startsWith("SELECT 1") ? { stdout: "1\n" } : { stdout: "" });

            await prepareRestore(baseConfig as never, ["shop"], host);

            expect(host.calls.exec.map(queryOf).some(q => q?.startsWith("CREATE DATABASE"))).toBe(false);
        });

        it("creates a database that does not exist yet", async () => {
            const host = restoreHost(kind, () => ({ stdout: "" }));

            await prepareRestore(baseConfig as never, ["shop"], host);

            expect(host.calls.exec.map(queryOf)).toContain('CREATE DATABASE "shop"');
        });

        it("quotes an identifier containing a double quote", async () => {
            const host = restoreHost(kind, () => ({ stdout: "" }));

            await prepareRestore(baseConfig as never, ['we"ird'], host);

            expect(host.calls.exec.map(queryOf)).toContain('CREATE DATABASE "we""ird"');
        });

        it("reports a permission problem in terms the user can act on", async () => {
            const host = restoreHost(kind, (argv) =>
                queryOf(argv)?.startsWith("CREATE DATABASE")
                    ? { code: 1, stderr: "ERROR: permission denied to create database" }
                    : { stdout: "" });

            await expect(prepareRestore(baseConfig as never, ["shop"], host))
                .rejects.toThrow(/Access denied for user 'postgres' to create database 'shop'/);
        });

        it("tolerates a concurrent creation", async () => {
            const host = restoreHost(kind, (argv) =>
                queryOf(argv)?.startsWith("CREATE DATABASE")
                    ? { code: 1, stderr: 'ERROR: database "shop" already exists' }
                    : { stdout: "" });

            await expect(prepareRestore(baseConfig as never, ["shop"], host)).resolves.toBeUndefined();
        });

        it("uses the privileged user when one is configured", async () => {
            const host = restoreHost(kind, () => ({ stdout: "" }));

            await prepareRestore(
                { ...baseConfig, privilegedAuth: { user: "admin", password: "adminpw" } } as never,
                ["shop"],
                host,
            );

            const argv = host.calls.exec[0];
            expect(argv[argv.indexOf("-U") + 1]).toBe("admin");
        });
    });

    describe("restore()", () => {
        it("restores a single database", async () => {
            const result = await restore(baseConfig as never, "/tmp/dump.pgdump", restoreHost(kind, () => ({ stdout: "" })));
            expect(result.success).toBe(true);
        });

        it("passes the staged dump path to pg_restore", async () => {
            const host = restoreHost(kind, () => ({ stdout: "" }));
            await restore(baseConfig as never, "/tmp/dump.pgdump", host);

            const restoreCall = host.calls.exec.find(a => a[0] === "pg_restore");
            expect(restoreCall).toBeDefined();
            expect(restoreCall!).toContain("--clean");
            expect(restoreCall!).toContain("--if-exists");
            expect(restoreCall!).toContain("--no-owner");
        });

        it("treats exit code 1 with ignored errors as success", async () => {
            // pg_restore reports recoverable problems this way. Failing here would
            // reject restores that actually worked.
            const host = restoreHost(kind, (argv) => argv[0] === "pg_restore"
                ? { code: 1, stderr: "pg_restore: warning: errors ignored on restore: 3" }
                : { stdout: "" });

            const result = await restore(baseConfig as never, "/tmp/dump.pgdump", host);
            expect(result.success).toBe(true);
        });

        it("explains the transaction_timeout warning from a newer pg_restore", async () => {
            const logs: string[] = [];
            const host = restoreHost(kind, (argv) => argv[0] === "pg_restore"
                ? { code: 1, stderr: "warning: errors ignored on restore: 1 SET transaction_timeout" }
                : { stdout: "" });

            await restore(baseConfig as never, "/tmp/dump.pgdump", host, (m: string) => logs.push(m));

            expect(logs.join("\n")).toContain("transaction_timeout");
        });

        it("fails on exit code 1 without the ignored-errors marker", async () => {
            const host = restoreHost(kind, (argv) => argv[0] === "pg_restore"
                ? { code: 1, stderr: "pg_restore: error: could not open input file" }
                : { stdout: "" });

            const result = await restore(baseConfig as never, "/tmp/dump.pgdump", host);
            expect(result.success).toBe(false);
        });

        it("fails on any other non-zero exit", async () => {
            const host = restoreHost(kind, (argv) => argv[0] === "pg_restore"
                ? { code: 2, stderr: "connection refused" }
                : { stdout: "" });

            const result = await restore(baseConfig as never, "/tmp/dump.pgdump", host);
            expect(result.success).toBe(false);
            expect(result.error).toContain("connection refused");
        });
    });

    describe("restoreOne()", () => {
        it("restores one file into one target database", async () => {
            const host = restoreHost(kind, () => ({ stdout: "" }));
            await restoreOne(baseConfig as never, "/tmp/a.dump", "target", host);

            const restoreCall = host.calls.exec.find(a => a[0] === "pg_restore")!;
            expect(restoreCall[restoreCall.indexOf("-d") + 1]).toBe("dbname='target'");
        });

        it("works without callbacks", async () => {
            await expect(restoreOne(baseConfig as never, "/tmp/a.dump", "t", restoreHost(kind, () => ({ stdout: "" }))))
                .resolves.toBeUndefined();
        });
    });

    describe("multi database archives", () => {
        beforeEach(() => {
            mockIsMultiDbTar.mockResolvedValue(true);
            mockExtractSelected.mockResolvedValue({
                manifest: { databases: [{ name: "a", filename: "a.dump" }, { name: "b", filename: "b.dump" }] },
                files: ["/tmp/pg-restore-x/a.dump", "/tmp/pg-restore-x/b.dump"],
            });
        });

        it("restores every database in the archive", async () => {
            const host = restoreHost(kind, () => ({ stdout: "" }));
            const result = await restore(baseConfig as never, "/tmp/multi.tar", host);

            expect(result.success).toBe(true);
            expect(host.calls.exec.filter(a => a[0] === "pg_restore")).toHaveLength(2);
        });

        it("cleans up the temp directory when extraction fails", async () => {
            mockExtractSelected.mockRejectedValue(new Error("extract failed"));

            const result = await restore(baseConfig as never, "/tmp/multi.tar", restoreHost(kind, () => ({ stdout: "" })));

            expect(result.success).toBe(false);
            expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/pg-restore-x");
        });
    });
});

describe("PostgreSQL restore transport handling", () => {
    it("passes the password through the environment, never through argv", async () => {
        for (const kind of ["direct", "ssh"] as HostKind[]) {
            const host = restoreHost(kind, () => ({ stdout: "" }));
            await restore(baseConfig as never, "/tmp/dump.pgdump", host);

            expect(host.calls.exec.flat().join(" ")).not.toContain("secret");
        }
    });
});
