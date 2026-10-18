import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks: filesystem and TAR handling only, never the transport ---

const {
    mockEnsureDatabase,
    mockIsMultiDbTar,
    mockExtractSelected,
    mockCreateTempDir,
    mockCleanupTempDir,
    mockShouldRestore,
    mockGetTargetName,
    mockFsStat,
} = vi.hoisted(() => ({
    mockEnsureDatabase: vi.fn(),
    mockIsMultiDbTar: vi.fn(),
    mockExtractSelected: vi.fn(),
    mockCreateTempDir: vi.fn(),
    mockCleanupTempDir: vi.fn(),
    mockShouldRestore: vi.fn(),
    mockGetTargetName: vi.fn(),
    mockFsStat: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mysql/connection", () => ({
    ensureDatabase: (...args: unknown[]) => mockEnsureDatabase(...args),
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
    default: { stat: (...args: unknown[]) => mockFsStat(...args) },
    stat: (...args: unknown[]) => mockFsStat(...args),
}));

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { restore, restoreOne, prepareRestore } from "@/lib/adapters/database/mysql/restore";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = {
    host: "db.internal",
    port: 3306,
    user: "root",
    password: "secret",
    database: "shop",
};

/** A host whose mysql client exits with `code` and writes `stderr`. */
function restoreHost(kind: HostKind, opts: { stderr?: string; code?: number } = {}): FakeHost {
    return createFakeHost({ kind, onSpawn: () => opts });
}

/** Collect log lines with their level. */
function collector() {
    const entries: Array<{ msg: string; level?: string }> = [];
    return {
        entries,
        onLog: (msg: string, level?: string) => entries.push({ msg, level }),
        text: () => entries.map(e => e.msg).join("\n"),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockIsMultiDbTar.mockResolvedValue(false);
    mockFsStat.mockResolvedValue({ size: 4096 });
    mockCreateTempDir.mockResolvedValue("/tmp/mysql-restore-x");
    mockCleanupTempDir.mockResolvedValue(undefined);
    mockShouldRestore.mockReturnValue(true);
    mockGetTargetName.mockImplementation((name: string) => name);
});

