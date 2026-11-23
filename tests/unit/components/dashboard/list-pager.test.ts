import { describe, it, expect } from "vitest";
import { pagerItems, type PagerItem } from "@/components/dashboard/widgets/list-pager";

/** Page numbers as the pager shows them, from 1, with "..." for a gap. */
const shown = (items: PagerItem[]) => items.map((item) => (item.kind === "gap" ? "..." : String(item.page + 1)));

describe("pagerItems", () => {
    it("shows every page up to five", () => {
        expect(shown(pagerItems(0, 1))).toEqual(["1"]);
        expect(shown(pagerItems(2, 3))).toEqual(["1", "2", "3"]);
        expect(shown(pagerItems(4, 5))).toEqual(["1", "2", "3", "4", "5"]);
    });

    it("shows the first, the last and the pages around the current one beyond five", () => {
        expect(shown(pagerItems(4, 9))).toEqual(["1", "...", "4", "5", "6", "...", "9"]);
    });

    it("leaves no gap at the start or the end", () => {
        expect(shown(pagerItems(0, 9))).toEqual(["1", "2", "...", "9"]);
        expect(shown(pagerItems(8, 9))).toEqual(["1", "...", "8", "9"]);
        expect(shown(pagerItems(2, 9))).toEqual(["1", "2", "3", "4", "...", "9"]);
    });

    it("gives every gap its own key", () => {
        const keys = pagerItems(4, 9).filter((item) => item.kind === "gap").map((item) => item.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
