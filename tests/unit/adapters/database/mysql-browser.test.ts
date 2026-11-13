import { describe, it, expect } from "vitest";

import type { FakeHost } from "@/lib/testing/fake-host";
import { clientHost, statements } from "./mysql/client-help";
import { getTables, getTableData } from "@/lib/adapters/database/mysql/browser";
import type { HostKind } from "@/lib/transport/types";

/**
 * The browser no longer builds shell strings, so these assert on argv arrays.
 * That is strictly stronger than the previous substring matching, and it is
 * identical for both transports, which is why one table covers direct and ssh.
 */

const baseConfig = {
    host: "localhost",
    port: 3306,
    user: "root",
    password: "secret",
    database: "testdb",
    disableSsl: false,
};

/** The SQL passed after -e for a recorded exec call. */
function queryOf(argv: string[]): string {
    return argv[argv.indexOf("-e") + 1];
}

/** Route a canned stdout to whichever of the three concurrent queries asked for it. */
function hostWith(kind: HostKind, responses: { columns?: string; count?: string; data?: string; tables?: string }): FakeHost {
    return clientHost({
        kind,
        onExec: (argv) => {
            const query = queryOf(argv) ?? "";
            if (query.includes("COLUMN_NAME")) return { stdout: responses.columns ?? "" };
            if (query.includes("COUNT(*)")) return { stdout: responses.count ?? "" };
            if (query.includes("TABLE_TYPE")) return { stdout: responses.tables ?? "" };
            return { stdout: responses.data ?? "" };
        },
    });
}