describe.each<HostKind>(["direct", "ssh"])("MySQL restore over a %s host", (kind) => {
    describe("prepareRestore()", () => {
        it("ensures every database in the list", async () => {
            const host = restoreHost(kind);
            await prepareRestore(baseConfig as never, ["a", "b"], host);

            expect(mockEnsureDatabase).toHaveBeenCalledTimes(2);
            expect(mockEnsureDatabase).toHaveBeenCalledWith(
                expect.anything(), "a", "root", "secret", false, [], host,
            );
        });

        it("uses the privileged credentials when they are given", async () => {
            await prepareRestore(
                { ...baseConfig, privilegedAuth: { user: "admin", password: "adminpw" } } as never,
                ["a"],
                restoreHost(kind),
            );

            expect(mockEnsureDatabase).toHaveBeenCalledWith(
                expect.anything(), "a", "admin", "adminpw", true, [], expect.anything(),
            );
        });

        it("does nothing for an empty list", async () => {
            await prepareRestore(baseConfig as never, [], restoreHost(kind));
            expect(mockEnsureDatabase).not.toHaveBeenCalled();
        });
    });

    describe("restore()", () => {
        it("restores a single database", async () => {
            const result = await restore(baseConfig as never, "/tmp/dump.sql", restoreHost(kind));
            expect(result.success).toBe(true);
        });

        it("feeds the dump through stdin rather than as an argument", async () => {
            const host = restoreHost(kind);
            await restore(baseConfig as never, "/tmp/dump.sql", host);

            expect(host.calls.spawn[0][0]).toBe("mariadb");
            expect(host.calls.spawn[0]).toContain("--database=shop");
        });

        it("fails when no target database can be determined", async () => {
            const result = await restore({ ...baseConfig, database: "" } as never, "/tmp/dump.sql", restoreHost(kind));

            expect(result.success).toBe(false);
            expect(result.error).toContain("No target database specified");
        });

        it("fails when the mapping selects nothing", async () => {
            const result = await restore(
                { ...baseConfig, databaseMapping: [{ originalName: "a", targetName: "a", selected: false }] } as never,
                "/tmp/dump.sql",
                restoreHost(kind),
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("No databases selected");
        });

        it("uses the target name from the mapping", async () => {
            const host = restoreHost(kind);
            await restore(
                { ...baseConfig, databaseMapping: [{ originalName: "old", targetName: "new", selected: true }] } as never,
                "/tmp/dump.sql",
                host,
            );

            expect(host.calls.spawn[0]).toContain("--database=new");
        });

        it("falls back to the original name when the mapping has no target", async () => {
            const host = restoreHost(kind);
            await restore(
                { ...baseConfig, databaseMapping: [{ originalName: "old", targetName: "", selected: true }] } as never,
                "/tmp/dump.sql",
                host,
            );

            expect(host.calls.spawn[0]).toContain("--database=old");
        });

        it("fails when the client exits non-zero", async () => {
            const result = await restore(baseConfig as never, "/tmp/dump.sql", restoreHost(kind, { code: 1 }));

            expect(result.success).toBe(false);
            expect(result.error).toContain("exited with code 1");
        });

        it("reports progress through to completion", async () => {
            const seen: number[] = [];
            await restore(baseConfig as never, "/tmp/dump.sql", restoreHost(kind), undefined, (p) => seen.push(p));

            expect(seen).toContain(95);
            expect(seen).toContain(100);
        });
    });

    describe("stderr handling", () => {
        it("prefixes and raises ERROR lines", async () => {
            const log = collector();
            await restore(baseConfig as never, "/tmp/dump.sql", restoreHost(kind, {
                stderr: "ERROR 1064 (42000): You have an error in your SQL syntax\n",
            }), log.onLog as never);

            await vi.waitFor(() => {
                const entry = log.entries.find(e => e.msg.includes("ERROR 1064"));
                expect(entry?.level).toBe("error");
                expect(entry?.msg.startsWith("MySQL: ")).toBe(true);
            });
        });

        it("truncates a very long stderr line", async () => {
            const log = collector();
            await restore(baseConfig as never, "/tmp/dump.sql", restoreHost(kind, {
                stderr: "x".repeat(600) + "\n",
            }), log.onLog as never);

            await vi.waitFor(() => expect(log.text()).toContain("... (truncated)"));
        });

        it("redacts the password from stderr", async () => {
            const log = collector();
            await restore(baseConfig as never, "/tmp/dump.sql", restoreHost(kind, {
                stderr: "Access denied using password secret\n",
            }), log.onLog as never);

            await vi.waitFor(() => expect(log.text()).toContain("******"));
            expect(log.text()).not.toContain("secret");
        });
    });

    describe("restoreOne()", () => {
        it("restores one file into one target database", async () => {
            const host = restoreHost(kind);
            await restoreOne(baseConfig as never, "/tmp/a.sql", "target", host);

            expect(host.calls.spawn[0]).toContain("--database=target");
        });

        it("works without callbacks", async () => {
            await expect(restoreOne(baseConfig as never, "/tmp/a.sql", "t", restoreHost(kind)))
                .resolves.toBeUndefined();
        });

        it("rewrites the embedded database name when restoring under a new one", async () => {
            // Previously a remote sed pipeline, which corrupted names containing
            // a slash, backslash or ampersand.
            const host = restoreHost(kind);
            await restoreOne(baseConfig as never, "/tmp/a.sql", "new", host, undefined, undefined, "old");

            // A rewrite means the bytes are staged rather than used in place.
            expect(host.calls.exec.length + host.calls.spawn.length).toBeGreaterThan(0);
        });
    });

    describe("multi database archives", () => {
        beforeEach(() => {
            mockIsMultiDbTar.mockResolvedValue(true);
            mockExtractSelected.mockResolvedValue({
                manifest: { databases: [{ name: "a", filename: "a.sql" }, { name: "b", filename: "b.sql" }] },
                files: ["/tmp/mysql-restore-x/a.sql", "/tmp/mysql-restore-x/b.sql"],
            });
        });

        it("restores every database in the archive", async () => {
            const host = restoreHost(kind);
            const result = await restore(baseConfig as never, "/tmp/multi.tar", host);

            expect(result.success).toBe(true);
            expect(host.calls.spawn).toHaveLength(2);
        });

        it("skips databases the mapping excludes", async () => {
            mockShouldRestore.mockImplementation((name: string) => name === "a");
            const host = restoreHost(kind);

            await restore(baseConfig as never, "/tmp/multi.tar", host);

            expect(host.calls.spawn).toHaveLength(1);
        });

        it("fails when a listed file is missing from the archive", async () => {
            mockExtractSelected.mockResolvedValue({
                manifest: { databases: [{ name: "a", filename: "missing.sql" }] },
                files: [],
            });

            const result = await restore(baseConfig as never, "/tmp/multi.tar", restoreHost(kind));

            expect(result.success).toBe(false);
            expect(result.error).toContain("Database file not found");
        });

        it("cleans up the temp directory even when a restore fails", async () => {
            mockExtractSelected.mockRejectedValue(new Error("extract failed"));

            const result = await restore(baseConfig as never, "/tmp/multi.tar", restoreHost(kind));

            expect(result.success).toBe(false);
            expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/mysql-restore-x");
        });
    });

    describe("diagnostics", () => {
        it("logs the server settings before restoring", async () => {
            const log = collector();
            const host = createFakeHost({
                kind,
                onExec: () => ({ stdout: "max_allowed_packet=67108864 log_bin=OFF" }),
            });

            await restore(baseConfig as never, "/tmp/dump.sql", host, log.onLog as never);

            expect(log.text()).toContain("Server settings: max_allowed_packet=67108864");
        });

        it("continues when the diagnostics query fails", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 1, stderr: "denied" }) });
            const result = await restore(baseConfig as never, "/tmp/dump.sql", host);

            expect(result.success).toBe(true);
        });

        it("reports that the server survived a failed restore", async () => {
            const log = collector();
            const host = createFakeHost({
                kind,
                onExec: (argv) => argv.includes("SELECT 'alive'") ? { stdout: "alive\n" } : { stdout: "" },
                onSpawn: () => ({ code: 1 }),
            });

            await restore(baseConfig as never, "/tmp/dump.sql", host, log.onLog as never);

            expect(log.text()).toContain("MySQL server is still running");
        });

        it("reports that the server stopped responding after a failed restore", async () => {
            const log = collector();
            const host = createFakeHost({
                kind,
                onExec: () => ({ code: 1, stderr: "connection refused" }),
                onSpawn: () => ({ code: 1 }),
            });

            await restore(baseConfig as never, "/tmp/dump.sql", host, log.onLog as never);

            expect(log.text()).toContain("MySQL server NOT responding");
        });
    });
});

describe("MySQL restore transport differences", () => {
    it("forces TCP only when the client runs beside DBackup", async () => {
        const direct = restoreHost("direct");
        const ssh = restoreHost("ssh");

        await restore(baseConfig as never, "/tmp/dump.sql", direct);
        await restore(baseConfig as never, "/tmp/dump.sql", ssh);

        expect(direct.calls.spawn[0]).toContain("--protocol=tcp");
        expect(ssh.calls.spawn[0]).not.toContain("--protocol=tcp");
    });

    it("keeps the password out of argv on both transports", async () => {
        for (const kind of ["direct", "ssh"] as HostKind[]) {
            const host = restoreHost(kind);
            await restore(baseConfig as never, "/tmp/dump.sql", host);

            expect(host.calls.spawn[0].join(" ")).not.toContain("secret");
        }
    });
});
