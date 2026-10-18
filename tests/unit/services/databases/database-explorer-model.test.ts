import { describe, expect, it } from "vitest";
import {
    cleanListedDatabases, coverageOf, databaseKey, destinationsOfRun, jobHolds, jobsToReadFurther, lastBackupsOf, namesOfRun, parseJobDatabases, parseListedDatabases, type KeptRun,
} from "@/services/databases/database-explorer-model";
import type { ExplorerDbJob } from "@/services/databases/database-explorer-types";

const job = (id: string, serverId: string, databases: string[] | null, enabled = true): ExplorerDbJob => ({ id, name: id, serverId, enabled, databases, schedule: "0 3 * * *" });
const run = (id: string, jobId: string, startedAt: string, names: string[] | null, status: KeptRun["status"] = "Success"): KeptRun => ({ id, jobId, status, startedAt, size: 100, names });

describe("which job backs up which database", () => {
    it("reads an empty selection as every database of the server, also the ones added later", () => {
        expect(parseJobDatabases("[]")).toBeNull();
        expect(parseJobDatabases("")).toBeNull();
        expect(parseJobDatabases("not json")).toBeNull();
        expect(parseJobDatabases('["shop","billing"]')).toEqual(["shop", "billing"]);
    });

    it("counts a job for every database of its server when it picked none, and only for the picked ones otherwise", () => {
        const databases = [{ serverId: "s1", name: "shop" }, { serverId: "s1", name: "analytics" }, { serverId: "s2", name: "crm" }];
        const coverage = coverageOf(databases, [job("nightly", "s1", ["shop"]), job("offsite", "s1", null), job("crm", "s2", ["crm_archive"])]);

        expect(coverage.get(databaseKey("s1", "shop"))).toEqual(["nightly", "offsite"]);
        expect(coverage.get(databaseKey("s1", "analytics"))).toEqual(["offsite"]);
        // A job of another server never counts, and neither does a pick the server does not have.
        expect(coverage.get(databaseKey("s2", "crm"))).toEqual([]);
    });

    it("leaves a paused job out, since it backs up nothing", () => {
        const coverage = coverageOf([{ serverId: "s1", name: "shop" }], [job("paused", "s1", null, false)]);
        expect(coverage.get(databaseKey("s1", "shop"))).toEqual([]);
        expect(jobHolds(job("paused", "s1", null, false), "s1", "shop")).toBe(true);
    });
});

describe("what a run backed up", () => {
    it("reads the names a run records, and the fields older runs kept them in", () => {
        expect(namesOfRun(JSON.stringify({ names: ["shop", "billing"] }))).toEqual(["shop", "billing"]);
        expect(namesOfRun(JSON.stringify({ databases: { count: 1, names: ["crm"] } }))).toEqual(["crm"]);
        expect(namesOfRun(JSON.stringify({ databases: ["wiki"] }))).toEqual(["wiki"]);
        expect(namesOfRun(JSON.stringify({ multiDb: { format: "tar", databases: ["a", "b"] } }))).toEqual(["a", "b"]);
    });

    it("knows no names for a run that failed early or has broken metadata", () => {
        expect(namesOfRun(JSON.stringify({ progress: 40, stage: "Dumping" }))).toBeNull();
        expect(namesOfRun("{broken")).toBeNull();
        expect(namesOfRun(null)).toBeNull();
    });

    it("lists where a run uploaded to and whether each upload worked", () => {
        const metadata = JSON.stringify({ destinations: [{ name: "NAS", adapterId: "sftp", status: "success" }, { name: "R2", adapterId: "s3-r2", status: "failed" }, { oops: true }] });
        expect(destinationsOfRun(metadata)).toEqual([
            { name: "NAS", adapterId: "sftp", ok: true },
            { name: "R2", adapterId: "s3-r2", ok: false },
        ]);
        expect(destinationsOfRun(null)).toEqual([]);
    });

    it("leaves out an air-gapped destination the run skipped", () => {
        const metadata = JSON.stringify({ destinations: [{ name: "NAS", adapterId: "sftp", status: "success" }, { name: "USB", adapterId: "local-filesystem", status: "skipped", airGapped: true }] });
        expect(destinationsOfRun(metadata)).toEqual([{ name: "NAS", adapterId: "sftp", ok: true }]);
    });
});

