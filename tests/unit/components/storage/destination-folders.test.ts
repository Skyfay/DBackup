import { describe, expect, it } from "vitest";
import { foldersOf } from "@/components/dashboard/storage/explorer/destination-folders";
import type { DestinationBackup, ExplorerJob } from "@/services/storage/explorer-types";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function backup(jobKey: string, name: string, hours: number, overrides: Partial<DestinationBackup> = {}): DestinationBackup {
    return {
        jobKey,
        file: { name, path: `${jobKey}/${name}`, size: 100, lastModified: hoursAgo(hours), createdAt: hoursAgo(hours) },
        elsewhere: [],
        ...overrides,
    };
}

function job(key: string, name: string, kind: ExplorerJob["kind"]): ExplorerJob {
    return {
        key, kind, name, jobId: key, sourceType: "postgres", sourceName: "Shop", hasFolders: false, incremental: false,
        configuredDestinationIds: [], destinationIds: [], runs: 0, size: 0, newest: null, oldest: null, failedChecks: 0, missingCopies: 0, locked: 0,
    };
}

const jobs = new Map([
    ["shop", job("shop", "Shop nightly", "job")],
    ["billing", job("billing", "Billing", "job")],
    ["deleted:erp", job("deleted:erp", "ERP invoices", "deleted")],
]);

describe("folders of a destination", () => {
    it("puts the backups of each job in a folder of its own, the jobs that still run first", () => {
        const folders = foldersOf([
            backup("deleted:erp", "erp.tar", 500),
            backup("shop", "older.tar", 27),
            backup("none", "loose.tar", 5),
            backup("shop", "newest.tar", 3),
            backup("billing", "billing.tar", 10),
        ], jobs);

        expect(folders.map((folder) => folder.name)).toEqual(["Billing", "Shop nightly", "ERP invoices", "Without a job"]);
        const shop = folders[1];
        expect(shop.backups.map((entry) => entry.file.name)).toEqual(["newest.tar", "older.tar"]);
        expect(shop.size).toBe(200);
        expect(shop.newest).toBe(shop.backups[0].file.createdAt);
    });

    it("counts a destination as holding copies when any backup of the folder is there, and counts the copies missing", () => {
        const [folder] = foldersOf([
            backup("shop", "newest.tar", 3, { elsewhere: [{ destinationId: "r2", state: "stored" }, { destinationId: "s3", state: "missing" }] }),
            backup("shop", "older.tar", 27, { elsewhere: [{ destinationId: "r2", state: "missing" }, { destinationId: "s3", state: "missing" }] }),
        ], jobs);

        expect(folder.elsewhere).toEqual([{ destinationId: "r2", state: "stored" }, { destinationId: "s3", state: "missing" }]);
        expect(folder.missing).toBe(3);
    });
});
