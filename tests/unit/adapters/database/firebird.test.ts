import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFsStat, mockIsMultiDbTar, mockReadTarManifest } = vi.hoisted(() => ({
    mockFsStat: vi.fn(),
    mockIsMultiDbTar: vi.fn(),
    mockReadTarManifest: vi.fn(),
}));

vi.mock("fs/promises", () => ({
    default: { stat: (...args: unknown[]) => mockFsStat(...args) },
    stat: (...args: unknown[]) => mockFsStat(...args),
}));

vi.mock("@/lib/adapters/database/common/tar-utils", () => ({
    isMultiDbTar: (...args: unknown[]) => mockIsMultiDbTar(...args),
    readTarManifest: (...args: unknown[]) => mockReadTarManifest(...args),
    createMultiDbTar: vi.fn(),
    createTempDir: vi.fn(),
    cleanupTempDir: vi.fn(),
    extractSelectedDatabases: vi.fn(),
    shouldRestoreDatabase: vi.fn(() => true),
    getTargetDatabaseName: vi.fn((n: string) => n),
}));

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import {
    resolveAliasPath,
    buildConnectionString,
    getDatabases,
    getDatabasesWithStats,
    test as testConnection,
    ping,
} from "@/lib/adapters/database/firebird/connection";
import { dump } from "@/lib/adapters/database/firebird/dump";
import { restore, restoreOne } from "@/lib/adapters/database/firebird/restore";
import { analyzeDump } from "@/lib/adapters/database/firebird/analyze";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = {
    host: "fb.internal",
    port: 3050,
    user: "SYSDBA",
    password: "masterkey",
    databases: [{ name: "shop", path: "/var/lib/firebird/shop.fdb" }],
};

/**
 * Firebird verifies that a resolved binary really is its own before using it,
 * because several distributions ship an unrelated `isql` from unixODBC. The
 * fake answers that probe so the adapter gets past it.
 */
function firebirdHost(kind: HostKind, opts: {
    onExec?: (argv: string[]) => { code?: number; stdout?: string; stderr?: string } | undefined;
    onSpawn?: (argv: string[]) => { code?: number; stdout?: string; stderr?: string } | undefined;
} = {}): FakeHost {
    return createFakeHost({
        kind,
        onSpawn: (argv) => argv.includes("-z")
            ? { stdout: "gbak: Firebird 5.0" }
            : opts.onSpawn?.(argv),
        onExec: opts.onExec,
    });
}

describe("Firebird alias handling", () => {
    it("resolves a configured alias to its path", () => {
        expect(resolveAliasPath(baseConfig as never, "shop")).toBe("/var/lib/firebird/shop.fdb");
    });

    it("names the valid aliases when one is unknown", () => {
        expect(() => resolveAliasPath(baseConfig as never, "nope"))
            .toThrow(/Unknown Firebird database alias "nope".*shop/);
    });

    it("omits the port segment for the default port", () => {
        expect(buildConnectionString(baseConfig as never, "/db.fdb")).toBe("fb.internal:/db.fdb");
    });

    it("includes a port segment for a non-default port", () => {
        expect(buildConnectionString({ ...baseConfig, port: 3051 } as never, "/db.fdb"))
            .toBe("fb.internal/3051:/db.fdb");
    });
});

