import { vi } from "vitest";
import type { RunDetail, RunDump, RunPage, RunRow, RunStepSummary } from "@/services/history/run-types";
import type { NotificationLogRow } from "@/components/dashboard/history/notification-types";

const HOUR = 3_600_000;
export const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

const schedule = { key: "schedule", kind: "schedule" as const, label: "Schedule" };

export function row(overrides: Partial<RunRow> = {}): RunRow {
    return {
        id: "offsite",
        type: "Backup",
        status: "Partial",
        name: "Shop offsite",
        sub: "Backup · shop, billing",
        adapterId: "postgres",
        jobId: "job-offsite",
        startedAt: ago(6),
        endedAt: ago(5.9),
        durationMs: 432_000,
        usualMs: 410_000,
        size: 2_200_000_000,
        copies: { stored: 1, total: 2, failed: ["Google Drive"] },
        note: "Google Drive failed",
        live: null,
        starter: schedule,
        ...overrides,
    };
}

export const runPage: RunPage = {
    rows: [
        row({ id: "crm", name: "CRM daily", sub: "Backup · crm", status: "Running", adapterId: "mysql", jobId: "job-crm", endedAt: null, durationMs: null, copies: null, note: "Uploading, 64 %", live: { stage: "Uploading", percent: 64, detail: null } }),
        row(),
        row({ id: "integrity", type: "IntegrityCheck", name: "Integrity check", sub: "System task · the checksums of the backups", status: "Success", adapterId: null, jobId: null, copies: null, note: null, size: null }),
    ],
    total: 3,
    facets: {
        type: { Backup: 2, IntegrityCheck: 1 },
        status: { Running: 1, Partial: 1, Success: 1 },
        job: { "job-crm": 1, "job-offsite": 1 },
        starter: { schedule: 3 },
    },
    jobs: [{ id: "job-crm", name: "CRM daily", adapterId: "mysql" }, { id: "job-offsite", name: "Shop offsite", adapterId: "postgres" }],
    starters: [{ value: "schedule", label: "Schedule", group: "System" }],
    stats: { total: 120, succeeded: 110, failed: 4, lastFailed: { name: "Shop nightly", at: ago(7) }, partial: 6, lastPartial: { name: "Shop offsite", at: ago(6) }, running: ["CRM daily"], queued: [] },
};

export const notifications: NotificationLogRow[] = [
    { id: "n-discord", eventType: "backup_partial", channelName: "Discord #ops", adapterId: "discord", status: "Success", title: "Backup partial: Shop offsite", message: "1 of 2 copies stored.", executionId: "offsite", sentAt: ago(6) },
    { id: "n-telegram", eventType: "backup_partial", channelName: "Telegram Manu", adapterId: "telegram", status: "Failed", title: "Backup partial: Shop offsite", message: "1 of 2 copies stored.", error: "403 Forbidden: bot was blocked by the user", executionId: "offsite", sentAt: ago(6) },
];

const problems: RunDetail["problems"] = [
    { id: "p1", tone: "error", title: "Google Drive is full", raw: "403 The user's Drive storage quota has been exceeded.", step: "Uploading", subject: "Google Drive", at: ago(6), tries: [ago(6.01), ago(6.005), ago(6)], help: "Free space there, or give Shop offsite another destination.", actions: [{ kind: "destination", id: "drive", label: "Open destination" }, { kind: "job", label: "Open job" }] },
    { id: "p2", tone: "warning", title: "Circular foreign keys in orders", raw: "pg_dump: warning: there are circular foreign-key constraints on this table: orders", step: "Dumping Databases", subject: "Shop cluster", at: ago(6.05), tries: [], help: "Nothing is missing from the dump.", actions: [] },
];

const PG_DUMP = "pg_dump -h db.internal -p 5432 -U backup -F c -Z 6 -d shop";

const dump = (overrides: Partial<RunDump>): RunDump => ({
    name: "shop", state: "done", bytes: 1_400_000_000, durationMs: 120_000, startedAt: ago(6.09), facts: null, lastBytes: null,
    command: null, outputs: [], warnings: [], errors: [], progress: null, ...overrides,
});

