import { describe, it, expect } from "vitest";
import {
    isDefaultLayout,
    moveColumn,
    resolveLayout,
    tanstackOrder,
    tanstackVisibility,
    type LayoutColumn,
} from "@/components/ui/data-table-layout";

const columns: LayoutColumn[] = [
    { id: "name", label: "Name", pin: "start" },
    { id: "adapterId", label: "Type", filterOnly: true },
    { id: "status", label: "Status" },
    { id: "host", label: "Host" },
    { id: "credential", label: "Credential", defaultHidden: true },
    { id: "actions", label: "Actions", pin: "end" },
];

describe("resolveLayout", () => {
    it("starts with every movable column in its place, the optional ones switched off and the rest from the profile", () => {
        const layout = resolveLayout(columns, null);

        expect(layout).toEqual({ order: ["status", "host", "credential"], hidden: ["credential"] });
        expect(layout.density).toBeUndefined();
        expect(layout.pageSize).toBeUndefined();
    });

    it("drops columns that no longer exist and adds new ones at the end with their default visibility", () => {
        const layout = resolveLayout(columns, { order: ["host", "gone", "status"], hidden: ["gone"], density: "compact" });

        expect(layout).toEqual({ order: ["host", "status", "credential"], hidden: ["credential"], density: "compact" });
    });

    it("keeps an optional column visible once the user switched it on", () => {
        const layout = resolveLayout(columns, { order: ["status", "host", "credential"], hidden: [], density: "comfortable" });

        expect(layout.hidden).toEqual([]);
    });

    it("keeps the rows per page the table was switched to", () => {
        expect(resolveLayout(columns, { order: [], hidden: [], pageSize: 50 }).pageSize).toBe(50);
    });
});

describe("moveColumn", () => {
    it("moves a column and clamps a target past the end", () => {
        expect(moveColumn(["status", "host", "credential"], "status", 1)).toEqual(["host", "status", "credential"]);
        expect(moveColumn(["status", "host", "credential"], "status", 9)).toEqual(["host", "credential", "status"]);
    });
});

describe("isDefaultLayout", () => {
    it("tells a moved layout apart from the defaults", () => {
        const defaults = resolveLayout(columns, null);

        expect(isDefaultLayout(columns, defaults)).toBe(true);
        expect(isDefaultLayout(columns, { ...defaults, order: moveColumn(defaults.order, "host", 0) })).toBe(false);
    });

    it("counts a row height or page size of its own as a change, since the table no longer follows the profile", () => {
        const defaults = resolveLayout(columns, null);

        expect(isDefaultLayout(columns, { ...defaults, density: "comfortable" })).toBe(false);
        expect(isDefaultLayout(columns, { ...defaults, pageSize: 50 })).toBe(false);
    });
});

describe("tanstackOrder and tanstackVisibility", () => {
    it("keeps the checkbox and pinned columns around the movable ones and hides filter-only columns", () => {
        const layout = resolveLayout(columns, null);

        expect(tanstackOrder(columns, layout, true)).toEqual(["select", "name", "status", "host", "credential", "actions", "adapterId"]);
        expect(tanstackVisibility(columns, layout)).toEqual({ credential: false, adapterId: false });
    });
});
