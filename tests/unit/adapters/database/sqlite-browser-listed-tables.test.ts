import { describe, it, expect } from "vitest";

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { getTableData } from "@/lib/adapters/database/sqlite/browser";
import { ValidationError } from "@/lib/logging/errors";
import type { HostKind } from "@/lib/transport/types";

/**
 * The sqlite3 program knows relations that are no table of the database file. `fsdir` returns the
 * content of any file of the machine it runs on, so a reader of a SQLite source who named it as the
 * table read files beside the database. The table browser reads only what the file lists.
 */

const config = { mode: "local", path: "/data/app.sqlite" };
const page = { database: "main", page: 1, pageSize: 50 };

const queryOf = (argv: string[]) => argv[argv.length - 1] ?? "";
const isListedQuestion = (query: string) => query.startsWith("SELECT (SELECT count(*) FROM sqlite_master");

/** A host whose database answers the question about the table and its columns with these counts. */
function hostAnswering(kind: HostKind, listed: string): FakeHost {
    return createFakeHost({
        kind,
        onExec: (argv) => isListedQuestion(queryOf(argv)) ? { stdout: `${listed}\n` } : { stdout: "" },
    });
}

/** The statements that read rows, columns or counts of the named relation. */
const reads = (host: FakeHost) => host.calls.exec.filter((argv) => !isListedQuestion(queryOf(argv)));

describe.each<HostKind>(["direct", "ssh"])("the SQLite table browser over a %s host", (kind) => {
    it.each(["fsdir", "pragma_database_list", "sqlite_dbpage", "sqlite_master"])(
        "refuses %s, which is no table of the file, before any statement names it",
        async (table) => {
            const host = hostAnswering(kind, "0|0");

            await expect(getTableData(config as never, { ...page, table, searchColumn: "path", search: "/etc/passwd", matchMode: "equals" } as never, host))
                .rejects.toThrow(ValidationError);

            expect(reads(host)).toEqual([]);
        },
    );

    it("asks the file itself, with the name as a value and only its own tables and views", async () => {
        const host = hostAnswering(kind, "0");

        await expect(getTableData(config as never, { ...page, table: "fs'dir" } as never, host)).rejects.toThrow("This table does not exist in the database.");

        expect(host.calls.exec).toHaveLength(1);
        expect(host.calls.exec[0].slice(0, 2)).toEqual(["sqlite3", "/data/app.sqlite"]);
        expect(queryOf(host.calls.exec[0])).toBe(
            "SELECT (SELECT count(*) FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name = 'fs''dir' COLLATE NOCASE);",
        );
    });

    it("refuses a filter column the table does not have", async () => {
        const host = hostAnswering(kind, "1|0");

        await expect(getTableData(config as never, { ...page, table: "users", searchColumn: "path", search: "x", matchMode: "equals" } as never, host))
            .rejects.toThrow("This column does not exist in the table.");

        expect(queryOf(host.calls.exec[0])).toContain("FROM pragma_table_info('users') WHERE name = 'path' COLLATE NOCASE");
        expect(reads(host)).toEqual([]);
    });

    it("refuses a sort column the table does not have", async () => {
        const host = hostAnswering(kind, "1|1|0");

        await expect(getTableData(config as never, { ...page, table: "users", searchColumn: "name", search: "x", sortBy: "data" } as never, host))
            .rejects.toThrow("This column does not exist in the table.");

        expect(reads(host)).toEqual([]);
    });

    it("refuses when the database gives no answer it can count", async () => {
        const host = hostAnswering(kind, "");

        await expect(getTableData(config as never, { ...page, table: "users" } as never, host)).rejects.toThrow(ValidationError);
        expect(reads(host)).toEqual([]);
    });

    it("reads a table the file lists, filtered and sorted by its own columns", async () => {
        const host = hostAnswering(kind, "1|1|1");

        await getTableData(config as never, { ...page, table: "users", searchColumn: "name", search: "a", matchMode: "equals", sortBy: "id" } as never, host);

        expect(reads(host)).toHaveLength(3);
        expect(reads(host).map(queryOf)).toContain(`SELECT * FROM "users" WHERE "name" = 'a' ORDER BY "id" ASC LIMIT 50 OFFSET 0;`);
    });
});
