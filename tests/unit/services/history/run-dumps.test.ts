import { describe, expect, it } from "vitest";
import type { LogEntry, LogLevel, LogType } from "@/lib/core/logs";
import { buildDumps, dumpRecordsOf, dumpSizes, kindsOf, type DumpRecord } from "@/services/history/run-dumps";

const STEP = "Dumping Databases";
const line = (at: string, message: string, level: LogLevel = "info", type: LogType = "general", details?: string): LogEntry => ({
    timestamp: `2026-09-27T15:${at}.000Z`, level, type, message, stage: STEP, ...(details ? { details } : {}),
});
const progress = (at: string, db: string, done: number, percent: string) =>
    line(at, `[mongodump] 2026-09-27T17:${at}.000+0200\t[####....................]  ${db}.stress_data  ${done}/1500000  (${percent}%)`);

/** A MongoDB backup of the dev database, one database done and the second one dumping. */
const mongo: LogEntry[] = [
    line("00:27", "Dumping database: testdb"),
    line("00:27", "Dumping database: testdb", "info", "command", "mongodump --host localhost --port 27708 --db testdb --archive=/tmp/0001.archive --gzip"),
    line("00:27", "[mongodump] 2026-09-27T17:00:27.406+0200\twriting testdb.stress_data to archive '/tmp/0001.archive'"),
    line("00:27", "[mongodump] 2026-09-27T17:00:27.415+0200\tdone dumping testdb.users (1 document)"),
    progress("00:30", "testdb", 85081, "5.7"),
    line("01:19", "[mongodump] 2026-09-27T17:01:19.016+0200\tdone dumping testdb.stress_data (1500000 documents)"),
    line("01:19", "Completed dump for: testdb", "success"),
    line("01:19", "Dumping database: testdb1"),
    line("01:19", "Dumping database: testdb1", "info", "command", "mongodump --host localhost --port 27708 --db testdb1 --archive=/tmp/0002.archive --gzip"),
    progress("01:22", "testdb1", 85081, "5.7"),
    progress("01:37", "testdb1", 526527, "35.1"),
];