const offsiteSummary: RunStepSummary[] = [
    { step: "Initializing", text: "Found shop and billing on Shop cluster, engine 16.4.", tool: null, dumps: [], items: [], checksum: null, now: null },
    {
        step: "Dumping Databases", text: "Dumped shop and billing with {tool}.", tool: "pg_dump", items: [], checksum: null, now: null,
        dumps: [
            dump({ command: PG_DUMP, warnings: [{ title: "Circular foreign keys in orders", count: 1, raw: "pg_dump: warning: there are circular foreign-key constraints on this table: orders", help: "Nothing is missing from the dump." }] }),
            dump({ name: "billing", bytes: 800_000_000, durationMs: 70_000 }),
        ],
    },
    {
        step: "Uploading", text: "Stored the archive at 1 of 2 destinations.", tool: null, dumps: [], now: null,
        checksum: "c5bc45b2a5ae65e4d9801b19d24c05d1109c7152da5568c51869e5b4f654650d",
        items: [
            { key: "nas", label: "NAS Backups", adapterId: "sftp", state: "done", text: "stored in 1m 12s", outputs: [{ source: "NAS Backups", lines: [{ at: ago(6.02), level: "info", type: "storage", message: "Upload complete: Shop offsite/a.tar" }] }] },
            { key: "drive", label: "Google Drive", adapterId: "google-drive", state: "failed", text: "403 quota", outputs: [] },
        ],
    },
];

export function detail(overrides: Partial<RunDetail> = {}): RunDetail {
    return {
        ...row(),
        job: { id: "job-offsite", name: "Shop offsite" },
        path: "Shop offsite/a.tar",
        backupType: null,
        logsPurgedAt: null,
        databases: ["shop", "billing"],
        steps: [
            { name: "Initializing", state: "done", startedAt: ago(6.1), durationMs: 800, usualMs: 900, errors: 0, warnings: 0, lines: [{ at: ago(6.1), level: "info", type: "general", message: "Started by the schedule" }] },
            { name: "Dumping Databases", state: "warning", startedAt: ago(6.09), durationMs: 190_000, usualMs: 182_000, errors: 0, warnings: 1, lines: [
                { at: ago(6.09), level: "info", type: "general", message: "Dumping database: shop" },
                { at: ago(6.09), level: "info", type: "command", message: "Dumping database: shop", details: PG_DUMP },
                { at: ago(6.05), level: "warning", type: "general", message: "pg_dump: warning: there are circular foreign-key constraints on this table: orders", problem: "p2" },
            ] },
            { name: "Uploading", state: "failed", startedAt: ago(6.02), durationMs: 170_000, usualMs: 150_000, errors: 1, warnings: 2, lines: [
                { at: ago(6.02), level: "info", type: "storage", message: "[NAS Backups] Upload complete: Shop offsite/a.tar" },
                { at: ago(6.01), level: "warning", type: "storage", message: "[Google Drive] 403 on part 9 of 18, trying again in 5 s", problem: "p1" },
                { at: ago(6.005), level: "warning", type: "storage", message: "[Google Drive] 403 on part 9 of 18, trying again in 10 s", problem: "p1" },
                { at: ago(6), level: "error", type: "storage", message: "[Google Drive] Upload FAILED: 403 The user's Drive storage quota has been exceeded.", problem: "p1" },
            ] },
        ],
        summary: offsiteSummary,
        checks: null,
        problems,
        uploads: [
            { configId: "nas", name: "NAS Backups", adapterId: "sftp", state: "done", bytes: 2_200_000_000, total: 2_200_000_000, error: null, startedAt: null, endedAt: null },
            { configId: "drive", name: "Google Drive", adapterId: "google-drive", state: "failed", bytes: null, total: 2_200_000_000, error: "403 quota", startedAt: null, endedAt: null },
        ],
        notifications: [{ id: "n-discord", channelId: "discord", channelName: "Discord #ops", adapterId: "discord", status: "Success", error: null, title: "Backup partial", sentAt: ago(6) }],
        recent: [
            { id: "offsite", startedAt: ago(6), status: "Partial", durationMs: 432_000, size: 2_200_000_000, starter: schedule },
            { id: "offsite-before", startedAt: ago(174), status: "Success", durationMs: 400_000, size: 2_100_000_000, starter: schedule },
        ],
        previous: { id: "offsite-before", startedAt: ago(174), status: "Success", durationMs: 400_000, size: 2_100_000_000, starter: schedule },
        next: null,
        queue: [],
        ...overrides,
    };
}

