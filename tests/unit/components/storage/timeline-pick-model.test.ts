import { describe, expect, it } from "vitest";
import { buildRow, daysEnding } from "@/components/dashboard/storage/explorer/timeline-model";
import { itemsOfPick, problemOf, type PickItem } from "@/components/dashboard/storage/explorer/timeline-pick-model";
import type { BackupRun, ExplorerFile, ExplorerJob, JobPlan } from "@/services/storage/explorer-types";

const dayOf = (iso: string) => iso.slice(0, 10);
const today = "2026-09-30";
const days = daysEnding(today, 7);

function job(key: string, name: string): ExplorerJob {
    return {
        key, kind: "job", name, jobId: key, sourceType: "postgres", sourceName: name, hasFolders: false, incremental: false,
        configuredDestinationIds: ["nas", "r2"], destinationIds: ["nas", "r2"], runs: 1, size: 1, newest: "2026-09-30T03:00:00Z", oldest: "2026-09-01T03:00:00Z",
        failedChecks: 0, missingCopies: 0, locked: 0, retention: {},
    };
}

function run(jobKey: string, at: string, problem: { failed?: boolean; missing?: boolean } = {}): BackupRun {
    const file: ExplorerFile = {
        name: `${jobKey}-${at}.tar`, path: `${jobKey}/${at}.tar`, size: 1, lastModified: at, createdAt: at,
        ...(problem.failed ? { verification: { verifiedAt: at, passed: false, trigger: "post-upload" } } : {}),
    };
    return {
        path: file.path,
        jobKey,
        file,
        createdAt: at,
        copies: [{ destinationId: "nas", state: "stored", file }, problem.missing ? { destinationId: "r2", state: "missing" } : { destinationId: "r2", state: "stored", file }],
    };
}

function plan(jobKey: string, missed: string[]): JobPlan {
    return { jobKey, schedule: "0 4 * * *", enabled: true, createdAt: "2026-09-01T00:00:00Z", retention: null, planned: [], missed: missed.map((at) => ({ at, runs: 1 })), truncated: false };
}

const shop = job("shop", "Shop MySQL");
const logs = job("logs", "Logs MongoDB");
const crm = job("crm", "CRM MongoDB");
const wiki = job("wiki", "Wiki MariaDB");

const rows = [
    buildRow({ job: shop, runs: [run("shop", "2026-09-27T03:00:00Z"), run("shop", "2026-09-29T03:00:00Z", { missing: true }), run("shop", "2026-09-30T03:00:00Z")], days, today, at: [], dayOf }),
    buildRow({ job: logs, runs: [run("logs", "2026-09-29T06:00:00Z", { failed: true })], days, today, at: [], dayOf }),
    buildRow({ job: crm, runs: [run("crm", "2026-09-29T12:00:00Z"), run("crm", "2026-09-29T00:00:00Z")], days, today, at: [], dayOf }),
    buildRow({ job: wiki, plan: plan("wiki", ["2026-09-29T04:00:00Z"]), runs: [], days, today, at: [], dayOf }),
];

const names = (items: PickItem[]) => items.map((item) => `${item.job.name} ${item.at.slice(11, 16)} ${item.kind}`);

describe("the list a click on the timeline opens", () => {
    it("lists every job of a day by the time of day, with a missing copy, a run that did not start and a failed check first", () => {
        const list = itemsOfPick(rows, days, { from: "2026-09-29", to: "2026-09-29" }, []);

        expect(names(list.look)).toEqual(["Shop MySQL 03:00 backup", "Wiki MariaDB 04:00 missed", "Logs MongoDB 06:00 backup"]);
        expect(names(list.rest)).toEqual(["CRM MongoDB 00:00 backup", "CRM MongoDB 12:00 backup"]);
        expect(list.backups).toBe(4);
        expect(list.jobs).toBe(3);
    });

    it("lists the backups of a job in view newest first", () => {
        const list = itemsOfPick(rows, days, { jobKey: "shop", from: days[0], to: today }, []);

        expect(list.look.map((item) => item.day)).toEqual(["2026-09-29"]);
        expect(list.rest.map((item) => item.day)).toEqual(["2026-09-30", "2026-09-27"]);
        expect(list.jobs).toBe(1);
    });

    it("keeps to the destinations of the filter, so a copy missing elsewhere is no problem", () => {
        const list = itemsOfPick(rows, days, { jobKey: "shop", from: "2026-09-29", to: "2026-09-29" }, ["nas"]);

        expect(list.look).toHaveLength(0);
        expect(list.rest).toHaveLength(1);
    });

    it("names a failed check before a missing copy, and the destinations that lack one", () => {
        expect(problemOf(run("shop", "2026-09-29T03:00:00Z", { failed: true, missing: true }), [])).toEqual({ kind: "failed" });
        expect(problemOf(run("shop", "2026-09-29T03:00:00Z", { missing: true }), [])).toEqual({ kind: "missing", destinationIds: ["r2"] });
        expect(problemOf(run("shop", "2026-09-29T03:00:00Z"), [])).toBeNull();
    });
});
