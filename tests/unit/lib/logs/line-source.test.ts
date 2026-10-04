import { describe, expect, it } from "vitest";
import { firstSentence, isStatement, kindOf, parseCommand, sourceOf, statementLines } from "@/lib/logs/line-source";

describe("the source of a log line", () => {
    it("reads the tool, destination or source in brackets and drops the time the tool wrote itself", () => {
        expect(sourceOf("[mongodump] 2026-09-27T17:00:27.406+0200\twriting testdb.users to archive '/tmp/a.archive'"))
            .toEqual({ source: "mongodump", text: "writing testdb.users to archive '/tmp/a.archive'" });
        expect(sourceOf("[Cloudflare R2] Upload complete: a.tar")).toEqual({ source: "Cloudflare R2", text: "Upload complete: a.tar" });
    });

    it("knows the tools that write their name with a colon, and leaves every other line alone", () => {
        expect(sourceOf("SQL Server: 30 percent processed.")).toEqual({ source: "SQL Server", text: "30 percent processed." });
        expect(sourceOf("SqlPackage: Extracting schema")).toEqual({ source: "SqlPackage", text: "Extracting schema" });
        expect(sourceOf("SHA-256: c5bc45b2")).toEqual({ source: null, text: "SHA-256: c5bc45b2" });
        expect(sourceOf("Databases to dump: a, b")).toEqual({ source: null, text: "Databases to dump: a, b" });
    });
});

describe("a command of the log", () => {
    it("splits a command into its program and its options, each with its value", () => {
        expect(parseCommand("mongodump --host localhost --port 27708 --password ****** --db testdb --archive=/tmp/0001.archive --gzip")).toEqual({
            binary: "mongodump",
            args: [
                { flag: "--host", value: "localhost" },
                { flag: "--port", value: "27708" },
                { flag: "--password", value: "******" },
                { flag: "--db", value: "testdb" },
                { flag: "--archive=", value: "/tmp/0001.archive" },
                { flag: "--gzip", value: null },
            ],
        });
    });

    it("keeps short options, slash options and quoted values whole", () => {
        expect(parseCommand("pg_dump -h db -F c -d shop")?.args).toEqual([
            { flag: "-h", value: "db" }, { flag: "-F", value: "c" }, { flag: "-d", value: "shop" },
        ]);
        expect(parseCommand("SqlPackage /Action:Export /SourceDatabaseName:\"Database Test\"")?.args).toEqual([
            { flag: "/Action:", value: "Export" }, { flag: "/SourceDatabaseName:", value: "\"Database Test\"" },
        ]);
        expect(parseCommand("   ")).toBeNull();
    });

    it("breaks a statement for the server before its clauses", () => {
        const statement = "BACKUP DATABASE [erp] TO DISK = N'/var/backup/erp.bak' WITH FORMAT, INIT, COMPRESSION, STATS = 10, NAME = N'erp-Full Database Backup'";
        expect(isStatement(statement)).toBe(true);
        expect(isStatement("mongodump --db a")).toBe(false);
        expect(statementLines(statement)).toEqual([
            { indent: 0, text: "BACKUP DATABASE [erp]" },
            { indent: 1, text: "TO DISK = N'/var/backup/erp.bak'" },
            { indent: 1, text: "WITH FORMAT, INIT, COMPRESSION, STATS = 10," },
            { indent: 2, text: "NAME = N'erp-Full Database Backup'" },
        ]);
    });
});

describe("the kind of a line", () => {
    it("is the same for lines that say one thing about different tables and columns", () => {
        const a = "Element [dbo].[untitled_table_2].[ledger_start_transaction_id] is a column with system-generated values in a ledger table.";
        const b = "Element [dbo].[MSSQL_DroppedLedgerTable_3c874a39].[ledger_end_sequence_number] is a column with system-generated values in a ledger table.";
        expect(kindOf(a)).toBe(kindOf(b));
        expect(kindOf("Upload attempt 1 failed")).toBe(kindOf("Upload attempt 2 failed"));
        expect(kindOf("The ledger data in system views will not be captured")).not.toBe(kindOf(a));
    });

    it("gives a title from the first sentence, with long names cut short", () => {
        expect(firstSentence("Element [dbo].[MSSQL_DroppedLedgerHistory_1909581841] is a history table. Migrating is not supported."))
            .toBe("Element [dbo].[MSSQL_DroppedLedg…] is a history table");
    });
});
