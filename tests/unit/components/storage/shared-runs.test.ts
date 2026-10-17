import { describe, expect, it } from "vitest";
import { rowsOf } from "@/components/dashboard/shared/shared-model";
import { countBackups, filterBackups, startedByOptions, summarize, type BackupFilters, type BackupLookup } from "@/components/dashboard/storage/explorer/backup-filters";
import { backupBulkActions } from "@/components/dashboard/storage/explorer/backup-bulk-actions";
import {
    isSharedRun,
    mergeRuns,
    providerValue,
    sharedJobKey,
    sharedRunOf,
    sharedRunsOf,
    splitAt,
    type ListRun,
} from "@/components/dashboard/storage/explorer/shared-runs";
import { itemsOfPick } from "@/components/dashboard/storage/explorer/timeline-pick-model";
import { buildSharedLine, sharedLineDatabases } from "@/components/dashboard/storage/explorer/timeline-shared";
import type { BackupRun, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
import type { SharedBackup, SharedDatabase } from "@/services/tenant/shared-databases";

/**
 * The backups of databases another tenant's server gives to this one, in the list of every backup
 * beside the own ones: how they merge, what the quick filter, the facets and the states make of
 * them, and their rows in the timeline.
 */

function database(databaseName: string, providerName = "Skyfay Hosting", until: string | null = null): SharedDatabase {
    return { sourceId: "my", serverName: "Shared MySQL", adapterId: "mysql", databaseName, providerName, since: "2026-10-01T00:00:00.000Z", until, serverGone: false, serverDeletedAt: null, movedFrom: [], onDemand: null };
}

function backup(id: string, of: SharedDatabase, createdAt: string, extra: Partial<SharedBackup> = {}): SharedBackup {
    return { id, sourceId: of.sourceId, databaseName: of.databaseName, databaseKey: `${of.sourceId}/${of.databaseName}`, createdAt, encrypted: true, verification: { at: createdAt, passed: true }, dump: { stored: 412, unpacked: 900 }, requestedBy: null, ...extra };
}

function own(name: string, createdAt: string): BackupRun {
    const file: ExplorerFile = { name, path: `ERP/${name}`, size: 100, lastModified: createdAt, createdAt, trigger: { type: "Scheduler" } };
    return { path: file.path, jobKey: "erp", file, createdAt, copies: [{ destinationId: "nas", state: "stored", file }, { destinationId: "s3", state: "missing" }] };
}

const SHOP = database("acme_shop");
const CRM = database("acme_crm", "Other Host");
const OLD = database("acme_old", "Skyfay Hosting", "2026-10-08T00:00:00.000Z");
const OVERVIEW = {
    databases: [SHOP, CRM, OLD],
    backups: [
        backup("a1", SHOP, "2026-10-17T02:14:00.000Z"),
        backup("a2", SHOP, "2026-10-16T15:42:00.000Z", { requestedBy: { name: "Sara Nguyen" } }),
        backup("c1", CRM, "2026-10-17T02:16:00.000Z", { verification: { at: "2026-10-17T03:00:00.000Z", passed: false } }),
        backup("o1", OLD, "2026-10-05T02:00:00.000Z", { dump: null }),
    ],
};
const SHARED = sharedRunsOf(OVERVIEW);
const OWN = [own("erp-17.tar", "2026-10-17T03:00:00.000Z"), own("erp-16.tar", "2026-10-16T03:00:00.000Z")];
const RUNS = mergeRuns(OWN, SHARED);

const jobs = new Map<string, ExplorerJob>([["erp", {
    key: "erp", kind: "job", name: "Acme ERP nightly", jobId: "erp", sourceType: "postgres", sourceName: "ERP", hasFolders: false, incremental: false,
    configuredDestinationIds: ["nas", "s3"], destinationIds: ["nas", "s3"], runs: 2, size: 200, newest: null, oldest: null, failedChecks: 0, missingCopies: 1, locked: 0, retention: {},
}]]);
const none: BackupFilters = { jobs: [], at: [], by: [], search: "", states: [] };
const lookup: BackupLookup = { jobs, answering: new Set(["nas"]) };
const names = (list: ListRun[]) => list.map((run) => (isSharedRun(run) ? `${run.shared.database.databaseName}@${run.shared.id}` : run.file.name));

describe("the shared backups in the list of every backup", () => {
    it("sorts them by time with the own backups, newest first", () => {
        expect(names(RUNS)).toEqual(["erp-17.tar", "acme_crm@c1", "acme_shop@a1", "acme_shop@a2", "erp-16.tar", "acme_old@o1"]);
    });

    it("gives a shared backup its database as the job and no copy at a destination of the tenant", () => {
        const run = sharedRunOf(rowsOf(OVERVIEW)[0]);
        expect(run.jobKey).toBe(sharedJobKey(CRM));
        expect(run.copies).toEqual([]);
        expect(run.file.name).toBe("acme_crm");
        expect(run.file.verification?.passed).toBe(false);
    });

    it("tells the own backups from the shared ones with the quick filter, counted under the other filters", () => {
        expect(names(filterBackups(RUNS, { ...none, quick: "own" }, lookup))).toEqual(["erp-17.tar", "erp-16.tar"]);
        expect(filterBackups(RUNS, { ...none, quick: "shared" }, lookup)).toHaveLength(4);
        expect(countBackups(RUNS, { ...none, quick: "shared" }, lookup, ["nas", "s3"]).quick).toEqual({ all: 6, own: 2, shared: 4 });
        expect(countBackups(RUNS, { ...none, search: "shop" }, lookup, ["nas", "s3"]).quick).toEqual({ all: 2, own: 0, shared: 2 });
    });

    it("narrows to one shared database through the Job filter", () => {
        expect(names(filterBackups(RUNS, { ...none, jobs: [sharedJobKey(SHOP)] }, lookup))).toEqual(["acme_shop@a1", "acme_shop@a2"]);
        expect(countBackups(RUNS, none, lookup, []).jobs.get(sharedJobKey(SHOP))).toBe(2);
    });

    it("offers the provider in the Destination filter, never its destinations", () => {
        const { at, providers } = splitAt(["nas", providerValue("Other Host")]);
        expect(at).toEqual(["nas"]);
        expect(providers).toEqual(["Other Host"]);
        expect(names(filterBackups(RUNS, { ...none, at, providers }, lookup))).toEqual(["erp-17.tar", "acme_crm@c1", "erp-16.tar"]);
        const counts = countBackups(RUNS, none, lookup, ["nas"], ["Skyfay Hosting", "Other Host"]);
        expect(counts.providers).toEqual(new Map([["Skyfay Hosting", 3], ["Other Host", 1]]));
        expect(counts.at.get("nas")).toBe(2);
    });

    it("lets a failed check of a shared backup count, but never a missing copy or a copy that does not answer", () => {
        expect(names(filterBackups(RUNS, { ...none, states: ["failed"] }, lookup))).toEqual(["acme_crm@c1"]);
        expect(names(filterBackups(RUNS, { ...none, states: ["missing"] }, lookup))).toEqual(["erp-17.tar", "erp-16.tar"]);
        expect(names(filterBackups(RUNS, { ...none, states: ["unreachable", "locked", "deleted"] }, lookup))).toEqual([]);
    });

    it("lists who started a shared backup apart from the starters of the own ones", () => {
        const options = startedByOptions(RUNS);
        expect(options.filter((option) => option.group === "Shared with you").map((option) => option.label)).toEqual([
            "Back up now · Sara Nguyen",
            "Schedule · Other Host",
            "Schedule · Skyfay Hosting",
        ]);
        const requested = options.find((option) => option.label === "Back up now · Sara Nguyen")!;
        expect(names(filterBackups(RUNS, { ...none, by: [requested.value] }, lookup))).toEqual(["acme_shop@a2"]);
    });

    it("finds a shared backup by its database, its server and its provider", () => {
        expect(filterBackups(RUNS, { ...none, search: "other host" }, lookup)).toHaveLength(1);
        expect(filterBackups(RUNS, { ...none, search: "shared mysql" }, lookup)).toHaveLength(4);
    });

    it("counts no shared backup among the stored bytes and the copies", () => {
        const summary = summarize(RUNS, [], jobs);
        expect(summary.stored).toBe(200);
        expect(summary.copies).toBe(4);
        expect(summary.missing).toBe(2);
    });

    it("leaves a shared backup out of every bulk action, since its provider keeps lock and delete", () => {
        const [lock] = backupBulkActions(true, [], "");
        expect(lock.ineligible?.(SHARED[0])).toBe("Other Host keeps it");
        expect(lock.ineligible?.(OWN[0])).toBeNull();
    });
});

describe("the shared databases in the timeline", () => {
    const dayOf = (iso: string) => iso.slice(0, 10);
    const days = ["2026-10-15", "2026-10-16", "2026-10-17"];

    it("draws a row per database with its backups of each day", () => {
        const line = buildSharedLine(SHOP, SHARED.filter((run) => run.jobKey === sharedJobKey(SHOP)), days, dayOf);
        expect(line.shared).toBe(SHOP);
        expect(line.job.key).toBe(sharedJobKey(SHOP));
        expect(line.cells.map((cell) => (cell ? `${cell.kind}:${cell.runs.length}` : null))).toEqual(["none:0", "ok:1", "ok:1"]);
    });

    it("shows every current database while nothing narrows, the ones with backups once something does, and none for Yours", () => {
        const input = { databases: OVERVIEW.databases, runs: RUNS.filter((run) => run.jobKey !== sharedJobKey(OLD)), scopeJobs: [], narrowed: false, quick: "all" as const };
        expect(sharedLineDatabases(input).map((entry) => entry.databaseName)).toEqual(["acme_crm", "acme_shop"]);
        // A former database shows with the backups of its time, after the current ones.
        expect(sharedLineDatabases({ ...input, runs: RUNS }).map((entry) => entry.databaseName)).toEqual(["acme_crm", "acme_shop", "acme_old"]);
        expect(sharedLineDatabases({ ...input, runs: RUNS.filter((run) => run.jobKey === sharedJobKey(OLD)), narrowed: true }).map((entry) => entry.databaseName)).toEqual(["acme_old"]);
        expect(sharedLineDatabases({ ...input, scopeJobs: [sharedJobKey(SHOP)] }).map((entry) => entry.databaseName)).toEqual(["acme_shop"]);
        expect(sharedLineDatabases({ ...input, quick: "own" })).toEqual([]);
    });

    it("lists the shared backups of a day with the own ones, counted apart", () => {
        const line = buildSharedLine(SHOP, SHARED.filter((run) => run.jobKey === sharedJobKey(SHOP)), days, dayOf);
        const items = itemsOfPick([line], days, { from: "2026-10-17", to: "2026-10-17" }, []);
        expect(items).toEqual(expect.objectContaining({ backups: 1, jobs: 0, databases: 1 }));
        expect(items.rest[0]).toEqual(expect.objectContaining({ kind: "backup", problem: null }));
    });
});
