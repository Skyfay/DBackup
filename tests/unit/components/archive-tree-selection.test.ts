import { describe, it, expect } from "vitest";
import {
    isCovered,
    hasCoveredDescendant,
    toggleSelection,
    type TreeLevelEntry,
} from "@/components/dashboard/storage/archive-tree-selection";

/**
 * Loaded tree levels, as the lazy tree would hold them after the user expanded www and
 * www/assets:
 *
 *   /            www/, docs/, index.php
 *   www/         assets/, app.css
 *   www/assets/  logo.png, icons/
 */
const levels: Record<string, TreeLevelEntry[]> = {
    "": [{ path: "www" }, { path: "docs" }, { path: "index.php" }],
    "www": [{ path: "www/assets" }, { path: "www/app.css" }],
    "www/assets": [{ path: "www/assets/logo.png" }, { path: "www/assets/icons" }],
};

describe("isCovered / hasCoveredDescendant", () => {
    it("covers everything when the selection is null", () => {
        expect(isCovered(null, "www/assets/logo.png")).toBe(true);
        expect(hasCoveredDescendant(null, "www")).toBe(true);
    });

    it("covers a path through its ancestor, not through name prefixes", () => {
        expect(isCovered(["www"], "www/app.css")).toBe(true);
        // "www" must not cover "wwwroot" - sibling with a shared name prefix.
        expect(isCovered(["www"], "wwwroot")).toBe(false);
    });

    it("reports partial coverage for a folder with a selected descendant", () => {
        expect(hasCoveredDescendant(["www/app.css"], "www")).toBe(true);
        expect(hasCoveredDescendant(["docs"], "www")).toBe(false);
    });
});

describe("toggleSelection - unchecking", () => {
    it("splits 'everything' into explicit siblings when a deep file is unchecked", () => {
        const next = toggleSelection(null, "www/assets/logo.png", levels);

        expect(next).not.toBeNull();
        expect([...next!].sort()).toEqual(["docs", "index.php", "www/app.css", "www/assets/icons"]);
        // The unchecked file is gone, everything else is still covered.
        expect(isCovered(next, "www/assets/logo.png")).toBe(false);
        expect(isCovered(next, "www/assets/icons")).toBe(true);
        expect(isCovered(next, "www/app.css")).toBe(true);
        expect(isCovered(next, "docs")).toBe(true);
    });

    it("splits a selected folder when one of its children is unchecked", () => {
        const next = toggleSelection(["www"], "www/app.css", levels);

        expect([...(next as string[])].sort()).toEqual(["www/assets"]);
        expect(isCovered(next, "www/app.css")).toBe(false);
        expect(isCovered(next, "www/assets/logo.png")).toBe(true);
    });

    it("removes an explicitly selected path without touching anything else", () => {
        const next = toggleSelection(["docs", "www/app.css"], "docs", levels);
        expect(next).toEqual(["www/app.css"]);
    });

    it("unchecking the last covered entry leaves an empty selection", () => {
        const next = toggleSelection(["docs"], "docs", levels);
        expect(next).toEqual([]);
    });
});

describe("toggleSelection - checking", () => {
    it("adds a path and swallows explicitly selected descendants", () => {
        const next = toggleSelection(["www/app.css", "www/assets/logo.png"], "www", levels);
        expect(next).toEqual(["www"]);
    });

    it("collapses back to 'everything' once every root entry is covered", () => {
        // docs + index.php selected; checking www covers all three roots.
        const next = toggleSelection(["docs", "index.php"], "www", levels);
        expect(next).toBeNull();
    });

    it("round-trips: uncheck deep, re-check, back to everything", () => {
        const without = toggleSelection(null, "www/assets/logo.png", levels);
        const restored = toggleSelection(without, "www/assets/logo.png", levels);
        expect(restored).toBeNull();
    });

    it("does not collapse while a root entry is still uncovered", () => {
        const next = toggleSelection(["docs"], "index.php", levels);
        expect(next).not.toBeNull();
        expect([...(next as string[])].sort()).toEqual(["docs", "index.php"]);
    });
});