describe("the last backup of each database", () => {
    const databases = [{ serverId: "s1", name: "shop" }, { serverId: "s1", name: "billing" }];

    it("takes the newest kept run that holds the database", () => {
        const last = lastBackupsOf([
            run("r3", "nightly", "2026-09-27T03:00:00Z", ["billing"]),
            run("r2", "nightly", "2026-09-26T03:00:00Z", ["shop", "billing"], "Partial"),
            run("r1", "nightly", "2026-09-25T03:00:00Z", ["shop", "billing"]),
        ], [job("nightly", "s1", null)], databases);

        expect(last.get(databaseKey("s1", "billing"))).toMatchObject({ executionId: "r3", status: "Success" });
        expect(last.get(databaseKey("s1", "shop"))).toMatchObject({ executionId: "r2", status: "Partial" });
    });

    it("counts a run without names for every database its job holds, and skips runs of jobs that are gone", () => {
        const last = lastBackupsOf([
            run("gone", "deleted", "2026-09-27T05:00:00Z", ["shop"]),
            run("old", "nightly", "2026-09-26T03:00:00Z", null),
        ], [job("nightly", "s1", ["shop"])], databases);

        expect(last.get(databaseKey("s1", "shop"))?.executionId).toBe("old");
        expect(last.has(databaseKey("s1", "billing"))).toBe(false);
    });
});

describe("which jobs need more than their newest kept run", () => {
    const databases = [{ serverId: "s1", name: "shop" }, { serverId: "s1", name: "billing" }, { serverId: "s2", name: "crm" }];
    const jobs = [job("nightly", "s1", null), job("shop-only", "s1", ["shop"]), job("crm", "s2", null)];

    it("reads no older run of a job whose newest run backed up every database of its server", () => {
        const newest = [run("n1", "nightly", "2026-09-27T03:00:00Z", ["shop", "billing"]), run("c1", "crm", "2026-09-27T04:00:00Z", null)];
        expect(jobsToReadFurther(newest, jobs, databases, lastBackupsOf(newest, jobs, databases))).toEqual([]);
    });

    it("reads older runs of a job whose newest run left out a database nobody backed up since", () => {
        const newest = [run("n1", "nightly", "2026-09-27T03:00:00Z", ["shop"]), run("s1", "shop-only", "2026-09-26T03:00:00Z", ["shop"])];
        // Billing has no last backup yet, so an older run of the nightly job may hold it. The job of
        // shop alone left out billing too, which an older run of it may have held before.
        expect(jobsToReadFurther(newest, jobs, databases, lastBackupsOf(newest, jobs, databases))).toEqual(["nightly", "shop-only"]);
    });

    it("skips a job whose older runs are older than the last backup another job made", () => {
        const newest = [run("n1", "nightly", "2026-09-27T03:00:00Z", ["shop", "billing"]), run("s1", "shop-only", "2026-09-26T03:00:00Z", ["shop"])];
        // The job of shop alone left out billing, which the nightly job backed up after its newest run.
        expect(jobsToReadFurther(newest, jobs, databases, lastBackupsOf(newest, jobs, databases))).toEqual([]);
    });
});

describe("the list a server hands out", () => {
    it("keeps the name, the size and the table count, and drops anything unnamed or not a number", () => {
        expect(cleanListedDatabases([
            { name: "shop", sizeInBytes: 2048, tableCount: 46 },
            { name: "", sizeInBytes: 1 },
            { name: "wiki", sizeInBytes: Number.NaN },
        ])).toEqual([{ name: "shop", sizeInBytes: 2048, tableCount: 46 }, { name: "wiki" }]);
    });

    it("reads a cached list, and an empty one for a row that cannot be read", () => {
        expect(parseListedDatabases('[{"name":"crm","tableCount":64}]')).toEqual([{ name: "crm", tableCount: 64 }]);
        expect(parseListedDatabases("{}")).toEqual([]);
        expect(parseListedDatabases("nope")).toEqual([]);
        expect(parseListedDatabases(null)).toEqual([]);
    });
});
