import { describe, it, expect } from "vitest";

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import {
    ensureDatabase,
    test as testConnection,
    getDatabases,
    getDatabasesWithStats,
} from "@/lib/adapters/database/mysql/connection";
import type { HostKind } from "@/lib/transport/types";

/**
 * Direct and SSH used to be two implementations with two test suites. They are
 * one code path now, so one table of expectations covers both transports and
 * anything that still differs gets its own explicit case at the bottom.
 */

const baseConfig = {
    host: "db.internal",
    port: 3306,
    user: "root",
    password: "secret",
    disableSsl: false,
};

/** The SQL passed after -e, or undefined when the call carries none. */
function queryOf(argv: string[]): string | undefined {
    const i = argv.indexOf("-e");
    return i === -1 ? undefined : argv[i + 1];
}

/** The calls that talk to the server, without the --version question that tells the client apart. */
const queries = (host: FakeHost) => host.calls.exec.filter((argv) => !argv.includes("--version"));

describe.each<HostKind>(["direct", "ssh"])("MySQL connection over a %s host", (kind) => {
    describe("test()", () => {
        it("reports success with a parsed version", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv) === "SELECT VERSION()"
                    ? { stdout: "8.0.44\n" }
                    : { stdout: "" },
            });

            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(true);
            expect(result.version).toBe("8.0.44");
        });

        it("strips the MariaDB suffix from the version", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv) === "SELECT VERSION()"
                    ? { stdout: "11.4.9-MariaDB-ubu2404\n" }
                    : { stdout: "" },
            });

            expect((await testConnection(baseConfig as never, host)).version).toBe("11.4.9");
        });

        it("keeps a version string that does not start with digits", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv) === "SELECT VERSION()"
                    ? { stdout: "unknown-build\n" }
                    : { stdout: "" },
            });

            expect((await testConnection(baseConfig as never, host)).version).toBe("unknown-build");
        });

        it("fails when the server is unreachable", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => argv.includes("ping")
                    ? { code: 1, stderr: "connect to server failed" }
                    : { stdout: "" },
            });

            const result = await testConnection(baseConfig as never, host);
            expect(result.success).toBe(false);
            expect(result.message).toContain("connect to server failed");
        });

        it("fails when the credentials are rejected even though ping succeeded", async () => {
            // mysqladmin ping answers on some MariaDB builds where query auth does not.
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv) === "SELECT 1"
                    ? { code: 1, stderr: "Access denied for user" }
                    : { stdout: "" },
            });

            const result = await testConnection(baseConfig as never, host);
            expect(result.success).toBe(false);
            expect(result.message).toContain("Access denied");
        });

        it("still succeeds when only the version query fails", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv) === "SELECT VERSION()"
                    ? { code: 1, stderr: "denied" }
                    : { stdout: "" },
            });

            const result = await testConnection(baseConfig as never, host);
            expect(result.success).toBe(true);
            expect(result.message).toContain("version unknown");
            expect(result.version).toBeUndefined();
        });

        it("turns a thrown transport error into a failure result", async () => {
            // test() must never throw: the connection dialog renders its message.
            const host = createFakeHost({ kind, onWhich: () => null });
            const result = await testConnection(baseConfig as never, host);
            expect(result.success).toBe(false);
        });

        it("adds --skip-ssl when SSL is disabled", async () => {
            const host = createFakeHost({ kind });
            await testConnection({ ...baseConfig, disableSsl: true } as never, host);
            expect(queries(host)[0]).toContain("--skip-ssl");
        });

        it("turns TLS off with --ssl-mode when the client is MySQL's own, which refuses --skip-ssl", async () => {
            const host = createFakeHost({ kind, onExec: (argv) => (argv.includes("--version") ? { stdout: "mysql  Ver 8.0.46 for Linux on x86_64" } : undefined) });
            await testConnection({ ...baseConfig, disableSsl: true } as never, host);
            expect(queries(host)[0]).toContain("--ssl-mode=DISABLED");
            expect(queries(host)[0]).not.toContain("--skip-ssl");
        });
    });

    describe("getDatabases()", () => {
        const listing = (stdout: string) => createFakeHost({ kind, onExec: () => ({ stdout }) });

        it("filters out the system databases", async () => {
            const host = listing("information_schema\nmysql\nperformance_schema\nsys\nshop\n");
            expect(await getDatabases(baseConfig as never, host)).toEqual(["shop"]);
        });

        it("returns every user database", async () => {
            const host = listing("shop\nanalytics\nmysql\n");
            expect(await getDatabases(baseConfig as never, host)).toEqual(["shop", "analytics"]);
        });

        it("returns nothing when only system databases exist", async () => {
            const host = listing("information_schema\nmysql\n");
            expect(await getDatabases(baseConfig as never, host)).toEqual([]);
        });

        it("throws with the server error when the query fails", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 1, stderr: "Access denied" }) });
            await expect(getDatabases(baseConfig as never, host))
                .rejects.toThrow(/Failed to list databases.*Access denied/);
        });

        it("adds --skip-ssl when SSL is disabled", async () => {
            const host = listing("");
            await getDatabases({ ...baseConfig, disableSsl: true } as never, host);
            expect(queries(host)[0]).toContain("--skip-ssl");
        });
    });

    describe("getDatabasesWithStats()", () => {
        it("parses the tab separated stats output", async () => {
            const host = createFakeHost({
                kind,
                onExec: () => ({ stdout: "shop\t1024\t5\nanalytics\t2048\t10\n" }),
            });

            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([
                { name: "shop", sizeInBytes: 1024, tableCount: 5 },
                { name: "analytics", sizeInBytes: 2048, tableCount: 10 },
            ]);
        });

        it("returns nothing for empty output", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ stdout: "" }) });
            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([]);
        });

        it("defaults unparseable numbers to zero", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ stdout: "shop\tNULL\tNULL\n" }) });
            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([
                { name: "shop", sizeInBytes: 0, tableCount: 0 },
            ]);
        });

        it("falls back to a plain listing when information_schema is not readable", async () => {
            // A least-privilege backup user often cannot read information_schema.
            // Direct mode used to fail outright here instead of falling back.
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv) === "SHOW DATABASES"
                    ? { stdout: "shop\nmysql\n" }
                    : { code: 1, stderr: "SELECT command denied" },
            });

            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([
                { name: "shop", sizeInBytes: 0, tableCount: 0 },
            ]);
        });

        it("throws when the fallback listing also fails", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 1, stderr: "denied" }) });
            await expect(getDatabasesWithStats(baseConfig as never, host))
                .rejects.toThrow(/Failed to list databases/);
        });
    });

    describe("ensureDatabase()", () => {
        it("creates the database without granting when not privileged", async () => {
            const host = createFakeHost({ kind });
            const logs: string[] = [];

            await ensureDatabase(baseConfig as never, "shop", "root", "pw", false, logs, host);

            expect(host.calls.exec).toHaveLength(1);
            expect(queryOf(host.calls.exec[0])).toBe("CREATE DATABASE IF NOT EXISTS `shop`");
            expect(logs).toContain("Database 'shop' ensured.");
        });

        it("grants privileges as well when privileged", async () => {
            const host = createFakeHost({ kind });
            const logs: string[] = [];

            await ensureDatabase(baseConfig as never, "shop", "admin", "pw", true, logs, host);

            expect(host.calls.exec).toHaveLength(2);
            expect(queryOf(host.calls.exec[1])).toContain("GRANT ALL PRIVILEGES ON `shop`.*");
            expect(logs).toContain("Permissions granted for 'shop'.");
        });

        it("connects as the privileged user when one is given", async () => {
            const host = createFakeHost({ kind });
            await ensureDatabase(baseConfig as never, "shop", "admin", "pw", false, [], host);

            const argv = host.calls.exec[0];
            expect(argv[argv.indexOf("-u") + 1]).toBe("admin");
        });

        it("warns instead of throwing when the create fails", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 1, stderr: "denied" }) });
            const logs: string[] = [];

            await ensureDatabase(baseConfig as never, "shop", "root", "pw", false, logs, host);

            expect(logs[0]).toContain("Warning ensures DB 'shop'");
            expect(logs[0]).toContain("denied");
        });

        it("warns when only the grant fails", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv)?.startsWith("GRANT")
                    ? { code: 1, stderr: "no grant option" }
                    : { stdout: "" },
            });
            const logs: string[] = [];

            await ensureDatabase(baseConfig as never, "shop", "root", "pw", true, logs, host);

            expect(logs).toContain("Database 'shop' ensured.");
            expect(logs.some(l => l.includes("Warning grants for 'shop'"))).toBe(true);
        });

        it("warns instead of throwing when the transport fails", async () => {
            const host = createFakeHost({ kind, onWhich: () => null });
            const logs: string[] = [];

            await ensureDatabase(baseConfig as never, "shop", "root", "pw", false, logs, host);

            expect(logs[0]).toContain("Warning ensures DB 'shop'");
        });

        it("writes no defaults-file when there is no password", async () => {
            const host = createFakeHost({ kind });
            await ensureDatabase(baseConfig as never, "shop", "root", undefined, false, [], host);

            expect(host.calls.tempFiles).toHaveLength(0);
            expect(host.calls.exec[0].some(a => a.startsWith("--defaults-file"))).toBe(false);
        });
    });
});

