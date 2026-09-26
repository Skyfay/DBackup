import { describe, expect, it } from "vitest";
import {
    buildDbRows,
    copyName,
    databaseSentence,
    filterCounts,
    folderOutcome,
    lineGroups,
    restoreBlocker,
    restoreLabel,
    type DbChoice,
    type FolderChoice,
} from "@/components/dashboard/storage/restore/restore-model";

const GB = 1024 ** 3;
const choice = (name: string, overrides: Partial<DbChoice> = {}): DbChoice => ({ id: name, name, targetName: name, selected: true, ...overrides });
const SERVER = [{ name: "shop", sizeInBytes: 2.3 * GB }, { name: "orders", sizeInBytes: GB }, { name: "billing_restored", sizeInBytes: 1 }];
const sizes = new Map([["shop", 1.2 * GB], ["billing", 0.4 * GB]]);

describe("the rows of the databases", () => {
    it("says for every database whether it overwrites one on the server or is new there", () => {
        const rows = buildDbRows([choice("shop"), choice("billing"), choice("analytics", { selected: false })], SERVER, sizes, false);

        expect(rows.map((row) => [row.source, row.target, row.outcome])).toEqual([
            ["shop", "shop", "overwrite"],
            ["billing", "billing", "new"],
            ["analytics", "analytics", "out"],
            [null, "billing_restored", "stays"],
            [null, "orders", "stays"],
        ]);
        expect(rows[0]).toMatchObject({ size: 1.2 * GB, thereSize: 2.3 * GB });
    });

    it("counts a database the restore takes over as its target, not as one that stays", () => {
        const rows = buildDbRows([choice("billing", { targetName: "billing_restored" })], SERVER, sizes, false);

        expect(rows.find((row) => row.target === "billing_restored")?.outcome).toBe("overwrite");
        expect(rows.filter((row) => row.outcome === "stays").map((row) => row.target)).toEqual(["orders", "shop"]);
    });

    it("cannot tell what lies at a Firebird path, so it says so instead of new", () => {
        const rows = buildDbRows([choice("main", { targetName: "/data/main.fdb" })], [], new Map(), true);

        expect(rows[0].outcome).toBe("unverified");
    });

    it("counts the rows of every quick filter", () => {
        const rows = buildDbRows([choice("shop"), choice("billing"), choice("analytics", { selected: false })], SERVER, sizes, false);

        expect(filterCounts(rows)).toEqual({ all: 5, overwrite: 1, new: 1, stays: 2, out: 1 });
    });
});

describe("the lines of the databases", () => {
    it("bundles the databases that do the same under their own names and gives a renamed one a line of its own", () => {
        const choices = [choice("shop"), choice("orders"), choice("billing", { targetName: "billing_copy" }), choice("new_one"), choice("old", { selected: false })];
        const groups = lineGroups(buildDbRows(choices, SERVER, sizes, false));

        expect(groups.map((group) => [group.key, group.rows.map((row) => row.source)])).toEqual([
            ["same:overwrite", ["shop", "orders"]],
            ["same:new", ["new_one"]],
            ["renamed:billing", ["billing"]],
            ["out", ["old"]],
        ]);
    });
});

describe("the words of the page", () => {
    it("finds a free name for a copy beside a database", () => {
        expect(copyName("shop", new Set(["shop"]))).toBe("shop_restored");
        expect(copyName("shop", new Set(["shop_restored", "shop_restored_2"]))).toBe("shop_restored_3");
    });

    it("names a few databases and counts many", () => {
        const few = buildDbRows([choice("shop"), choice("billing", { targetName: "billing_restored_2" })], SERVER, sizes, false);
        expect(databaseSentence(few)).toBe("shop is overwritten, billing comes back as billing_restored_2");

        const many = buildDbRows(["a", "b", "c"].map((name) => choice(name)), ["a", "b", "c"].map((name) => ({ name })), new Map(), false);
        expect(databaseSentence(many)).toBe("3 databases are overwritten");
        expect(databaseSentence(buildDbRows([choice("a", { selected: false })], [], new Map(), false))).toBe("No database is picked");
    });

    it("says on the button what it restores", () => {
        expect(restoreLabel(2, 1)).toBe("Restore 2 databases, 1 folder");
        expect(restoreLabel(1, 0)).toBe("Restore 1 database");
        expect(restoreLabel(0, 0)).toBe("Restore");
    });
});

describe("the folders", () => {
    const folder = (overrides: Partial<FolderChoice> = {}): FolderChoice => ({
        entryId: "src-1", label: "Uploads", targetConfigId: "web", targetPath: "/var/www/uploads", selected: true, selection: null, checkStatus: "occupied", ...overrides,
    });

    it("tells what happens at the path of a folder", () => {
        expect(folderOutcome(folder(), false)).toBe("replaces");
        // A volume that exists is emptied before the backup goes in, not merged.
        expect(folderOutcome(folder(), true)).toBe("emptied");
        expect(folderOutcome(folder({ checkStatus: "empty" }), false)).toBe("empty");
        expect(folderOutcome(folder({ checkStatus: undefined }), false)).toBe("checking");
        expect(folderOutcome(folder({ targetPath: " " }), false)).toBe("incomplete");
        expect(folderOutcome(folder({ selected: false }), false)).toBe("out");
    });

    it("says why the restore waits, the most pressing reason first", () => {
        const base = { needsServer: true, server: "staging", blockedBy: null, anything: true, folders: [folder()], planError: null };

        expect(restoreBlocker(base)).toBeNull();
        expect(restoreBlocker({ ...base, blockedBy: "The backup is newer than the server" })).toBe("The backup is newer than the server");
        expect(restoreBlocker({ ...base, anything: false })).toBe("Pick a database or a folder to restore");
        expect(restoreBlocker({ ...base, server: "" })).toBe("Pick the server the databases go to");
        expect(restoreBlocker({ ...base, folders: [folder({ targetConfigId: "" })] })).toBe("Uploads needs a directory source and a path");
        expect(restoreBlocker({ ...base, folders: [folder({ selection: [] })] })).toBe("No file of Uploads is picked, leave the folder out instead");
        expect(restoreBlocker({ ...base, planError: "An archive of the chain is missing" })).toBe("An archive of the chain is missing");
    });
});