describe.each<HostKind>(["direct", "ssh"])("Firebird over a %s host", (kind) => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 4096 });
    });

    describe("getDatabases()", () => {
        it("returns the configured alias names without running anything", async () => {
            const host = firebirdHost(kind);
            expect(await getDatabases(baseConfig as never, host)).toEqual(["shop"]);
            expect(host.calls.exec).toHaveLength(0);
        });
    });

    describe("getDatabasesWithStats()", () => {
        it("adds a table count from a live query and leaves the size undefined", async () => {
            const host = firebirdHost(kind, { onExec: () => ({ stdout: "  12  \n" }) });

            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([
                { name: "shop", path: "/var/lib/firebird/shop.fdb", tableCount: 12 },
            ]);
        });

        it("falls back to a path-only entry when the query fails", async () => {
            const host = firebirdHost(kind, { onExec: () => ({ code: 1, stderr: "unavailable database" }) });

            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([
                { name: "shop", path: "/var/lib/firebird/shop.fdb" },
            ]);
        });
    });

    describe("test()", () => {
        it("parses the engine version from the isql output", async () => {
            const host = firebirdHost(kind, { onExec: () => ({ stdout: "\n  5.0.1\n\n" }) });
            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(true);
            expect(result.version).toBe("5.0.1");
        });

        it("feeds the SQL through stdin rather than a shell pipeline", async () => {
            let seenStdin: unknown;
            const host = createFakeHost({
                kind,
                onSpawn: (argv) => argv.includes("-z") ? { stdout: "isql: Firebird 5.0" } : undefined,
                onExec: (_argv, options) => { seenStdin = options?.stdin; return { stdout: "5.0.1" }; },
            });

            await testConnection(baseConfig as never, host);
            expect(String(seenStdin)).toContain("rdb$get_context");
        });

        it("keeps the password out of argv and in the environment", async () => {
            let seenEnv: Record<string, string | undefined> | undefined;
            const host = createFakeHost({
                kind,
                onSpawn: (argv) => argv.includes("-z") ? { stdout: "isql: Firebird 5.0" } : undefined,
                onExec: (_argv, options) => { seenEnv = options?.env; return { stdout: "5.0.1" }; },
            });

            await testConnection(baseConfig as never, host);

            expect(seenEnv?.ISC_PASSWORD).toBe("masterkey");
            const isqlCall = host.calls.exec.find(a => a.includes("-user"))!;
            expect(isqlCall.join(" ")).not.toContain("masterkey");
        });

        it("fails when no aliases are configured", async () => {
            const result = await testConnection({ ...baseConfig, databases: [] } as never, firebirdHost(kind));
            expect(result.success).toBe(false);
            expect(result.message).toContain("No database aliases configured");
        });

        it("reports the server error when isql exits non-zero", async () => {
            const host = firebirdHost(kind, { onExec: () => ({ code: 1, stderr: "Your user name and password are not defined" }) });
            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(false);
            expect(result.message).toContain("not defined");
        });
    });

    describe("ping()", () => {
        it("opens the database port rather than only proving the transport works", async () => {
            // Over SSH this used to report success as soon as the SSH handshake
            // succeeded, so a source whose Firebird server was down looked healthy.
            const host = firebirdHost(kind);
            const result = await ping(baseConfig as never, host);

            expect(result.success).toBe(true);
            expect(host.calls.forwards).toHaveLength(0);
        });

        it("rejects a call made without a transport", async () => {
            const result = await ping(baseConfig as never, undefined);
            expect(result.success).toBe(false);
            expect(result.message).toContain("requires an execution host");
        });
    });

    describe("dump()", () => {
        it("runs gbak in backup mode with the user on argv and the password in the environment", async () => {
            let seenEnv: Record<string, string | undefined> | undefined;
            const host = createFakeHost({
                kind,
                onSpawn: (argv, options) => {
                    if (argv.includes("-z")) return { stdout: "gbak: Firebird 5.0" };
                    seenEnv = options?.env;
                    return { code: 0 };
                },
            });

            const result = await dump({ ...baseConfig, database: "shop" } as never, "/tmp/out.fbk", host);

            expect(result.success).toBe(true);
            const gbakCall = host.calls.spawn.find(a => a.includes("-b"))!;
            expect(gbakCall).toContain("-user");
            expect(gbakCall).toContain("SYSDBA");
            expect(gbakCall.join(" ")).not.toContain("masterkey");
            expect(seenEnv?.ISC_PASSWORD).toBe("masterkey");
        });

        it("fails with a clear error for an unknown alias", async () => {
            const result = await dump({ ...baseConfig, database: "nope" } as never, "/tmp/out.fbk", firebirdHost(kind));

            expect(result.success).toBe(false);
            expect(result.error).toContain("Unknown Firebird database alias");
        });

        it("fails when gbak exits non-zero", async () => {
            const host = createFakeHost({
                kind,
                onSpawn: (argv) => argv.includes("-z")
                    ? { stdout: "gbak: Firebird 5.0" }
                    : { code: 1, stderr: "cannot open backup file" },
            });

            const result = await dump({ ...baseConfig, database: "shop" } as never, "/tmp/out.fbk", host);
            expect(result.success).toBe(false);
            expect(result.error).toContain("exited with code 1");
        });
    });

    describe("restore()", () => {
        beforeEach(() => mockIsMultiDbTar.mockResolvedValue(false));

        it("always uses replace mode and keeps the password in the environment", async () => {
            let seenEnv: Record<string, string | undefined> | undefined;
            const host = createFakeHost({
                kind,
                onSpawn: (argv, options) => {
                    if (argv.includes("-z")) return { stdout: "gbak: Firebird 5.0" };
                    seenEnv = options?.env;
                    return { code: 0 };
                },
            });

            const result = await restore({ ...baseConfig, database: "shop" } as never, "/tmp/in.fbk", host);

            expect(result.success).toBe(true);
            const gbakCall = host.calls.spawn.find(a => a.includes("-rep"))!;
            expect(gbakCall.join(" ")).not.toContain("masterkey");
            expect(seenEnv?.ISC_PASSWORD).toBe("masterkey");
        });

        it("treats an explicit target name as a literal path", async () => {
            const host = firebirdHost(kind, { onSpawn: () => ({ code: 0 }) });

            await restore(
                { ...baseConfig, database: "shop", targetDatabaseName: "/srv/restored.fdb" } as never,
                "/tmp/in.fbk",
                host,
            );

            const gbakCall = host.calls.spawn.find(a => a.includes("-rep"))!;
            expect(gbakCall.join(" ")).toContain("/srv/restored.fdb");
        });

        it("fails when gbak exits non-zero", async () => {
            const host = createFakeHost({
                kind,
                onSpawn: (argv) => argv.includes("-z")
                    ? { stdout: "gbak: Firebird 5.0" }
                    : { code: 1, stderr: "database already exists" },
            });

            const result = await restore({ ...baseConfig, database: "shop" } as never, "/tmp/in.fbk", host);
            expect(result.success).toBe(false);
        });
    });

    describe("restoreOne()", () => {
        // The restore of a shared database names the database, which on Firebird is an alias.
        it("restores into the configured path of an alias the target names", async () => {
            const host = firebirdHost(kind, { onSpawn: () => ({ code: 0 }) });

            await restoreOne(baseConfig as never, "/tmp/in.fbk", "shop", host);

            const gbakCall = host.calls.spawn.find(a => a.includes("-rep"))!;
            expect(gbakCall[gbakCall.length - 1]).toBe("fb.internal:/var/lib/firebird/shop.fdb");
        });

        it("keeps a target that is a path, like a restore under a new name", async () => {
            const host = firebirdHost(kind, { onSpawn: () => ({ code: 0 }) });

            await restoreOne(baseConfig as never, "/tmp/in.fbk", "/srv/restored.fdb", host);

            const gbakCall = host.calls.spawn.find(a => a.includes("-rep"))!;
            expect(gbakCall[gbakCall.length - 1]).toBe("fb.internal:/srv/restored.fdb");
        });
    });
});

describe("Firebird analyzeDump", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns the database names from a multi-database archive manifest", async () => {
        mockIsMultiDbTar.mockResolvedValue(true);
        mockReadTarManifest.mockResolvedValue({ databases: [{ name: "shop" }, { name: "analytics" }] });

        expect(await analyzeDump("/tmp/multi.tar")).toEqual(["shop", "analytics"]);
    });

    it("returns nothing for a single binary backup file", async () => {
        mockIsMultiDbTar.mockResolvedValue(false);
        expect(await analyzeDump("/tmp/single.fbk")).toEqual([]);
    });
});
