import { describe, it, expect } from "vitest";

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { getTables, getTableData } from "@/lib/adapters/database/sqlite/browser";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = { mode: "local", path: "/data/app.sqlite" };

/** The SQL or dot command a recorded call issued. */
function queryOf(argv: string[]): string {
    return argv[argv.length - 1] ?? "";
}

function browserHost(kind: HostKind, responses: { tables?: string; counts?: string; pragma?: string; count?: string; data?: string; listed?: string }): FakeHost {
    return createFakeHost({
        kind,
        onExec: (argv) => {
            const query = queryOf(argv);
            // The question whether the file lists the table and its columns, asked before any read.
            if (query.startsWith("SELECT (SELECT count(*)")) return { stdout: responses.listed ?? "1\n" };
            if (query.includes("sqlite_master")) return { stdout: responses.tables ?? "" };
            if (query.includes("UNION ALL") || query.startsWith("SELECT count(*)")) return { stdout: responses.counts ?? "" };
            if (query.startsWith("PRAGMA")) return { stdout: responses.pragma ?? "" };
            if (query.startsWith("SELECT COUNT(*)")) return { stdout: responses.count ?? "" };
            return { stdout: responses.data ?? "" };
        },
    });
}

describe.each<HostKind>(["direct", "ssh"])("SQLite browser over a %s host", (kind) => {
    describe("getTables()", () => {
        it("parses tables and views", async () => {
            const host = browserHost(kind, { tables: "users|table\nactive_users|view\n", counts: "42\n" });
            const result = await getTables(baseConfig as never, "", host);

            expect(result.map(t => t.type)).toEqual(["table", "view"]);
            expect(result[0]).toMatchObject({ name: "users", rowCount: 42 });
        });

        it("returns nothing for a blank listing", async () => {
            const host = browserHost(kind, { tables: "" });
            expect(await getTables(baseConfig as never, "", host)).toEqual([]);
        });

        it("keeps the table list when the row counts cannot be read", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv).includes("sqlite_master")
                    ? { stdout: "users|table\n" }
                    : { code: 1, stderr: "no such table" },
            });

            const result = await getTables(baseConfig as never, "", host);
            expect(result).toEqual([{ name: "users", type: "table" }]);
        });

        it("reports a failing listing rather than returning nothing", async () => {
            const host = createFakeHost({ kind, onExec: () => ({ code: 1, stderr: "unable to open database" }) });
            await expect(getTables(baseConfig as never, "", host))
                .rejects.toThrow(/Failed to list tables.*unable to open database/);
        });
    });

    describe("getTableData()", () => {
        const options = { database: "app.sqlite", table: "users", page: 1, pageSize: 10 };

        it("returns rows, total count and columns", async () => {
            const host = browserHost(kind, {
                pragma: "0|id|INTEGER|1||1\n1|name|TEXT|0||0\n",
                count: "2\n",
                data: "1\tAlice\n2\tBob\n",
            });

            const result = await getTableData(baseConfig as never, options as never, host);

            expect(result.totalCount).toBe(2);
            expect(result.columns.map(c => c.name)).toEqual(["id", "name"]);
            expect(result.rows).toHaveLength(2);
        });

        it("asks for tab separated output so values keep their shape", async () => {
            const host = browserHost(kind, { pragma: "", count: "0\n", data: "" });
            await getTableData(baseConfig as never, options as never, host);

            const dataCall = host.calls.exec.find(a => a.includes("-separator"))!;
            expect(dataCall[dataCall.indexOf("-separator") + 1]).toBe("\t");
        });

        it("surfaces which of the three queries failed", async () => {
            const host = createFakeHost({
                kind,
                onExec: (argv) => queryOf(argv).startsWith("SELECT COUNT(*)")
                    ? { code: 1, stderr: "boom" }
                    : { stdout: queryOf(argv).startsWith("SELECT (SELECT count(*)") ? "1\n" : "" },
            });

            await expect(getTableData(baseConfig as never, options as never, host))
                .rejects.toThrow(/Count query failed: boom/);
        });

        it("doubles quotes in an identifier", async () => {
            const host = browserHost(kind, { pragma: "", count: "0\n", data: "" });
            await getTableData(
                baseConfig as never,
                { ...options, table: 'we"ird' } as never,
                host,
            );

            const dataCall = host.calls.exec.find(a => queryOf(a).startsWith("SELECT * FROM"))!;
            expect(queryOf(dataCall)).toContain('"we""ird"');
        });
    });
});
