import { vi } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import type { BackupRun, ExplorerDestination, ExplorerFile, ExplorerIndex, ExplorerJob } from "@/services/storage/explorer-types";

/**
 * Three jobs at two destinations for the tests of the Storage Explorer: a database job with a copy
 * missing at the offline Cloudflare R2, an incremental chain of folders, and a deleted job whose
 * backups stay at the NAS.
 */
export const now = Date.now();
export const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

export function destination(id: string, name: string, overrides: Partial<ExplorerDestination> = {}): ExplorerDestination {
    return {
        id,
        name,
        adapterId: "local-filesystem",
        listedAt: hoursAgo(0.5),
        listError: null,
        listing: false,
        health: { status: "ONLINE", checkedAt: hoursAgo(0), error: null, latencyMs: 12, answeredAt: null },
        count: 3,
        size: 300,
        growth: null,
        alerts: {
            usageSpike: { enabled: false, percent: 50, active: false },
            storageLimit: { enabled: false, bytes: 0, active: false },
            missingBackup: { enabled: false, hours: 48, active: false },
        },
        ...overrides,
    };
}

export function job(overrides: Partial<ExplorerJob>): ExplorerJob {
    return {
        key: "job-shop",
        kind: "job",
        name: "Shop nightly",
        jobId: "job-shop",
        sourceType: "postgres",
        sourceName: "Shop",
        hasFolders: false,
        incremental: false,
        configuredDestinationIds: ["nas", "r2"],
        destinationIds: ["nas", "r2"],
        runs: 2,
        size: 400,
        newest: hoursAgo(3),
        oldest: hoursAgo(27),
        failedChecks: 0,
        missingCopies: 1,
        locked: 0,
        retention: {},
        ...overrides,
    };
}

export function file(name: string, hours: number, overrides: Partial<ExplorerFile> = {}): ExplorerFile {
    return {
        name,
        path: `Shop nightly/${name}`,
        size: 100,
        lastModified: hoursAgo(hours),
        createdAt: hoursAgo(hours),
        jobId: "job-shop",
        jobName: "Shop nightly",
        sourceName: "Shop",
        sourceType: "postgres",
        databases: ["shop", "billing"],
        backupType: "full",
        trigger: { type: "Scheduler" },
        ...overrides,
    };
}

export const newest = file("Shop_nightly_newest.tar", 3, { verification: { verifiedAt: hoursAgo(2.9), passed: true, trigger: "post-upload" } });
export const older = file("Shop_nightly_older.tar", 27, { trigger: { type: "Manual", actor: "Manu" } });
export const erp = file("ERP_invoices_old.tar", 500, { path: "ERP/ERP_invoices_old.tar", jobId: "job-erp", jobName: "ERP invoices", databases: ["erp"] });
export const erpOlder = file("ERP_invoices_older.tar", 524, { path: "ERP/ERP_invoices_older.tar", jobId: "job-erp", jobName: "ERP invoices", databases: ["erp"], trigger: { type: "Api", actor: "Deploy hook" } });

export const chainFile = (index: number, hours: number) =>
    file(`${index === 0 ? "full-000" : `inc-00${index}`}-Media_sync.tar`, hours, {
        path: `Media sync/chain-1/${index === 0 ? "full-000" : `inc-00${index}`}-Media_sync.tar`,
        jobId: "job-media",
        jobName: "Media sync",
        sourceType: "directory-only",
        databases: undefined,
        combined: { databases: 0, directorySources: 2 },
        backupType: index === 0 ? "full" : "incremental",
        chain: { id: "chain-1", type: index === 0 ? "full" : "incremental", index },
        size: index === 0 ? 8_000 : 100,
        logicalSize: 8_000 + index * 100,
    });
export const chain = [chainFile(0, 72), chainFile(1, 48), chainFile(2, 24), chainFile(3, 1)];
export const media = job({ key: "job-media", name: "Media sync", jobId: "job-media", sourceType: null, hasFolders: true, incremental: true, configuredDestinationIds: ["nas"], destinationIds: ["nas"], runs: 4, newest: hoursAgo(1) });

export const index: ExplorerIndex = {
    destinations: [destination("nas", "NAS Backups"), destination("r2", "Cloudflare R2", { health: { status: "OFFLINE", checkedAt: hoursAgo(0), error: "timeout", latencyMs: 10_000, answeredAt: hoursAgo(1) } })],
    jobs: [
        job({}),
        media,
        job({ key: "deleted:job-erp", kind: "deleted", name: "ERP invoices", jobId: "job-erp", configuredDestinationIds: [], destinationIds: ["nas"], newest: hoursAgo(500), runs: 2, missingCopies: 0 }),
    ],
};

export const stored = (entry: ExplorerFile, destinationId = "nas") => ({ destinationId, state: "stored" as const, file: entry });
export const run = (entry: ExplorerFile, jobKey: string, copies: BackupRun["copies"]): BackupRun => ({ path: entry.path, jobKey, file: entry, createdAt: entry.createdAt!, copies });

export const runs: BackupRun[] = [
    run(chain[3], "job-media", [stored(chain[3])]),
    run(newest, "job-shop", [stored(newest), stored(newest, "r2")]),
    run(chain[2], "job-media", [stored(chain[2])]),
    run(older, "job-shop", [stored(older), { destinationId: "r2", state: "missing" }]),
    run(chain[1], "job-media", [stored(chain[1])]),
    run(chain[0], "job-media", [stored(chain[0])]),
    run(erp, "deleted:job-erp", [stored(erp)]),
    run(erpOlder, "deleted:job-erp", [stored(erpOlder)]),
];

export const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data }) } as Response);
/** A backup the way the timeline names it, in the formats of the signed in user. */
export const shown = (entry: ExplorerFile) => at(entry.createdAt!);
/** A moment in the formats of the signed in user. */
export function at(iso: string) {
    return formatInTimeZone(new Date(iso), "UTC", "yyyy-MM-dd HH:mm");
}

/** jsdom measures nothing, so a timeline gets a width of its own. */
export function measureTimeline() {
    vi.stubGlobal("ResizeObserver", class {
        report: (entries: { contentRect: { width: number } }[]) => void;
        constructor(report: (entries: { contentRect: { width: number } }[]) => void) {
            this.report = report;
        }
        observe() {
            this.report([{ contentRect: { width: 1200 } }]);
        }
        unobserve() {}
        disconnect() {}
    });
}
