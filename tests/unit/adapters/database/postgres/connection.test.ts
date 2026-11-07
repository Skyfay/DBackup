import { describe, it, expect } from "vitest";

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import {
    test as testConnection,
    getDatabases,
    getDatabasesWithStats,
} from "@/lib/adapters/database/postgres/connection";
import type { HostKind } from "@/lib/transport/types";

/**
 * psql needs a database to connect to, so every entry point tries `postgres`,
 * then `template1`, then the configured one.
 *
 * That loop used to depend on execFileAsync REJECTING to move on. `host.exec`
 * reports a non-zero exit instead of throwing, so the fallthrough is now an
 * explicit code check. The cases below pin that down: without it the loop stops
 * at the first candidate and quietly returns nothing.
 */

const baseConfig = {
    host: "db.internal",
    port: 5432,
    user: "postgres",
    password: "secret",
    database: "shop",
};

/** Which database a recorded call connected to. */
function connectedTo(argv: string[]): string {
    // The name goes to libpq as a literal keyword value, see dbArg.
    return argv[argv.indexOf("-d") + 1].replace(/^dbname='(.*)'$/, "$1");
}

/** A host where only `reachable` answers and every other database refuses. */
function hostWhereOnly(kind: HostKind, reachable: string, stdout: string): FakeHost {
    return createFakeHost({
        kind,
        onExec: (argv) => connectedTo(argv) === reachable
            ? { stdout }
            : { code: 2, stderr: `FATAL: database "${connectedTo(argv)}" does not exist` },
    });
}

describe.each<HostKind>(["direct", "ssh"])("PostgreSQL connection over a %s host", (kind) => {
    describe("test()", () => {
        it("reports success with the parsed version", async () => {
            const host = createFakeHost({
                kind,
                onExec: () => ({ stdout: " PostgreSQL 16.1 on x86_64-pc-linux-gnu\n" }),
            });

            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(true);
            expect(result.version).toBe("16.1");
        });

        it("keeps an unrecognised version string as-is", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ stdout: "weird build\n" }) });
            expect((await testConnection(baseConfig as never, host)).version).toBe("weird build");
        });

        it("falls through to template1 when postgres is unreachable", async () => {
            const host = hostWhereOnly(kind, "template1", "PostgreSQL 14.2\n");

            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(true);
            expect(result.version).toBe("14.2");
            expect(host.calls.exec.map(connectedTo)).toEqual(["postgres", "template1"]);
        });

        it("falls through to the configured database when the shared ones are unreachable", async () => {
            const host = hostWhereOnly(kind, "shop", "PostgreSQL 15.6\n");

            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(true);
            expect(host.calls.exec.map(connectedTo)).toEqual(["postgres", "template1", "shop"]);
        });

        it("fails with the server error when no candidate answers", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 2, stderr: "password authentication failed" }) });

            const result = await testConnection(baseConfig as never, host);

            expect(result.success).toBe(false);
            expect(result.message).toContain("password authentication failed");
        });

        it("turns a thrown transport error into a failure result", async () => {
            const host = createFakeHost({ kind, onWhich: () => null });
            expect((await testConnection(baseConfig as never, host)).success).toBe(false);
        });
    });

    describe("getDatabases()", () => {
        it("returns the listed databases", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ stdout: "shop\nanalytics\n\n" }) });
            expect(await getDatabases(baseConfig as never, host)).toEqual(["shop", "analytics"]);
        });

        it("falls through to the next candidate database", async () => {
            const host = hostWhereOnly(kind, "template1", "shop\n");

            expect(await getDatabases(baseConfig as never, host)).toEqual(["shop"]);
            expect(host.calls.exec.map(connectedTo)).toEqual(["postgres", "template1"]);
        });

        it("throws with the server error when no candidate answers", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 2, stderr: "connection refused" }) });
            await expect(getDatabases(baseConfig as never, host))
                .rejects.toThrow(/Failed to list databases.*connection refused/);
        });
    });

    describe("getDatabasesWithStats()", () => {
        it("parses sizes and adds a table count per database", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => {
                    const query = argv[argv.indexOf("-c") + 1] ?? "";
                    if (query.includes("pg_database_size")) return { stdout: "shop\t1024\nanalytics\t2048\n" };
                    if (query.includes("pg_catalog.pg_tables")) return { stdout: "7\n" };
                    return { stdout: "" };
                },
            });

            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([
                { name: "shop", sizeInBytes: 1024, tableCount: 7 },
                { name: "analytics", sizeInBytes: 2048, tableCount: 7 },
            ]);
        });

        it("omits the table count when that query fails", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => {
                    const query = argv[argv.indexOf("-c") + 1] ?? "";
                    if (query.includes("pg_database_size")) return { stdout: "shop\t1024\n" };
                    return { code: 1, stderr: "permission denied" };
                },
            });

            expect(await getDatabasesWithStats(baseConfig as never, host)).toEqual([
                { name: "shop", sizeInBytes: 1024 },
            ]);
        });

        it("throws when no candidate database answers", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 2, stderr: "no route to host" }) });
            await expect(getDatabasesWithStats(baseConfig as never, host))
                .rejects.toThrow(/Failed to get database stats.*no route to host/);
        });
    });
});

describe("PostgreSQL connection transport handling", () => {
    it("passes the password through the environment, never through argv", async () => {
        for (const kind of ["direct", "ssh"] as HostKind[]) {
            const host = createFakeHost({ kind, onExec: () => ({ stdout: "" }) });
            await getDatabases(baseConfig as never, host);

            expect(host.calls.exec[0].join(" ")).not.toContain("secret");
        }
    });

    it("rejects a call made without a transport", async () => {
        await expect(getDatabases(baseConfig as never, undefined as never))
            .rejects.toThrow(/requires an execution host/);

        const result = await testConnection(baseConfig as never, undefined);
        expect(result.success).toBe(false);
        expect(result.message).toContain("requires an execution host");
    });
});
