import { describe, expect, it } from "vitest";
import { rowsOf } from "@/components/dashboard/shared/shared-model";
import { buildSharedRow, timelineDatabases } from "@/components/dashboard/shared/shared-timeline-model";
import type { SharedBackup, SharedDatabase } from "@/services/tenant/shared-databases";

const dayOf = (iso: string) => iso.slice(0, 10);
const DAYS = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];

function shared(databaseName: string, since: string, until: string | null = null): SharedDatabase {
    return { sourceId: "my", serverName: "MySQL shop", adapterId: "mysql", databaseName, providerName: "Skyfay Hosting", since, until, serverGone: false, serverDeletedAt: null, movedFrom: [], onDemand: null };
}

function backup(id: string, database: SharedDatabase, createdAt: string, passed = true): SharedBackup {
    return { id, sourceId: database.sourceId, databaseName: database.databaseName, databaseKey: `${database.sourceId}/${database.databaseName}`, createdAt, encrypted: false, verification: { at: createdAt, passed }, dump: null, requestedBy: null };
}

const SHOP = shared("shop", "2026-10-05T00:00:00.000Z");
const OLD = shared("old", "2026-09-01T00:00:00.000Z", "2026-10-07T12:00:00.000Z");
const ROWS = rowsOf({
    databases: [SHOP, OLD],
    backups: [
        backup("s1", SHOP, "2026-10-05T02:00:00.000Z"),
        backup("s2", SHOP, "2026-10-06T02:00:00.000Z"),
        backup("s3", SHOP, "2026-10-06T14:00:00.000Z", false),
        backup("o1", OLD, "2026-10-06T03:00:00.000Z"),
    ],
});

describe("the line of a shared database in the timeline", () => {
    it("draws the days before a database was the tenant's and after it stopped being as bars of their own", () => {
        expect(buildSharedRow(SHOP, ROWS, DAYS, dayOf).spans).toEqual([{ kind: "before", start: 0, end: 0 }]);
        expect(buildSharedRow(OLD, ROWS, DAYS, dayOf).spans).toEqual([{ kind: "after", start: 4, end: 5 }]);
    });

    it("counts the backups of each day and marks a day with a failed check", () => {
        const row = buildSharedRow(SHOP, ROWS, DAYS, dayOf);
        expect(row.cells.map((cell) => (cell ? `${cell.kind}:${cell.rows.length}` : null))).toEqual([null, "ok:1", "failed:2", "none:0", "none:0", "none:0"]);
    });

    it("shows a line per database, current ones first, and only the ones with backups once a filter narrows them", () => {
        expect(timelineDatabases([OLD, SHOP], ROWS, false).map((database) => database.databaseName)).toEqual(["shop", "old"]);
        expect(timelineDatabases([OLD, SHOP], ROWS.filter((row) => row.databaseName === "old"), true).map((database) => database.databaseName)).toEqual(["old"]);
    });
});
