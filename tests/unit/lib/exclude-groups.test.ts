/**
 * Curated exclude groups and how a preset resolves against them.
 *
 * The reason groups live in code is that a release must be able to extend them without a
 * migration and without overwriting anything a user wrote. That only holds if a preset stores
 * a *reference* and the patterns are resolved at use time - which is what these pin, along
 * with the opt-out that keeps following a curated list from being all-or-nothing.
 */
import { describe, it, expect } from "vitest";
import {
    EXCLUDE_GROUPS,
    currentGroupPattern,
    findExcludeGroup,
    resolveExcludePatterns,
    parseJsonStringArray,
} from "@/lib/exclude-groups";
import { canPruneDirectory, matchesAnyExcludePattern } from "@/lib/exclude-patterns";

describe("exclude group catalogue", () => {
    it("has unique ids", () => {
        const ids = EXCLUDE_GROUPS.map((g) => g.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("gives every group a label and at least one pattern", () => {
        for (const group of EXCLUDE_GROUPS) {
            expect(group.label.length, group.id).toBeGreaterThan(0);
            expect(group.patterns.length, group.id).toBeGreaterThan(0);
        }
    });

    it("covers the files Dropbox refuses outright", () => {
        // .DS_Store is why this whole thing exists: Dropbox rejects it with
        // path/disallowed_name, so a restore carrying it can only fail.
        const all = EXCLUDE_GROUPS.flatMap((g) => g.patterns);
        expect(all).toContain(".DS_Store");
        expect(all).toContain("Thumbs.db");
        expect(all).toContain("desktop.ini");
    });

    it("returns nothing for an unknown id rather than throwing", () => {
        expect(findExcludeGroup("no-such-group")).toBeUndefined();
    });
});

describe("resolveExcludePatterns", () => {
    it("expands a referenced group into its patterns", () => {
        const resolved = resolveExcludePatterns({ groups: ["macos"] });
        expect(resolved).toContain(".DS_Store");
        expect(resolved).toContain("._*");
    });

    it("combines groups with the preset's own patterns", () => {
        const resolved = resolveExcludePatterns({ groups: ["macos"], patterns: ["*.iso"] });
        expect(resolved).toContain(".DS_Store");
        expect(resolved).toContain("*.iso");
    });

    it("drops a single pattern the preset opted out of, keeping the rest of the group", () => {
        // The point of the opt-out: following a curated list is not all-or-nothing.
        const resolved = resolveExcludePatterns({ groups: ["macos"], excludedGroupPatterns: ["**/.Trashes/**"] });
        expect(resolved).not.toContain("**/.Trashes/**");
        expect(resolved).toContain(".DS_Store");
    });

    it("keeps an opt-out stored before the folders of a group matched at any depth", () => {
        // Presets store the opt-out as the pattern string it was then. Changing how a group
        // writes a folder must not quietly start excluding what someone deliberately kept.
        const dev = resolveExcludePatterns({ groups: ["dev"], excludedGroupPatterns: ["dist/**"] });
        expect(dev).not.toContain("**/dist/**");
        expect(dev).toContain("**/node_modules/**");

        const macos = resolveExcludePatterns({ groups: ["macos"], excludedGroupPatterns: [".Trashes"] });
        expect(macos).not.toContain("**/.Trashes/**");
        expect(macos).toContain("**/.Spotlight-V100/**");
    });

    it("never drops the preset's own pattern, even when a group opt-out names it", () => {
        // Opting out applies to what a group contributes; writing it yourself is an explicit
        // decision that must win.
        const resolved = resolveExcludePatterns({
            groups: ["macos"],
            excludedGroupPatterns: [".DS_Store"],
            patterns: [".DS_Store"],
        });
        expect(resolved).toContain(".DS_Store");
    });

    it("deduplicates a pattern that a group and the preset both list", () => {
        const resolved = resolveExcludePatterns({ groups: ["macos"], patterns: [".DS_Store"] });
        expect(resolved.filter((p) => p === ".DS_Store")).toHaveLength(1);
    });

    it("skips a group id that no longer exists", () => {
        // A group removed in a later release must not break a preset still referencing it.
        const resolved = resolveExcludePatterns({ groups: ["macos", "retired-group"] });
        expect(resolved).toContain(".DS_Store");
    });

    it("returns an empty list when nothing is configured", () => {
        expect(resolveExcludePatterns({})).toEqual([]);
    });

    it("resolves fresh each time, so extending a group reaches existing presets", () => {
        // The property the whole design rests on: the preset stores ids, not a snapshot.
        const stored = { groups: ["windows"] };
        expect(resolveExcludePatterns(stored)).toEqual(findExcludeGroup("windows")!.patterns);
    });
});

describe("parseJsonStringArray", () => {
    it("reads a stored array", () => {
        expect(parseJsonStringArray('["a","b"]')).toEqual(["a", "b"]);
    });

    it("treats malformed or absent content as empty rather than throwing", () => {
        // A broken row must not take a backup run down; no exclusions is the safe direction.
        expect(parseJsonStringArray("not json")).toEqual([]);
        expect(parseJsonStringArray(null)).toEqual([]);
        expect(parseJsonStringArray('{"not":"an array"}')).toEqual([]);
    });

    it("drops non-string entries", () => {
        expect(parseJsonStringArray('["a",1,null,"b"]')).toEqual(["a", "b"]);
    });
});

describe("the folders of a group", () => {
    const folders = EXCLUDE_GROUPS.flatMap((group) => group.patterns.filter((pattern) => pattern.endsWith("/**")));
    // A folder whose name is a glob, like .Trash-*, stands in with a real name.
    const nameOf = (pattern: string) => pattern.slice("**/".length, -"/**".length).replace("*", "1000");

    it("are all written to match at any depth", () => {
        expect(folders.length).toBeGreaterThan(0);
        for (const pattern of folders) expect(pattern.startsWith("**/"), pattern).toBe(true);
    });

    it("skip a file inside the folder at the top and deeper down", () => {
        for (const pattern of folders) {
            const name = nameOf(pattern);
            expect(matchesAnyExcludePattern(`${name}/file.bin`, [pattern]), pattern).toBe(true);
            expect(matchesAnyExcludePattern(`app/packages/${name}/deep/file.bin`, [pattern]), pattern).toBe(true);
        }
    });

    it("let the walk prune the folder wherever it lies", () => {
        for (const pattern of folders) {
            expect(canPruneDirectory(`app/${nameOf(pattern)}`, [pattern]), pattern).toBe(pattern);
            // The folder around it holds other files, so it is walked.
            expect(canPruneDirectory("app", [pattern]), pattern).toBeUndefined();
        }
    });

    it("skip what a nested node_modules, .git, __pycache__, logs or .cache holds", () => {
        const patterns = resolveExcludePatterns({ groups: ["dev", "vcs", "logs"] });
        expect(matchesAnyExcludePattern("app/node_modules/react/index.js", patterns)).toBe(true);
        expect(matchesAnyExcludePattern("packages/web/.git/HEAD", patterns)).toBe(true);
        expect(matchesAnyExcludePattern("src/tools/__pycache__/cli.cpython-312.pyc", patterns)).toBe(true);
        expect(matchesAnyExcludePattern("srv/app/logs/today.txt", patterns)).toBe(true);
        expect(matchesAnyExcludePattern("home/manu/.cache/pip/wheel.whl", patterns)).toBe(true);
        expect(matchesAnyExcludePattern("app/src/index.ts", patterns)).toBe(false);
    });

    it("skip the macOS folders a bare name never matched anything in", () => {
        const patterns = resolveExcludePatterns({ groups: ["macos"] });
        expect(matchesAnyExcludePattern(".Spotlight-V100/Store-V2/store.db", patterns)).toBe(true);
        expect(matchesAnyExcludePattern("Volumes/Photos/.Trashes/501/old.jpg", patterns)).toBe(true);
        expect(matchesAnyExcludePattern(".fseventsd/0000000000a1b2c3", patterns)).toBe(true);
    });
});

describe("currentGroupPattern", () => {
    it("names a folder of a group in its current form, whichever form was stored", () => {
        expect(currentGroupPattern("node_modules/**")).toBe("**/node_modules/**");
        expect(currentGroupPattern(".Spotlight-V100")).toBe("**/.Spotlight-V100/**");
        expect(currentGroupPattern("**/node_modules/**")).toBe("**/node_modules/**");
    });

    it("leaves every other pattern as it is", () => {
        expect(currentGroupPattern("*.log")).toBe("*.log");
        expect(currentGroupPattern("data/export/**")).toBe("data/export/**");
    });
});

describe("the preset's own patterns", () => {
    it("keep the rule they were written by, a slash anchors them at the top of the folder", () => {
        // Groups changed how they write a folder, stored patterns did not change their meaning.
        const resolved = resolveExcludePatterns({ patterns: ["node_modules/**"] });
        expect(resolved).toEqual(["node_modules/**"]);
        expect(matchesAnyExcludePattern("node_modules/react/index.js", resolved)).toBe(true);
        expect(matchesAnyExcludePattern("app/node_modules/react/index.js", resolved)).toBe(false);
    });
});
