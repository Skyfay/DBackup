import { describe, expect, it } from "vitest";
import type { LogEntry, LogLevel, LogType } from "@/lib/core/logs";
import { formatBytes } from "@/lib/utils";
import type { RestoreRecord, RestoredDatabase } from "@/services/restore/restore-record";
import { restoreRecordOf } from "@/services/history/restore-rows";
import { buildRestoreSummary, type RestoreSummaryInput } from "@/services/history/restore-summary";
import { buildSteps } from "@/services/history/run-steps";

let second = 0;
const line = (stage: string, message: string, level: LogLevel = "info", type: LogType = "general", details?: string): LogEntry => ({
    timestamp: new Date(Date.UTC(2026, 9, 17, 18, 12, second++)).toISOString(), level, type, message, stage, ...(details ? { details } : {}),
});
const done = (stage: string, ms: number): LogEntry => ({ ...line(stage, `${stage} completed`, "success"), durationMs: ms });

const ARCHIVE = "Lab PostgreSQL 18 to Local/Lab_PostgreSQL_18_to_Local_2026-10-17_11-38-14.tar";
const PG_RESTORE = "pg_restore -h 100.100.30.1 -p 5432 -U dbackup -d inventory -w --clean --if-exists --no-owner -v /tmp/restore-db-1.dump";

/** The provider's run of Acme's restore of inventory, as its log reads once it is done. */
function providerLog(command: string | null = PG_RESTORE): LogEntry[] {
    second = 0;
    return [
        line("Initializing", "Starting restore of inventory for Acme out of Lab_PostgreSQL_18_to_Local_2026-10-17_11-38-14.tar"),
        line("Initializing", "Initiating restore process..."),
        done("Initializing", 14),
        line("Downloading", `Reading backup metadata: ${ARCHIVE}...`),
        line("Downloading", "Detected seekable (v2) archive."),
        line("Downloading", "Compatibility Check: Backup Version [18.6] vs Target [18.6]"),
        line("Downloading", "Reading directly from the archive - no full download needed.", "success"),
        line("Downloading", "Archive opened with ranged reads - only the selected entries will be transferred."),
        done("Downloading", 427),
        line("Restoring Databases", "Target server version: 18.6"),
        line("Restoring Databases", "Preparing target database(s): inventory..."),
        line("Restoring Databases", "Fetching dump for 'inventory' (ranged read)..."),
        line("Restoring Databases", "Restoring database: inventory → inventory"),
        line("Restoring Databases", "Restoring to database: inventory", "info", "command", command ?? undefined),
        line("Restoring Databases", "pg_restore: connecting to database for restore"),
        line("Restoring Databases", "pg_restore: dropping TABLE public.items"),
        line("Restoring Databases", "pg_restore: creating TABLE public.items"),
        line("Restoring Databases", "Database restored: inventory", "success"),
        line("Restoring Databases", "Restore completed successfully.", "success"),
        done("Restoring Databases", 1_602),
    ];
}

const database = (overrides: Partial<RestoredDatabase> = {}): RestoredDatabase => ({
    name: "inventory", target: "inventory", state: "done", bytes: 5_632,
    startedAt: "2026-10-17T18:12:11.000Z", endedAt: "2026-10-17T18:12:12.000Z", percent: null, detail: null, ...overrides,
});

const record = (overrides: Partial<RestoreRecord> = {}): RestoreRecord => ({
    from: { name: "Local", adapterId: "local-filesystem" }, archive: ARCHIVE, ranged: true, read: 5_632,
    backupVersion: "18.6", targetVersion: "18.6", databases: [database()], folders: [], ...overrides,
});

function input(entries: LogEntry[], overrides: Partial<RestoreSummaryInput> = {}): RestoreSummaryInput {
    const live = overrides.live ?? false;
    return {
        entries,
        steps: buildSteps(entries, { type: "Restore", status: live ? "Running" : "Success", currentStage: null, now: 0, usual: new Map() }),
        record: record(),
        target: { name: "Lab PostgreSQL 18", adapterId: "postgres" },
        customer: null,
        shared: false,
        live,
        now: Date.parse("2026-10-17T18:13:00.000Z"),
        ...overrides,
    };
}

const told = (summary: ReturnType<typeof buildRestoreSummary>, step: string) => summary.find((entry) => entry.step === step)!;

