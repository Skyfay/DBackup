import { describe, expect, it } from "vitest";
import type { LogEntry, LogLevel, LogType } from "@/lib/core/logs";
import { buildSteps } from "@/services/history/run-steps";
import { buildSummary, listOf, type SummaryInput } from "@/services/history/run-summary";
import type { RunUpload } from "@/services/history/run-types";

let second = 0;
const line = (stage: string, message: string, level: LogLevel = "info", type: LogType = "general", details?: string): LogEntry => ({
    timestamp: new Date(Date.UTC(2026, 8, 27, 15, 0, second++)).toISOString(), level, type, message, stage, ...(details ? { details } : {}),
});
const done = (stage: string, ms: number): LogEntry => ({ ...line(stage, `${stage} completed`, "success"), durationMs: ms });

/** The MongoDB backup of the dev database, as its log reads once it is done. */
function mongoLog(): LogEntry[] {
    second = 0;
    return [
        line("Initializing", "Initialization complete. Source: Test MongoDB 8.0, Destinations: [Local] (1)"),
        line("Initializing", "No databases selected - auto-discovering all databases..."),
        line("Initializing", "Databases to dump: testdb, testdb1"),
        line("Initializing", "Detected engine version: 8.0.20"),
        done("Initializing", 26),
        line("Dumping Databases", "Dumping database: testdb"),
        line("Dumping Databases", "Dumping database: testdb", "info", "command", "/usr/bin/mongodump --db testdb --gzip"),
        line("Dumping Databases", "[mongodump] 2026-09-27T17:00:27.415+0200\tdone dumping testdb.users (1 document)"),
        line("Dumping Databases", "Completed dump for: testdb", "success"),
        done("Dumping Databases", 102_000),
        line("Processing", "Creating archive with 1 database(s)..."),
        line("Processing", "Archive created successfully. Size: 1.78 GB", "success"),
        done("Processing", 2_000),
        line("Uploading", "SHA-256: c5bc45b2a5ae65e4d9801b19d24c05d1109c7152da5568c51869e5b4f654650d"),
        line("Uploading", "[Local] Starting upload..."),
        line("Uploading", "[Local] Upload complete: MSSQL-Bug/a.tar"),
        done("Uploading", 1_000),
        line("Verifying", "[Local] Verifying upload integrity..."),
        line("Verifying", "[Local] Integrity check passed", "success"),
        done("Verifying", 1_000),
        line("Applying Retention", "[Local] Retention: No policy configured. Skipping."),
        done("Applying Retention", 1),
    ];
}

const local = (overrides: Partial<RunUpload> = {}): RunUpload => ({
    configId: "local", name: "Local", adapterId: "local-filesystem", state: "done", bytes: 1, total: 1, error: null,
    startedAt: "2026-09-27T15:02:16.000Z", endedAt: "2026-09-27T15:02:18.000Z", ...overrides,
});

function input(entries: LogEntry[], overrides: Partial<SummaryInput> = {}): SummaryInput {
    const live = overrides.live ?? false;
    return {
        entries,
        steps: buildSteps(entries, { type: "Backup", status: live ? "Running" : "Success", currentStage: null, now: 0, usual: new Map() }),
        records: [], names: [], engineVersion: null, compression: null, encryption: null,
        uploads: [local()], notifications: [], sourceName: "Test MongoDB 8.0", folders: 0, size: null,
        previous: new Map(), detail: null, live, now: Date.parse("2026-09-27T15:03:00.000Z"),
        ...overrides,
    };
}

const told = (summary: ReturnType<typeof buildSummary>, step: string) => summary.find((entry) => entry.step === step)!;