export const liveDetail = () => detail({
    id: "crm",
    name: "CRM daily",
    status: "Running",
    adapterId: "mysql",
    endedAt: null,
    durationMs: null,
    usualMs: 144_000,
    live: { stage: "Uploading", percent: 70, detail: null },
    job: { id: "job-crm", name: "CRM daily" },
    problems: [],
    steps: [
        { name: "Dumping Databases", state: "done", startedAt: ago(0.03), durationMs: 48_000, usualMs: 50_000, errors: 0, warnings: 0, lines: [{ at: ago(0.03), level: "success", type: "general", message: "Dumped crm" }] },
        { name: "Uploading", state: "running", startedAt: ago(0.01), durationMs: null, usualMs: 65_000, errors: 0, warnings: 0, lines: [{ at: ago(0.01), level: "info", type: "storage", message: "[NAS Backups] Upload complete" }] },
        { name: "Verifying", state: "pending", startedAt: null, durationMs: null, usualMs: 4_000, errors: 0, warnings: 0, lines: [] },
    ],
    uploads: [
        { configId: "nas", name: "NAS Backups", adapterId: "sftp", state: "done", bytes: 61, total: 61, error: null, startedAt: null, endedAt: null },
        { configId: "r2", name: "Cloudflare R2", adapterId: "s3-r2", state: "uploading", bytes: 39 * 1_048_576, total: 61 * 1_048_576, error: null, startedAt: null, endedAt: null },
    ],
    notifications: [],
    queue: [{ id: "waiting", name: "Shop nightly", starter: { key: "manual:Manu", kind: "manual", label: "Manu" } }],
    summary: [
        { step: "Dumping Databases", text: "Dumped crm with {tool}.", tool: "mysqldump", dumps: [dump({ name: "crm", bytes: 820 * 1_048_576, durationMs: 48_000 })], items: [], checksum: null, now: null },
        {
            step: "Uploading", text: "Stores the archive at each destination, one after the other.", tool: null, dumps: [], checksum: null, now: null,
            items: [
                { key: "nas", label: "NAS Backups", adapterId: "sftp", state: "done", text: "stored in 12s", outputs: [] },
                { key: "r2", label: "Cloudflare R2", adapterId: "s3-r2", state: "running", text: "64 %", outputs: [{ source: "Cloudflare R2", lines: [{ at: ago(0.01), level: "info", type: "storage", message: "Multipart upload: 8 parallel parts of 5 MB" }] }] },
            ],
        },
    ],
});

/** A MongoDB backup while it dumps its second database, which mongodump counts by document. */
export const dumpingDetail = () => detail({
    id: "mongo",
    name: "MSSQL-Bug",
    status: "Running",
    adapterId: "mongodb",
    endedAt: null,
    durationMs: null,
    usualMs: 104_000,
    live: { stage: "Dumping Databases", percent: 40, detail: null },
    job: { id: "job-mongo", name: "MSSQL-Bug" },
    problems: [],
    uploads: [{ configId: "local", name: "Local", adapterId: "local-filesystem", state: "waiting", bytes: null, total: null, error: null, startedAt: null, endedAt: null }],
    notifications: [],
    queue: [],
    steps: [
        { name: "Initializing", state: "done", startedAt: ago(0.02), durationMs: 26, usualMs: 49, errors: 0, warnings: 0, lines: [{ at: ago(0.02), level: "info", type: "general", message: "Databases to dump: testdb, testdb1" }] },
        { name: "Dumping Databases", state: "running", startedAt: ago(0.02), durationMs: null, usualMs: 99_000, errors: 0, warnings: 0, lines: [
            { at: ago(0.01), level: "info", type: "general", message: "Dumping database: testdb1" },
            { at: ago(0.01), level: "info", type: "command", message: "Dumping database: testdb1", details: "mongodump --host localhost --port 27708 --db testdb1 --archive=/tmp/0002.archive --gzip" },
            { at: ago(0.005), level: "info", type: "general", message: "[mongodump] 2026-09-27T17:01:37.030+0200\t[########................]  testdb1.stress_data  526527/1500000  (35.1%)" },
        ] },
        { name: "Processing", state: "pending", startedAt: null, durationMs: null, usualMs: 2_000, errors: 0, warnings: 0, lines: [] },
    ],
    summary: [
        { step: "Initializing", text: "Found testdb and testdb1 on Test MongoDB 8.0, engine 8.0.20.", tool: null, dumps: [], items: [], checksum: null, now: null },
        {
            step: "Dumping Databases", text: "Dumps testdb and testdb1 one after the other with {tool}.", tool: "mongodump", items: [], checksum: null, now: null,
            dumps: [
                dump({ name: "testdb", facts: "2 collections · 1,500,001 documents", bytes: 890 * 1_048_576, durationMs: 52_000 }),
                dump({
                    name: "testdb1", state: "dumping", bytes: null, durationMs: 18_000,
                    command: "mongodump --host localhost --port 27708 --db testdb1 --archive=/tmp/0002.archive --gzip",
                    outputs: [{ source: "mongodump", lines: [{ at: ago(0.005), level: "info", type: "general", message: "[########................]  testdb1.stress_data  526527/1500000  (35.1%)" }] }],
                    progress: { share: 0.351, exact: true, text: "526,527 of 1,500,000 documents", part: "stress_data", etaMs: 40_000 },
                }),
            ],
        },
    ],
});

