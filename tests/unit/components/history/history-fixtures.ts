import { vi } from "vitest";
import type { RunDetail, RunPage, RunRow } from "@/services/history/run-types";
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
                { at: ago(6.09), level: "info", type: "command", message: "pg_dump --format=custom --dbname=shop" },
                { at: ago(6.05), level: "warning", type: "general", message: "pg_dump: warning: there are circular foreign-key constraints on this table: orders", problem: "p2" },
            ] },
            { name: "Uploading", state: "failed", startedAt: ago(6.02), durationMs: 170_000, usualMs: 150_000, errors: 1, warnings: 2, lines: [
                { at: ago(6.02), level: "info", type: "storage", message: "[NAS Backups] Upload complete: Shop offsite/a.tar" },
                { at: ago(6.01), level: "warning", type: "storage", message: "[Google Drive] 403 on part 9 of 18, trying again in 5 s", problem: "p1" },
                { at: ago(6.005), level: "warning", type: "storage", message: "[Google Drive] 403 on part 9 of 18, trying again in 10 s", problem: "p1" },
                { at: ago(6), level: "error", type: "storage", message: "[Google Drive] Upload FAILED: 403 The user's Drive storage quota has been exceeded.", problem: "p1" },
            ] },
        ],
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