describe("the summary of a run", () => {
    it("tells every step of a finished backup in a sentence, with the program it ran as a badge", () => {
        const summary = buildSummary(input(mongoLog(), { compression: "GZIP", encryption: "Production" }));

        expect(told(summary, "Initializing").text).toBe("Found testdb and testdb1 on Test MongoDB 8.0, engine 8.0.20. The job picks no databases, so it backs up every one it finds.");
        expect(told(summary, "Dumping Databases")).toMatchObject({ text: "Dumped testdb with {tool}.", tool: "mongodump" });
        expect(told(summary, "Dumping Databases").dumps.map((dump) => dump.name)).toEqual(["testdb"]);
        expect(told(summary, "Processing").text).toBe("Packed testdb into one archive of 1.78 GB, compressed with Gzip and encrypted with the key Production.");
        expect(told(summary, "Verifying").text).toBe("The copy at Local matches its checksum.");
        expect(told(summary, "Applying Retention")).toMatchObject({ text: "No retention policy, nothing was removed.", items: [expect.objectContaining({ label: "Local", text: "no policy, nothing removed" })] });
    });

    it("gives every destination its time and the lines it wrote, and the checksum the copies are checked against", () => {
        const uploading = told(buildSummary(input(mongoLog())), "Uploading");
        expect(uploading.text).toBe("Stored the archive at 1 destination.");
        expect(uploading.items).toEqual([expect.objectContaining({ label: "Local", state: "done", text: "stored in 2s" })]);
        expect(uploading.items[0].outputs[0].lines.map((entry) => entry.message)).toEqual(["Starting upload...", "Upload complete: MSSQL-Bug/a.tar"]);
        expect(uploading.checksum).toBe("c5bc45b2a5ae65e4d9801b19d24c05d1109c7152da5568c51869e5b4f654650d");
    });

    it("says what a live upload does and whom a destination waits for", () => {
        const entries = mongoLog().filter((entry) => !["Verifying", "Applying Retention"].includes(entry.stage!) && !(entry.stage === "Uploading" && entry.durationMs));
        const uploads = [local({ state: "uploading", bytes: 5, total: 10, endedAt: null }), local({ configId: "r2", name: "Cloudflare R2", state: "waiting", startedAt: null, endedAt: null })];
        const uploading = told(buildSummary(input(entries, { live: true, uploads })), "Uploading");

        expect(uploading.text).toBe("Stores the archive at each destination, one after the other.");
        expect(uploading.items.map((item) => [item.label, item.state, item.text])).toEqual([["Local", "running", "50 %"], ["Cloudflare R2", "waiting", "waits for Local"]]);
    });

    it("gives every folder its files, and a channel that failed its error", () => {
        second = 0;
        const entries = [
            line("Collecting Files", "[Photos] Starting collection...", "info", "storage"),
            line("Collecting Files", "[Photos] Collected 1200 file(s) and 3 symlink(s), 4.2 GB", "success", "storage"),
            done("Collecting Files", 60_000),
        ];
        const notifications = [{ id: "n1", channelId: "tg", channelName: "Telegram", adapterId: "telegram", status: "Failed" as const, error: "bot was blocked", title: "t", sentAt: "" }];
        const summary = buildSummary(input(entries, { uploads: [], notifications, steps: [
            { name: "Collecting Files", state: "done", startedAt: null, durationMs: 60_000, usualMs: null, errors: 0, warnings: 0, lines: [] },
            { name: "Sending Notifications", state: "failed", startedAt: null, durationMs: 1, usualMs: null, errors: 1, warnings: 0, lines: [] },
        ] }));

        expect(told(summary, "Collecting Files")).toMatchObject({ text: "Collected the files of 1 folder.", items: [expect.objectContaining({ label: "Photos", state: "done", text: "1200 files and 3 links, 4.2 GB" })] });
        expect(told(summary, "Sending Notifications")).toMatchObject({ text: "Sent to 0 of 1 channel.", items: [expect.objectContaining({ label: "Telegram", state: "failed", text: "bot was blocked" })] });
    });

    it("says the last line of a step it has no words of its own for", () => {
        second = 0;
        const entries = [line("Downloading", "Downloading a.tar from NAS"), line("Downloading", "Downloaded 2.1 GB", "success")];
        const summary = buildSummary(input(entries, { uploads: [], steps: [{ name: "Downloading", state: "done", startedAt: null, durationMs: 1, usualMs: null, errors: 0, warnings: 0, lines: [] }] }));
        expect(told(summary, "Downloading").text).toBe("Downloaded 2.1 GB");
    });

    it("names a few databases and counts the rest", () => {
        expect(listOf(["a"])).toBe("a");
        expect(listOf(["a", "b", "c"])).toBe("a, b and c");
        expect(listOf(["a", "b", "c", "d", "e", "f"])).toBe("a, b, c and 3 more");
    });
});