describe("the summary of a restore", () => {
    it("says what it restores for whom out of which archive onto which server", () => {
        const summary = buildRestoreSummary(input(providerLog(), { customer: "Acme" }));
        expect(told(summary, "Initializing")).toMatchObject({
            text: "Restores inventory for Acme from {file} onto Lab PostgreSQL 18, engine 18.6.",
            file: "Lab_PostgreSQL_18_to_Local_2026-10-17_11-38-14.tar",
        });
    });

    it("tells where it read from and how much, with a row for that destination holding its lines", () => {
        const downloading = told(buildRestoreSummary(input(providerLog())), "Downloading");
        expect(downloading.text).toBe(`Read only the dump of inventory from the archive at Local, ${formatBytes(5_632)}, without a full download. The backup is of version 18.6, the same as the target.`);
        expect(downloading.items).toEqual([expect.objectContaining({ label: "Local", adapterId: "local-filesystem", state: "done", text: `read ${formatBytes(5_632)} in 427ms` })]);
        expect(downloading.items[0].outputs[0].lines.map((entry) => entry.message)).toContain("Detected seekable (v2) archive.");
    });

    it("gives every database a row with where it went, its size, its time, its command and the lines of its tool", () => {
        const restoring = told(buildRestoreSummary(input(providerLog())), "Restoring Databases");
        expect(restoring).toMatchObject({ text: "Restored inventory with {tool}.", tool: "pg_restore" });
        const [row] = restoring.dumps;
        expect(row).toMatchObject({ name: "inventory", target: "inventory", state: "done", bytes: 5_632, durationMs: 1_000, command: PG_RESTORE, note: null });
        expect(row.outputs).toEqual([expect.objectContaining({ source: "pg_restore" })]);
        expect(row.outputs[0].lines).toHaveLength(3);
    });

    it("names neither the archive nor the destination in a customer's run, and says why its command is missing", () => {
        const summary = buildRestoreSummary(input(providerLog(null), { record: record({ from: null, archive: null }), shared: true }));
        expect(told(summary, "Initializing")).toMatchObject({ text: "Restores inventory from its backup onto Lab PostgreSQL 18, engine 18.6.", file: null });
        const downloading = told(summary, "Downloading");
        expect(downloading.text).toBe(`Read only the dump of inventory, ${formatBytes(5_632)}, without a full download. The backup is of version 18.6, the same as the target.`);
        expect(downloading.items).toEqual([]);
        const [row] = told(summary, "Restoring Databases").dumps;
        expect(row.command).toBeNull();
        expect(row.note).toMatch(/names the server/);
        expect(row.outputs[0].lines).toHaveLength(3);
    });

    it("says which databases were not restored, with the error in their row, and which folders are not complete", () => {
        second = 0;
        const entries = [
            line("Initializing", "Initiating restore process..."),
            done("Initializing", 21),
            line("Downloading", "Archive opened with ranged reads - only the selected entries will be transferred."),
            done("Downloading", 1_000),
            line("Restoring Databases", "Fetching dump for 'shop' (ranged read)..."),
            line("Restoring Databases", "Restoring database: shop → shop_test"),
            line("Restoring Databases", "Database restored: shop_test", "success"),
            line("Restoring Databases", "Fetching dump for 'crm' (ranged read)..."),
            line("Restoring Databases", "Restoring database: crm → crm"),
            line("Restoring Databases", "ERROR 1044 (42000): Access denied for user 'dbackup'@'%' to database 'crm'", "error"),
            line("Restoring Databases", "Failed to restore database 'crm': Access denied", "error"),
            done("Restoring Databases", 6_000),
            line("Restoring Files", "Directory 'uploads': restoring 3 of 3 file(s) to Local:/srv/www/uploads", "info", "storage"),
            line("Restoring Files", "Failed to restore 'c.png' to Local:/srv/www/uploads: disk full", "error", "storage"),
            line("Restoring Files", "Directory 'uploads': 2 of 3 entr(ies) restored, 1 failed", "error", "storage"),
            done("Restoring Files", 2_000),
        ];
        const summary = buildRestoreSummary(input(entries, {
            target: { name: "Lab MySQL 8.0", adapterId: "mysql" },
            record: record({
                from: { name: "Lab WebDAV", adapterId: "webdav" }, archive: "a.tar", read: 9_000_000, backupVersion: null, targetVersion: "8.0.39",
                databases: [database({ name: "shop", target: "shop_test" }), database({ name: "crm", target: "crm", state: "failed" })],
                folders: [{ id: "src-1", label: "uploads", target: "Local:/srv/www/uploads", adapterId: "local-filesystem", state: "partial", files: 2, total: 3, failed: 1, skipped: 0, bytes: 20, totalBytes: 30, startedAt: null, endedAt: null }],
            }),
        }));

        expect(told(summary, "Initializing").text).toBe("Restores shop and crm and the folder uploads from {file} onto Lab MySQL 8.0, engine 8.0.39. shop goes to shop_test.");
        expect(told(summary, "Downloading").text).toBe(`Read the 2 dumps and the files of 1 folder from the archive at Lab WebDAV, ${formatBytes(9_000_000)}, without a full download.`);
        const restoring = told(summary, "Restoring Databases");
        expect(restoring.text).toBe("Restored 1 of 2 databases. crm was not restored.");
        expect(restoring.dumps[1]).toMatchObject({ name: "crm", state: "failed" });
        expect(restoring.dumps[1].errors[0]).toMatch(/Access denied for user/);
        const files = told(summary, "Restoring Files");
        expect(files.text).toBe("Restored 2 of 3 files of the folder uploads. uploads is not complete.");
        expect(files.items[0]).toMatchObject({ label: "uploads → Local:/srv/www/uploads", state: "warning", text: "2 of 3 files, 1 failed" });
        expect(files.items[0].outputs[0].lines).toHaveLength(3);
    });

    it("tells a folder restored whole with where its files went", () => {
        second = 0;
        const entries = [line("Restoring Files", "Directory restored: uploads (1204 file(s))", "success", "storage"), done("Restoring Files", 2_000)];
        const summary = buildRestoreSummary(input(entries, {
            record: record({ databases: [], folders: [{ id: "src-1", label: "uploads", target: "Local:/srv/www/uploads", adapterId: "local-filesystem", state: "done", files: 1_204, total: 1_204, failed: 0, skipped: 0, bytes: 2_048, totalBytes: 2_048, startedAt: "2026-10-17T18:12:00.000Z", endedAt: "2026-10-17T18:12:02.000Z" }] }),
        }));
        const files = told(summary, "Restoring Files");
        expect(files.text).toBe("Restored the folder uploads with 1,204 files to Local:/srv/www/uploads.");
        expect(files.items[0].text).toBe(`1,204 files · ${formatBytes(2_048)} · 2s`);
    });

    it("fills the row of the database it restores now and lets the next one wait", () => {
        second = 0;
        const entries = [
            done("Initializing", 20),
            done("Downloading", 2_000),
            line("Restoring Databases", "Fetching dump for 'inventory' (ranged read)..."),
            line("Restoring Databases", "Database restored: inventory", "success"),
            line("Restoring Databases", "Fetching dump for 'shop' (ranged read)..."),
        ];
        const summary = buildRestoreSummary(input(entries, {
            live: true,
            record: record({ databases: [database(), database({ name: "shop", target: "shop", state: "restoring", endedAt: null, percent: 42, detail: "14 MB of 33 MB" }), database({ name: "crm", target: "crm", state: "waiting", startedAt: null, endedAt: null })] }),
        }));
        const restoring = told(summary, "Restoring Databases");
        expect(restoring.text).toBe("Restores 3 databases, 1 done.");
        expect(restoring.dumps.map((dump) => dump.state)).toEqual(["done", "dumping", "waiting"]);
        expect(restoring.dumps[1].progress).toMatchObject({ share: 0.42, exact: true, text: "14 MB of 33 MB" });
    });

    it("warns when the backup is of a newer version than the server, and tells a backup fetched in full", () => {
        const summary = buildRestoreSummary(input(providerLog(), { record: record({ ranged: false, read: 120 * 1_048_576, backupVersion: "18.6", targetVersion: "17.2" }) }));
        expect(told(summary, "Downloading").text).toBe(`Fetched the backup from Local once in full, ${formatBytes(120 * 1_048_576)}. The backup is of version 18.6, newer than the target 17.2, which may fail.`);
        expect(told(summary, "Downloading").items[0].text).toBe(`fetched ${formatBytes(120 * 1_048_576)} in 427ms`);
    });

    it("still gives a restore from before the record a row for every database out of its log", () => {
        const summary = buildRestoreSummary(input(providerLog(), { record: null }));
        expect(told(summary, "Restoring Databases").dumps).toEqual([expect.objectContaining({ name: "inventory", target: "inventory", state: "done", bytes: null, command: PG_RESTORE })]);
        // Without a record its other steps say their last line, as before.
        expect(told(summary, "Downloading").text).toBe("Archive opened with ranged reads - only the selected entries will be transferred.");
    });

    it("reads a record from the metadata of a run and leaves out what it does not know", () => {
        expect(restoreRecordOf(null)).toBeNull();
        expect(restoreRecordOf({ ranged: true, read: 10, databases: [{ name: "shop", state: "done" }, { name: 3 }], folders: [{ id: "a", label: "x", state: "odd" }] })).toMatchObject({
            from: null, archive: null, ranged: true, read: 10, databases: [expect.objectContaining({ name: "shop", target: "shop", state: "done" })], folders: [],
        });
    });
});
