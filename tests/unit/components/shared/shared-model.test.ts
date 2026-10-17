import { describe, expect, it } from "vitest";
import {
    backupRef,
    canBackUpNow,
    formerLabel,
    heldText,
    isFormer,
    madeAt,
    madeAtText,
    onDemandLine,
    othersOnServer,
    restoreStarted,
    rowsOf,
    sharedKey,
    starterOf,
} from "@/components/dashboard/shared/shared-model";
import type { SharedBackup, SharedDatabase } from "@/services/tenant/shared-databases";

function shared(sourceId: string, serverName: string, databaseName: string, until: string | null = null): SharedDatabase {
    return { sourceId, serverName, adapterId: sourceId === "pg" ? "postgres" : "mysql", databaseName, providerName: "Skyfay Hosting", since: "2026-10-01T00:00:00.000Z", until, serverGone: false, serverDeletedAt: null, movedFrom: [], onDemand: null };
}

function backup(id: string, database: SharedDatabase, createdAt: string, extra: Partial<SharedBackup> = {}): SharedBackup {
    return { id, sourceId: database.sourceId, databaseName: database.databaseName, databaseKey: `${database.sourceId}/${database.databaseName}`, createdAt, encrypted: true, verification: { at: createdAt, passed: true }, dump: { stored: 100, unpacked: 400 }, requestedBy: null, ...extra };
}

const OLD = shared("pg", "Postgres main", "shop_old", "2026-10-08T00:00:00.000Z");
const MY_B = shared("my", "MySQL shop", "shop_b");
const PG_A = shared("pg", "Postgres main", "shop_a");
const MY_A = shared("my", "MySQL shop", "shop_a");
const DATABASES = [OLD, MY_B, PG_A, MY_A];

const BACKUPS = [
    backup("b1", MY_A, "2026-10-12T02:00:00.000Z"),
    backup("b2", MY_A, "2026-10-14T02:00:00.000Z", { dump: { stored: 300, unpacked: 900 } }),
    backup("b3", PG_A, "2026-10-13T02:00:00.000Z", { dump: null }),
    backup("b4", OLD, "2026-10-05T02:00:00.000Z", { verification: { at: "2026-10-05T03:00:00.000Z", passed: false } }),
    // Of a database the list no longer has, which the list leaves out.
    backup("b5", shared("my", "MySQL shop", "gone"), "2026-10-15T02:00:00.000Z"),
];

describe("the backups shared with a tenant", () => {
    it("joins each backup with its database, newest first, and leaves out a backup of a database not listed", () => {
        const rows = rowsOf({ databases: DATABASES, backups: BACKUPS });
        expect(rows.map((row) => row.id)).toEqual(["b2", "b3", "b1", "b4"]);
        expect(rows[0].database).toBe(MY_A);
    });

    it("keeps two databases of the same name on two servers apart", () => {
        expect(sharedKey(MY_A)).not.toBe(sharedKey(PG_A));
        const rows = rowsOf({ databases: DATABASES, backups: BACKUPS });
        expect(rows.find((row) => row.id === "b3")?.database.serverName).toBe("Postgres main");
    });

    it("tells a database that is no longer the tenant's, whose backups only download", () => {
        expect(isFormer(OLD)).toBe(true);
        expect(isFormer(MY_A)).toBe(false);
        const rows = rowsOf({ databases: DATABASES, backups: BACKUPS });
        expect(rows.map((row) => isFormer(row.database))).toEqual([false, false, false, true]);
    });

    it("names a backup in an action by its database and its id alone", () => {
        const [row] = rowsOf({ databases: DATABASES, backups: BACKUPS });
        expect(backupRef(row)).toEqual({ sourceId: "my", databaseName: "shop_a", backupId: "b2" });
    });
});

describe("the words of the shared backups", () => {
    it("says who started a backup: the schedule of the provider, or Back up now of someone of the tenant", () => {
        expect(starterOf({ database: MY_A, requestedBy: null })).toEqual({ kind: "schedule", label: "Schedule", who: "Skyfay Hosting" });
        expect(starterOf({ database: MY_A, requestedBy: { name: "Sara Nguyen" } })).toEqual({ kind: "request", label: "Back up now", who: "Sara Nguyen" });
        expect(starterOf({ database: MY_A, requestedBy: { name: null } }).who).toBe("a removed account");
    });

    it("names the other current databases of the server a restore leaves alone", () => {
        expect(othersOnServer(DATABASES, { database: MY_A }).map((database) => database.databaseName)).toEqual(["shop_b"]);
        // The former one is no longer the tenant's, so it is not named.
        expect(othersOnServer(DATABASES, { database: PG_A })).toEqual([]);
    });

    it("says since when a database is the tenant's, or from when to when", () => {
        const date = (iso: string) => iso.slice(0, 10);
        expect(heldText(MY_A, date)).toBe("Yours since 2026-10-01");
        expect(heldText(OLD, date)).toBe("Yours from 2026-10-01 to 2026-10-08");
        expect(restoreStarted({ database: MY_A })).toBe("The restore of shop_a started");
    });
});

describe("a shared database that moved or lost its server", () => {
    const OLD_PLACE = { sourceId: "old", serverName: "Old MySQL", databaseName: "shop", from: "2026-01-01T00:00:00.000Z", until: "2026-04-01T00:00:00.000Z", serverGone: false };
    const MOVED: SharedDatabase = { ...shared("new", "New MySQL", "shop2"), movedFrom: [OLD_PLACE] };

    it("lists the backups of its earlier server under the database of now", () => {
        const before = { ...backup("m1", MOVED, "2026-03-01T02:00:00.000Z"), sourceId: "old", databaseName: "shop" };
        const rows = rowsOf({ databases: [MOVED], backups: [before, backup("m2", MOVED, "2026-05-01T02:00:00.000Z")] });
        expect(rows.map((row) => row.id)).toEqual(["m2", "m1"]);
        expect(madeAt(rows[1])).toEqual(OLD_PLACE);
        expect(madeAt(rows[0])).toBeNull();
        expect(madeAtText(OLD_PLACE, "shop2")).toBe("made as shop on Old MySQL");
        expect(madeAtText({ ...OLD_PLACE, databaseName: "shop2" }, "shop2")).toBe("made on Old MySQL");
    });

    it("treats a database of a deleted server as one that only downloads", () => {
        const gone = { ...shared("gone", "Gone MySQL", "crm"), serverGone: true };
        expect(isFormer(gone)).toBe(true);
        expect(formerLabel(gone)).toBe("Server deleted");
        expect(formerLabel(OLD)).toBe("Former");
    });

    it("says how many backups on demand are left today, and offers one only with room and none running", () => {
        expect(onDemandLine({ perDay: 3, usedToday: 1, active: null })).toBe("2 of 3 left today");
        expect(onDemandLine({ perDay: 3, usedToday: 3, active: null })).toBe("All 3 of today used, the next one tomorrow");
        expect(onDemandLine({ perDay: 3, usedToday: 1, active: { requestId: "r", state: "running" } })).toBe("A backup runs now");
        expect(canBackUpNow({ perDay: 3, usedToday: 1, active: null })).toBe(true);
        expect(canBackUpNow({ perDay: 3, usedToday: 3, active: null })).toBe(false);
        expect(canBackUpNow({ perDay: 3, usedToday: 1, active: { requestId: "r", state: "queued" } })).toBe(false);
        expect(canBackUpNow(null)).toBe(false);
    });
});