describe("the databases of the dump step", () => {
    it("gives every database its command, what its tool wrote and what the tool counted", () => {
        const [testdb, testdb1] = buildDumps({ entries: mongo, records: [], names: [], previous: new Map(), live: true, now: Date.parse("2026-09-27T15:01:38.000Z") });

        expect(testdb).toMatchObject({ name: "testdb", state: "done", facts: "2 collections · 1,500,001 documents", durationMs: 52_000, progress: null });
        expect(testdb.command).toContain("--db testdb ");
        expect(testdb.outputs).toEqual([expect.objectContaining({ source: "mongodump" })]);
        expect(testdb.outputs[0].lines[0].message).toBe("writing testdb.stress_data to archive '/tmp/0001.archive'");

        // mongodump counts the documents, so the share is exact and the time left follows its pace.
        expect(testdb1).toMatchObject({ name: "testdb1", state: "dumping" });
        expect(testdb1.progress).toMatchObject({ exact: true, part: "stress_data", text: "526,527 of 1,500,000 documents" });
        expect(testdb1.progress!.share).toBeCloseTo(0.351);
        expect(testdb1.progress!.etaMs).toBeGreaterThan(30_000);
    });

    it("takes the percent SQL Server reports while it backs a database up", () => {
        const entries = [
            line("00:01", "Dumping database: erp"),
            line("00:01", "Executing backup", "info", "command", "BACKUP DATABASE [erp] TO DISK = N'/var/erp.bak' WITH FORMAT, STATS = 10"),
            line("00:05", "SQL Server: 10 percent processed."),
            line("00:09", "SQL Server: 20 percent processed."),
        ];
        const [erp] = buildDumps({ entries, records: [], names: [], previous: new Map(), live: true, now: Date.parse("2026-09-27T15:00:10.000Z") });
        expect(erp.progress).toMatchObject({ share: 0.2, exact: true, text: "20 % by SQL Server", etaMs: 32_000 });
        expect(erp.command).toMatch(/^BACKUP DATABASE/);
    });

    it("measures a tool that tells nothing against the dump of the last backup, and says so", () => {
        const records: DumpRecord[] = [
            { name: "postgres", state: "done", bytes: 7_900_000, startedAt: "2026-09-27T15:00:00.000Z", endedAt: "2026-09-27T15:00:01.000Z" },
            { name: "testdb", state: "dumping", bytes: 47_000_000, startedAt: "2026-09-27T15:00:01.000Z", endedAt: null },
            { name: "postgres2", state: "waiting", bytes: null, startedAt: null, endedAt: null },
        ];
        const previous = new Map([["testdb", 81_000_000], ["postgres2", 6_200_000]]);
        const dumps = buildDumps({ entries: [], records, names: [], previous, live: true, now: Date.parse("2026-09-27T15:00:07.000Z") });

        expect(dumps.map((dump) => [dump.name, dump.state])).toEqual([["postgres", "done"], ["testdb", "dumping"], ["postgres2", "waiting"]]);
        expect(dumps[1].progress).toMatchObject({ exact: false, text: "44.8 MB of about 77.2 MB" });
        expect(dumps[1].progress!.share).toBeCloseTo(0.58, 2);
        expect(dumps[2].lastBytes).toBe(6_200_000);

        // The first backup of a database has nothing to measure against.
        const first = buildDumps({ entries: [], records, names: [], previous: new Map(), live: true, now: Date.parse("2026-09-27T15:00:07.000Z") });
        expect(first[1].progress).toMatchObject({ share: null, text: "44.8 MB so far" });
    });

    it("tells a database that never finished as failed once the run is over", () => {
        const entries = [line("00:01", "Dumping database: shop"), line("00:02", "mysqldump: Got error: 1045", "error")];
        const [shop] = buildDumps({ entries, records: [], names: ["shop"], previous: new Map(), live: false, now: 0 });
        expect(shop).toMatchObject({ state: "failed", errors: ["mysqldump: Got error: 1045"] });
    });

    it("keeps what the runner recorded and the sizes a finished run leaves for the next one", () => {
        const records = dumpRecordsOf([
            { name: "a", state: "done", bytes: 10, startedAt: null, endedAt: null },
            { name: "b", state: "failed", bytes: 3, startedAt: null, endedAt: null },
            { name: 7, state: "done" },
            "nonsense",
        ]);
        expect(records.map((record) => record.name)).toEqual(["a", "b"]);
        expect(dumpSizes(records)).toEqual(new Map([["a", 10]]));
    });
});

describe("warnings by kind", () => {
    it("counts the warnings that say one thing about many tables once, with a title in plain words", () => {
        const warning = (message: string) => line("00:03", message, "warning");
        const kinds = kindsOf([
            warning("Element [dbo].[t1].[ledger_start_transaction_id] is a column with system-generated values (a GENERATED ALWAYS column) in a ledger table."),
            warning("Element [dbo].[t1].[ledger_end_transaction_id] is a column with system-generated values (a GENERATED ALWAYS column) in a ledger table."),
            warning("Element [dbo].[h1] is a history table for the [dbo].[t1] updatable ledger table. Migrating data in history tables is not supported."),
            warning("Something no entry knows about [x]. It goes on."),
            line("00:03", "an info line"),
        ], STEP);

        expect(kinds.map((kind) => [kind.title, kind.count])).toEqual([
            ["Generated always columns of ledger tables are left out", 2],
            ["History tables of ledger tables are left out", 1],
            ["Something no entry knows about [x]", 1],
        ]);
        expect(kinds[0].raw).toContain("ledger_start_transaction_id");
        expect(kinds[0].help).toMatch(/fills them again/);
    });
});
