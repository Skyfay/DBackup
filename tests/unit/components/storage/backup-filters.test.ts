import { describe, expect, it } from "vitest";
import { countBackups, filterBackups, primaryCopy, startedByKey, startedByOptions, summarize, targetsOf, type BackupFilters } from "@/components/dashboard/storage/explorer/backup-filters";
import type { BackupRun, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function file(name: string, hours: number, overrides: Partial<ExplorerFile> = {}): ExplorerFile {
    return { name, path: `backups/${name}`, size: 100, lastModified: hoursAgo(hours), createdAt: hoursAgo(hours), ...overrides };
}

function job(key: string, name: string, kind: ExplorerJob["kind"] = "job"): ExplorerJob {
    return {
        key, kind, name, jobId: key, sourceType: "postgres", sourceName: name, hasFolders: false, incremental: false,
        configuredDestinationIds: [], destinationIds: [], runs: 0, size: 0, newest: null, oldest: null, failedChecks: 0, missingCopies: 0, locked: 0,
    };
}

const jobs = new Map([
    ["shop", job("shop", "Shop nightly")],
    ["crm", job("crm", "CRM hourly")],
    ["deleted:erp", job("deleted:erp", "ERP invoices", "deleted")],
]);

const shopNew = file("shop-new.tar", 3, { verification: { verifiedAt: hoursAgo(2), passed: true, trigger: "post-upload" }, trigger: { type: "Scheduler" } });
const shopOld = file("shop-old.tar", 27, { locked: true, trigger: { type: "Manual", actor: "Manu" } });
const crm = file("crm.tar", 1, { size: 30, trigger: { type: "Api", actor: "Deploy hook" } });
const crmFailed = file("crm.tar", 1, { size: 30, verification: { verifiedAt: hoursAgo(1), passed: false, trigger: "post-upload" } });
const erp = file("erp.tar", 500, { size: 50 });

const runs: BackupRun[] = [
    { path: crm.path, jobKey: "crm", file: crm, createdAt: crm.createdAt!, copies: [{ destinationId: "nas", state: "stored", file: crm }, { destinationId: "r2", state: "stored", file: crmFailed }] },
    { path: shopNew.path, jobKey: "shop", file: shopNew, createdAt: shopNew.createdAt!, copies: [{ destinationId: "nas", state: "stored", file: shopNew }, { destinationId: "r2", state: "stored", file: shopNew }] },
    { path: shopOld.path, jobKey: "shop", file: shopOld, createdAt: shopOld.createdAt!, copies: [{ destinationId: "nas", state: "stored", file: shopOld }, { destinationId: "r2", state: "missing" }] },
    { path: erp.path, jobKey: "deleted:erp", file: erp, createdAt: erp.createdAt!, copies: [{ destinationId: "nas", state: "stored", file: erp }] },
];

const none: BackupFilters = { jobs: [], at: [], by: [], search: "", quick: "all" };
const paths = (list: BackupRun[]) => list.map((run) => run.file.name);

describe("the filters of the list of every backup", () => {
    it("keeps a backup whose copy is missing at the filtered destination, since that is what a look at it should find", () => {
        expect(paths(filterBackups(runs, { ...none, at: ["r2"] }, jobs))).toEqual(["crm.tar", "shop-new.tar", "shop-old.tar"]);
        expect(paths(filterBackups(runs, { ...none, at: ["r2"], quick: "missing" }, jobs))).toEqual(["shop-old.tar"]);
        expect(paths(filterBackups(runs, { ...none, at: ["nas"], quick: "missing" }, jobs))).toEqual([]);
    });

    it("looks for failed checks and locks only at the filtered destinations", () => {
        expect(paths(filterBackups(runs, { ...none, quick: "failed" }, jobs))).toEqual(["crm.tar"]);
        expect(paths(filterBackups(runs, { ...none, at: ["nas"], quick: "failed" }, jobs))).toEqual([]);
        expect(paths(filterBackups(runs, { ...none, at: ["r2"], quick: "locked" }, jobs))).toEqual([]);
        expect(paths(filterBackups(runs, { ...none, at: ["nas"], quick: "locked" }, jobs))).toEqual(["shop-old.tar"]);
    });

    it("finds a backup by its name or by the name of its job", () => {
        expect(paths(filterBackups(runs, { ...none, search: "ERP inv" }, jobs))).toEqual(["erp.tar"]);
        expect(paths(filterBackups(runs, { ...none, search: "shop-old" }, jobs))).toEqual(["shop-old.tar"]);
    });

    it("counts each option under every other filter", () => {
        const counts = countBackups(runs, { ...none, jobs: ["shop"], at: ["r2"] }, jobs, ["nas", "r2"]);

        expect(counts.jobs.get("shop")).toBe(2);
        expect(counts.jobs.get("crm")).toBe(1);
        expect(counts.jobs.get("deleted:erp")).toBeUndefined();
        expect(counts.at.get("nas")).toBe(2);
        expect(counts.at.get("r2")).toBe(2);
        expect(counts.quick).toEqual({ all: 2, missing: 1, failed: 0, locked: 0, deleted: 0 });
        expect(countBackups(runs, none, jobs, []).quick.deleted).toBe(1);
    });

    it("sums what the filtered destinations store and how many copies they miss", () => {
        const atR2 = filterBackups(runs, { ...none, at: ["r2"] }, jobs);
        expect(summarize(atR2, ["r2"], jobs)).toMatchObject({ runs: 3, jobs: 2, stored: 130, destinations: 1, copies: 3, missing: 1, failed: 1 });
        expect(summarize(runs, [], jobs)).toMatchObject({ runs: 4, jobs: 2, deletedJobs: 1, stored: 410, destinations: 2, copies: 7, missing: 1 });
    });

    it("tells who started each run, the schedule, a person by hand or an API key", () => {
        expect(startedByKey(shopNew)).toBe("schedule");
        expect(startedByKey(shopOld)).toBe("manual:Manu");
        expect(startedByKey(crm)).toBe("api:Deploy hook");
        expect(startedByKey(erp)).toBe("none");
        expect(startedByOptions(runs).map((option) => [option.group, option.label])).toEqual([
            ["", "Schedule"], ["By hand", "Manu"], ["API keys", "Deploy hook"], ["Other", "Not recorded"],
        ]);
    });

    it("filters by who started the runs and counts the others under the rest of the filters", () => {
        expect(paths(filterBackups(runs, { ...none, by: ["manual:Manu", "api:Deploy hook"] }, jobs))).toEqual(["crm.tar", "shop-old.tar"]);

        const counts = countBackups(runs, { ...none, jobs: ["shop"], by: ["schedule"] }, jobs, ["nas", "r2"]);
        expect(counts.by.get("schedule")).toBe(1);
        expect(counts.by.get("manual:Manu")).toBe(1);
        expect(counts.by.get("api:Deploy hook")).toBeUndefined();
        expect(counts.jobs.get("crm")).toBeUndefined();
        expect(counts.jobs.get("shop")).toBe(1);
    });

    it("acts only on the copies at the filtered destinations", () => {
        const [, shopRun, shopOldRun] = runs;

        expect(targetsOf(shopRun, ["r2"]).map((target) => target.destinationId)).toEqual(["r2"]);
        expect(targetsOf(shopRun, []).map((target) => target.destinationId)).toEqual(["nas", "r2"]);
        expect(targetsOf(shopOldRun, ["r2"])).toEqual([]);
        expect(primaryCopy(shopRun, ["r2"]).destinationId).toBe("r2");
        // With nothing stored there, the details still open on a copy that exists.
        expect(primaryCopy(shopOldRun, ["r2"]).destinationId).toBe("nas");
    });
});
