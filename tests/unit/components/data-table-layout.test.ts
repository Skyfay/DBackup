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
    it("starts with every movable column in its place and the optional ones switched off", () => {
        expect(resolveLayout(columns, null)).toEqual({ order: ["status", "host", "credential"], hidden: ["credential"], density: "comfortable" });
    });

    it("drops columns that no longer exist and adds new ones at the end with their default visibility", () => {
        const layout = resolveLayout(columns, { order: ["host", "gone", "status"], hidden: ["gone"], density: "compact" });

        expect(layout).toEqual({ order: ["host", "status", "credential"], hidden: ["credential"], density: "compact" });
    });

    it("keeps an optional column visible once the user switched it on", () => {
        const layout = resolveLayout(columns, { order: ["status", "host", "credential"], hidden: [], density: "comfortable" });

        expect(layout.hidden).toEqual([]);
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
});

describe("tanstackOrder and tanstackVisibility", () => {
    it("keeps the checkbox and pinned columns around the movable ones and hides filter-only columns", () => {
        const layout = resolveLayout(columns, null);

        expect(tanstackOrder(columns, layout, true)).toEqual(["select", "name", "status", "host", "credential", "actions", "adapterId"]);
        expect(tanstackVisibility(columns, layout)).toEqual({ credential: false, adapterId: false });
    });
});
