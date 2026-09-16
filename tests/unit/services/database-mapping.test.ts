import { describe, it, expect } from "vitest";
import { normalizeDatabaseMapping } from "@/services/restore/database-mapping";
import { shouldRestoreDatabase, getTargetDatabaseName } from "@/lib/adapters/database/common/tar-utils";

describe("database mapping of a restore request", () => {
    it("restores only the databases an object of renames names, under their new names", () => {
        // The documented API form. It used to be ignored, which restored every database of the
        // backup under its original name.
        const mapping = normalizeDatabaseMapping({ shop: "shop_copy" });

        expect(mapping).toEqual([{ originalName: "shop", targetName: "shop_copy", selected: true }]);
        expect(shouldRestoreDatabase("shop", mapping)).toBe(true);
        expect(getTargetDatabaseName("shop", mapping)).toBe("shop_copy");
        expect(shouldRestoreDatabase("blog", mapping)).toBe(false);
    });

    it("keeps the original name for an empty rename", () => {
        expect(normalizeDatabaseMapping({ shop: "" })).toEqual([{ originalName: "shop", targetName: "shop", selected: true }]);
    });

    it("passes the list the restore page sends through unchanged", () => {
        const list = [
            { originalName: "shop", targetName: "shop_copy", selected: true },
            { originalName: "blog", targetName: "blog", selected: false },
        ];
        expect(normalizeDatabaseMapping(list)).toEqual(list);
    });

    it("does not select a list entry without an explicit selected flag", () => {
        expect(normalizeDatabaseMapping([{ originalName: "shop" }])).toEqual([{ originalName: "shop", targetName: "shop", selected: false }]);
    });

    it("means everything when no mapping is sent", () => {
        expect(normalizeDatabaseMapping(undefined)).toBeUndefined();
        expect(normalizeDatabaseMapping(null)).toBeUndefined();
    });

    it("refuses a mapping it cannot read instead of restoring everything", () => {
        expect(() => normalizeDatabaseMapping("shop")).toThrow(/list of entries or an object/);
        expect(() => normalizeDatabaseMapping({ shop: 42 })).toThrow(/databaseMapping.shop must be a string/);
        expect(() => normalizeDatabaseMapping([{ targetName: "x" }])).toThrow(/needs an originalName/);
    });
});