/** An integrity check while it downloads a copy to hash it, one copy that differs found so far. */
export const integrityDetail = () => detail({
    id: "integrity",
    type: "IntegrityCheck",
    name: "Integrity check",
    sub: "System task · the checksums of the backups",
    status: "Running",
    adapterId: null,
    jobId: null,
    job: null,
    endedAt: null,
    durationMs: null,
    usualMs: 360_000,
    live: { stage: "Verifying Checksums", percent: 45, detail: null },
    databases: [],
    problems: [],
    uploads: [],
    notifications: [],
    queue: [],
    summary: [],
    steps: [{ name: "Verifying Checksums", state: "running", startedAt: ago(0.05), durationMs: null, usualMs: 300_000, errors: 1, warnings: 0, lines: [{ at: ago(0.04), level: "error", type: "general", message: "a.tar - checksum mismatch" }] }],
    recent: [],
    previous: null,
    checks: {
        total: 5,
        backup: null,
        destinations: [
            { id: "nas", name: "NAS Backups", adapterId: "sftp", total: 3, checked: 2, passed: 1, differ: 1, skipped: 0, native: false },
            { id: "r2", name: "Cloudflare R2", adapterId: "s3-r2", total: 2, checked: 1, passed: 1, differ: 0, skipped: 0, native: true },
        ],
        copies: [
            { destinationId: "nas", file: "Shop nightly/a.tar", size: 104_000_000, state: "passed", method: "download", processed: null, total: null, reason: null, expected: null, actual: null },
            { destinationId: "nas", file: "CRM daily/b.tar", size: 61_000_000, state: "failed", method: "download", processed: null, total: null, reason: null, expected: "91ac07d32e10", actual: "0b7f55e1c9d4" },
            { destinationId: "r2", file: "CRM daily/b.tar", size: 61_000_000, state: "passed", method: "native", processed: null, total: null, reason: null, expected: null, actual: null },
            { destinationId: "nas", file: "Wiki weekly/c.tar", size: 52_000_000, state: "checking", method: "download", processed: 32_500_000, total: 52_000_000, reason: null, expected: null, actual: null },
        ],
    },
});

export const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

export function serve({ run = detail(), page = runPage }: { run?: RunDetail | null; page?: RunPage } = {}) {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
        if (url === "/api/history/counts") return json({ success: true, data: { runs: 1284, notifications: 3402 } });
        if (url.startsWith("/api/history/runs?")) return json({ success: true, data: page });
        if (url.startsWith("/api/history/runs/")) {
            if (!run) return json({ success: false, error: "This run could not be found." }, 404);
            if (url.includes("row=1")) return json({ success: true, data: row() });
            return json({ success: true, data: run });
        }
        if (url.startsWith("/api/notification-logs?executionId=")) return json({ data: notifications, total: 2 });
        if (url.startsWith("/api/notification-logs?")) {
            return json({
                data: notifications, total: 2, page: 1, pageSize: 25,
                facets: { adapterId: {}, status: { Success: 1, Failed: 1 }, channelName: { "Discord #ops": 1, "Telegram Manu": 1 }, eventType: { backup_partial: 2 } },
                stats: { sent: 3396, failed: 6, lastFailed: { channelName: "Telegram Manu", at: ago(6) }, channels: ["Discord #ops", "Telegram Manu"], events: 9 },
                options: { channels: [{ name: "Discord #ops", adapterId: "discord" }, { name: "Telegram Manu", adapterId: "telegram" }], events: ["backup_partial"] },
            });
        }
        return json({ success: false, error: `Unexpected ${url}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
}

/** Runs a check at the width of a phone, which gets the cards. */
export async function onPhone(check: () => Promise<void>) {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    try {
        await check();
    } finally {
        Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    }
}