describe.each<HostKind>(["direct", "ssh"])("MySQL browser over a %s host", (kind) => {
    describe("getTables()", () => {
        it("parses the table listing", async () => {
            const host = hostWith(kind, { tables: "users\tBASE TABLE\t42\t8192\n" });

            const result = await getTables(baseConfig as never, "testdb", host);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                name: "users",
                type: "table",
                rowCount: 42,
                sizeInBytes: 8192,
            });
        });

        it("maps VIEW onto the view type", async () => {
            const host = hostWith(kind, { tables: "v_active\tVIEW\t0\t0\n" });
            const result = await getTables(baseConfig as never, "testdb", host);
            expect(result[0].type).toBe("view");
        });

        it("ignores blank lines in the output", async () => {
            const host = hostWith(kind, { tables: "\n\norders\tBASE TABLE\t5\t1024\n\n" });
            const result = await getTables(baseConfig as never, "testdb", host);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("orders");
        });

        it("returns nothing when the output is blank", async () => {
            const host = hostWith(kind, { tables: "" });
            expect(await getTables(baseConfig as never, "testdb", host)).toEqual([]);
        });

        it("passes connection settings as separate arguments", async () => {
            const host = hostWith(kind, { tables: "" });
            await getTables(baseConfig as never, "testdb", host);

            const argv = statements(host)[0];
            expect(argv).toContain("-h");
            expect(argv[argv.indexOf("-h") + 1]).toBe("localhost");
            expect(argv[argv.indexOf("-P") + 1]).toBe("3306");
            expect(argv[argv.indexOf("-u") + 1]).toBe("root");
            expect(argv).toContain("--skip-column-names");
            expect(argv).toContain("--batch");
        });

        it("reports a failing query instead of returning an empty list", async () => {
            const host = clientHost({
                kind,
                onExec: () => ({ code: 1, stderr: "ERROR 1044: Access denied" }),
            });

            await expect(getTables(baseConfig as never, "testdb", host))
                .rejects.toThrow(/Failed to list tables.*Access denied/);
        });
    });

    describe("getTableData()", () => {
        const options = { database: "testdb", table: "users", page: 1, pageSize: 10 };

        it("returns rows, total count and columns", async () => {
            const host = hostWith(kind, {
                columns: "id\tint\tNO\tPRI\tNULL\nname\tvarchar\tYES\t\tNULL\n",
                count: "3\n",
                data: "1\tAlice\n2\tBob\n3\tCarl\n",
            });

            const result = await getTableData(baseConfig as never, options as never, host);

            expect(result.totalCount).toBe(3);
            expect(result.columns).toHaveLength(2);
            expect(result.columns[0]).toMatchObject({ name: "id", dataType: "int", primaryKey: true });
            expect(result.columns[1]).toMatchObject({ name: "name", dataType: "varchar", nullable: true });
            expect(result.rows).toHaveLength(3);
            expect(result.rows[0]).toEqual({ id: "1", name: "Alice" });
        });

        it("treats \\N as null", async () => {
            const host = hostWith(kind, {
                columns: "name\tvarchar\tYES\t\tNULL\n",
                count: "1\n",
                data: "\\N\n",
            });

            const result = await getTableData(baseConfig as never, options as never, host);
            expect(result.rows[0].name).toBeNull();
        });

        it("puts the sort clause in the data query", async () => {
            const host = hostWith(kind, { columns: "", count: "0\n", data: "" });

            await getTableData(
                baseConfig as never,
                { ...options, sortBy: "name", sortDir: "desc" } as never,
                host,
            );

            const dataQuery = statements(host).map(queryOf).find(q => q?.startsWith("SELECT * FROM"));
            expect(dataQuery).toContain("ORDER BY `name` DESC");
        });

        it("surfaces which of the three queries failed", async () => {
            const host = clientHost({
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
        it("doubles backslashes in the database name", async () => {
            const host = hostWith(kind, { tables: "" });
            await getTables(baseConfig as never, "back\\slash", host);
            expect(queryOf(statements(host)[0])).toContain("'back\\\\slash'");
        });

        it("escapes single quotes in the database name", async () => {
            const host = hostWith(kind, { tables: "" });
            await getTables(baseConfig as never, "it's", host);
            expect(queryOf(statements(host)[0])).toContain("'it''s'");
        });

        it("strips null bytes from the database name", async () => {
            const host = hostWith(kind, { tables: "" });
            await getTables(baseConfig as never, "db\0name", host);

            const query = queryOf(statements(host)[0]);
            expect(query).toContain("'dbname'");
            expect(query).not.toContain("\0");
        });

        it("escapes the database name in the columns query", async () => {
            const host = hostWith(kind, { columns: "", count: "0\n", data: "" });
            await getTableData(
                baseConfig as never,
                { database: "back\\slash", table: "users", page: 1, pageSize: 10 } as never,
                host,
            );

            const colQuery = statements(host).map(queryOf).find(q => q?.includes("COLUMN_NAME"));
            expect(colQuery).toContain("'back\\\\slash'");
        });

        it("escapes single quotes in the table name", async () => {
            const host = hostWith(kind, { columns: "", count: "0\n", data: "" });
            await getTableData(
                baseConfig as never,
                { database: "testdb", table: "o'reilly", page: 1, pageSize: 10 } as never,
                host,
            );

            const colQuery = statements(host).map(queryOf).find(q => q?.includes("COLUMN_NAME"));
            expect(colQuery).toContain("'o''reilly'");
        });
    });
});

describe("MySQL browser transport differences", () => {
    it("forces TCP only when the client runs beside DBackup", async () => {
        // Over SSH the client runs on the database host, where the setup guide
        // documents granting 'user'@'localhost' for the local socket path.
        const direct = hostWith("direct", { tables: "" });
        const ssh = hostWith("ssh", { tables: "" });

        await getTables(baseConfig as never, "testdb", direct);
        await getTables(baseConfig as never, "testdb", ssh);

        expect(statements(direct)[0]).toContain("--protocol=tcp");
        expect(statements(ssh)[0]).not.toContain("--protocol=tcp");
    });

    it("keeps the password out of argv and in a 0600 defaults-file", async () => {
        const host = hostWith("ssh", { tables: "" });
        await getTables(baseConfig as never, "testdb", host);

        expect(statements(host)[0].join(" ")).not.toContain("secret");
        expect(host.calls.tempFiles[0]).toMatchObject({ mode: 0o600 });
        expect(host.calls.tempFiles[0].content).toContain('password="secret"');
    });
});
