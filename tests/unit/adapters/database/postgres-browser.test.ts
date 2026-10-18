import { describe, it, expect } from "vitest";

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { getTables, getTableData } from "@/lib/adapters/database/postgres/browser";
import type { HostKind } from "@/lib/transport/types";

/**
 * One code path now serves both connection modes, so one table of expectations
 * covers them and the assertions are on argument lists rather than on strings
 * assembled for a shell.
 */

const baseConfig = {
    host: "db.internal",
    port: 5432,
    user: "postgres",
    password: "secret",
    database: "shop",
};

/** The SQL passed after -c for a recorded exec call. */
function queryOf(argv: string[]): string | undefined {
    const i = argv.indexOf("-c");
    return i === -1 ? undefined : argv[i + 1];
}

function hostWith(
    kind: HostKind,
    responses: { tables?: string; columns?: string; count?: string; data?: string },
): FakeHost {
    return createFakeHost({
        kind,
        onExec: (argv) => {
            const query = queryOf(argv) ?? "";
            if (query.includes("information_schema.columns")) return { stdout: responses.columns ?? "" };
            if (query.includes("COUNT(*)")) return { stdout: responses.count ?? "" };
            if (query.includes("pg_tables") || query.includes("table_type")) return { stdout: responses.tables ?? "" };
            return { stdout: responses.data ?? "" };
        },
    });
}

describe.each<HostKind>(["direct", "ssh"])("PostgreSQL browser over a %s host", (kind) => {
    describe("getTables()", () => {
        it("parses the table listing", async () => {
            const host = hostWith(kind, { tables: "users\tBASE TABLE\t42\t8192\n" });
            const result = await getTables(baseConfig as never, "shop", host);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ name: "users", type: "table", rowCount: 42, sizeInBytes: 8192 });
        });

        it("returns nothing for blank output", async () => {
            const host = hostWith(kind, { tables: "" });
            expect(await getTables(baseConfig as never, "shop", host)).toEqual([]);
        });

        it("connects to the database being browsed", async () => {
            const host = hostWith(kind, { tables: "" });
            await getTables(baseConfig as never, "otherdb", host);

            const argv = host.calls.exec[0];
            expect(argv[argv.indexOf("-d") + 1]).toBe("dbname='otherdb'");
            expect(argv[argv.indexOf("-h") + 1]).toBe("db.internal");
            expect(argv[argv.indexOf("-p") + 1]).toBe("5432");
            expect(argv[argv.indexOf("-U") + 1]).toBe("postgres");
        });

        it("reports a failing query instead of returning an empty list", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 1, stderr: "permission denied" }) });
            await expect(getTables(baseConfig as never, "shop", host))
                .rejects.toThrow(/Failed to list tables.*permission denied/);
        });
    });

    describe("getTableData()", () => {
        const options = { database: "shop", table: "users", page: 1, pageSize: 10 };

        it("returns rows, total count and columns", async () => {
            const host = hostWith(kind, {
                columns: "id\tinteger\tNO\t\n",
                count: "2\n",
                data: "1\n2\n",
            });

            const result = await getTableData(baseConfig as never, options as never, host);

            expect(result.totalCount).toBe(2);
            expect(result.columns.length).toBeGreaterThan(0);
            expect(result.rows).toHaveLength(2);
        });

        it("puts the sort clause in the data query", async () => {
            const host = hostWith(kind, { columns: "", count: "0\n", data: "" });
            await getTableData(
                baseConfig as never,
                { ...options, sortBy: "name", sortDir: "desc" } as never,
                host,
            );

            const dataQuery = host.calls.exec.map(queryOf).find(q => q?.startsWith("SELECT * FROM"));
            expect(dataQuery).toContain('ORDER BY "name" DESC NULLS LAST');
        });

        it("surfaces which of the three queries failed", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv)?.includes("COUNT(*)")
                    ? { code: 1, stderr: "boom" }
                    : { stdout: "" },
            });

            await expect(getTableData(baseConfig as never, options as never, host))
                .rejects.toThrow(/Count query failed: boom/);
        });
    });

    describe("SQL escaping", () => {
        it("doubles quotes in the table identifier", async () => {
            const host = hostWith(kind, { columns: "", count: "0\n", data: "" });
            await getTableData(
                baseConfig as never,
                { database: "shop", table: 'we"ird', page: 1, pageSize: 10 } as never,
                host,
            );

            const dataQuery = host.calls.exec.map(queryOf).find(q => q?.startsWith("SELECT * FROM"));
            expect(dataQuery).toContain('"we""ird"');
        });

        it("doubles single quotes in a search value", async () => {
            const host = hostWith(kind, { columns: "", count: "0\n", data: "" });
            await getTableData(
                baseConfig as never,
                { database: "shop", table: "users", page: 1, pageSize: 10, search: "o'reilly", searchColumn: "name", matchMode: "equals" } as never,
                host,
            );

            const dataQuery = host.calls.exec.map(queryOf).find(q => q?.startsWith("SELECT * FROM"));
            expect(dataQuery).toContain("''");
        });
    });
});

describe("PostgreSQL browser transport handling", () => {
    it("passes the password through the environment, never through argv", async () => {
        for (const kind of ["direct", "ssh"] as HostKind[]) {
            const host = hostWith(kind, { tables: "" });
            await getTables(baseConfig as never, "shop", host);

            expect(host.calls.exec[0].join(" ")).not.toContain("secret");
        }
    });
});