describe("MySQL connection transport differences", () => {
    const run = async (kind: HostKind): Promise<FakeHost> => {
        const host = createFakeHost({ kind });
        await getDatabases(baseConfig as never, host);
        return host;
    };

    it("forces TCP only when the client runs beside DBackup", async () => {
        // Over SSH the client runs on the database host, where the setup guide
        // documents granting 'user'@'localhost' for the local socket path.
        expect((await run("direct")).calls.exec[0]).toContain("--protocol=tcp");
        expect((await run("ssh")).calls.exec[0]).not.toContain("--protocol=tcp");
    });

    it("never puts the password in argv", async () => {
        for (const kind of ["direct", "ssh"] as HostKind[]) {
            const host = await run(kind);
            expect(host.calls.exec[0].join(" ")).not.toContain("secret");
            expect(host.calls.tempFiles[0]).toMatchObject({ mode: 0o600 });
        }
    });

    it("rejects a call made without a transport", async () => {
        // Guessing "direct" for an SSH source would check a different machine.
        await expect(getDatabases(baseConfig as never, undefined as never))
            .rejects.toThrow(/requires an execution host/);

        const result = await testConnection(baseConfig as never, undefined);
        expect(result.success).toBe(false);
        expect(result.message).toContain("requires an execution host");
    });
});
