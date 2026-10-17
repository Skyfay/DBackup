import { describe, expect, it } from "vitest";
import { createRestoreTracker } from "@/services/restore/restore-record";

describe("the record a restore keeps for the summary of its run", () => {
    it("keeps the destination and the archive of the server out of a customer's run", () => {
        const record = createRestoreTracker();
        record.from("Local", "local-filesystem");
        record.archive("Lab PostgreSQL 18 to Local/a.tar");
        record.planDatabases([{ name: "inventory", target: "inventory", bytes: 5_632 }]);

        expect(record.view(false)).toMatchObject({ from: { name: "Local", adapterId: "local-filesystem" }, archive: "Lab PostgreSQL 18 to Local/a.tar" });
        expect(record.view(true)).toMatchObject({ from: null, archive: null, databases: [expect.objectContaining({ name: "inventory" })] });
    });

    it("follows a database from waiting through restoring to done, with how far it is only while it restores", () => {
        const record = createRestoreTracker();
        record.planDatabases([{ name: "shop", target: "shop_test", bytes: 1_000 }]);
        expect(record.view(false).databases[0]).toMatchObject({ state: "waiting", startedAt: null });

        record.startDatabase("shop");
        record.databaseProgress("shop", 142, "table orders");
        expect(record.view(false).databases[0]).toMatchObject({ state: "restoring", percent: 100, detail: "table orders" });

        record.endDatabase("shop", true);
        expect(record.view(false).databases[0]).toMatchObject({ state: "done", percent: null, detail: null });
        expect(record.view(false).databases[0].endedAt).not.toBeNull();
    });

    it("counts the bytes read, and a backup fetched whole as what it fetched", () => {
        const record = createRestoreTracker();
        record.read(100);
        record.read(-5);
        record.read(50);
        expect(record.view(false).read).toBe(150);
        record.readTotal(4_000);
        expect(record.view(false).read).toBe(4_000);
    });

    it("ends a folder as done, partial when some files are missing and failed when none arrived", () => {
        const record = createRestoreTracker();
        record.planFolders([
            { id: "a", label: "uploads", target: "Local:/srv/uploads", adapterId: "local-filesystem", total: 2, totalBytes: 30 },
            { id: "b", label: "logs", target: "Local:/srv/logs", adapterId: "local-filesystem", total: 2, totalBytes: 30 },
            { id: "c", label: "cache", target: "S3:/cache", adapterId: "s3", total: 1, totalBytes: 10 },
            { id: "d", label: "scripts", target: "", adapterId: null, total: 0, totalBytes: 0, failed: true },
        ]);
        record.folderEntry("a", "restored", 10);
        record.folderEntry("a", "restored", 20);
        record.folderEntry("b", "restored", 10);
        record.folderEntry("b", "skipped", 0);
        record.folderEntry("c", "failed", 0);
        record.endFolders();

        expect(record.view(false).folders.map((folder) => [folder.label, folder.state, folder.files, folder.bytes])).toEqual([
            ["uploads", "done", 2, 30],
            ["logs", "partial", 1, 10],
            ["cache", "failed", 0, 0],
            ["scripts", "failed", 0, 0],
        ]);
    });

    it("hands out a copy, so a later change never reaches a view already written", () => {
        const record = createRestoreTracker();
        record.planDatabases([{ name: "shop", target: "shop", bytes: null }]);
        const before = record.view(false);
        record.startDatabase("shop");
        expect(before.databases[0].state).toBe("waiting");
    });
});
