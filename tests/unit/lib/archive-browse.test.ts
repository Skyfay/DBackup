import { describe, it, expect } from "vitest";
import { browseLevel, resolveSelection, totalSize } from "@/lib/archive/browse";
import type { ArchiveIndex, IndexFileLine } from "@/lib/archive/types";

function file(src: string, p: string, s: number): IndexFileLine {
    return { k: "f", src, p, s, m: "2026-07-22T10:00:00.000Z", h: `hash-${p}`, n: 1 };
}

const index: ArchiveIndex = {
    header: { k: "h", v: 2, createdAt: "2026-07-22T10:00:00.000Z", archive: "backup.tar" },
    entries: new Map(),
    deps: [],
    databases: [],
    directories: [],
    files: [
        file("src-1", "index.php", 100),
        file("src-1", "README.md", 50),
        file("src-1", "www/app.css", 200),
        file("src-1", "www/app.js", 300),
        file("src-1", "www/assets/logo.png", 4000),
        file("src-1", "www/assets/icons/home.svg", 500),
        file("src-1", "vendor/lib/a.php", 10),
        file("src-2", "other/thing.txt", 7),
    ],
};

describe("browseLevel", () => {
    it("lists the root level with directories before files, both sorted by name", () => {
        // Sorting is locale-aware, so "index.php" precedes "README.md" - byte order would
        // instead group every uppercase name first, which reads wrong in a file browser.
        expect(browseLevel(index, "src-1")).toEqual([
            { name: "vendor", path: "vendor", type: "directory", size: 10, fileCount: 1 },
            { name: "www", path: "www", type: "directory", size: 5000, fileCount: 4 },
            { name: "index.php", path: "index.php", type: "file", size: 100, mtime: "2026-07-22T10:00:00.000Z", checksum: "hash-index.php" },
            { name: "README.md", path: "README.md", type: "file", size: 50, mtime: "2026-07-22T10:00:00.000Z", checksum: "hash-README.md" },
        ]);
    });

    it("rolls nested content up into the directory it sits under", () => {
        // "www" reports 5000 bytes across 4 files, including the two under assets/.
        const root = browseLevel(index, "src-1");
        const www = root.find((e) => e.name === "www")!;
        expect(www.size).toBe(200 + 300 + 4000 + 500);
        expect(www.fileCount).toBe(4);
    });

    it("lists a nested level", () => {
        expect(browseLevel(index, "src-1", "www")).toEqual([
            { name: "assets", path: "www/assets", type: "directory", size: 4500, fileCount: 2 },
            { name: "app.css", path: "www/app.css", type: "file", size: 200, mtime: "2026-07-22T10:00:00.000Z", checksum: "hash-www/app.css" },
            { name: "app.js", path: "www/app.js", type: "file", size: 300, mtime: "2026-07-22T10:00:00.000Z", checksum: "hash-www/app.js" },
        ]);
    });

    it("tolerates leading and trailing slashes in the prefix", () => {
        expect(browseLevel(index, "src-1", "/www/")).toEqual(browseLevel(index, "src-1", "www"));
        expect(browseLevel(index, "src-1", "")).toEqual(browseLevel(index, "src-1"));
    });

    it("never leaks entries from another directory source", () => {
        expect(browseLevel(index, "src-2").map((e) => e.name)).toEqual(["other"]);
        expect(browseLevel(index, "src-1").some((e) => e.name === "other")).toBe(false);
    });

    it("returns nothing for an unknown source or prefix", () => {
        expect(browseLevel(index, "nope")).toEqual([]);
        expect(browseLevel(index, "src-1", "does/not/exist")).toEqual([]);
    });

    it("does not treat a prefix as a match for a sibling with the same leading characters", () => {
        const tricky: ArchiveIndex = { ...index, files: [file("s", "app/one.txt", 1), file("s", "application/two.txt", 2)] };
        expect(browseLevel(tricky, "s", "app").map((e) => e.name)).toEqual(["one.txt"]);
    });
});

describe("resolveSelection", () => {
    it("expands a directory into everything beneath it", () => {
        const resolved = resolveSelection(index, "src-1", ["www"]);
        expect(resolved.map((f) => f.p).sort()).toEqual([
            "www/app.css", "www/app.js", "www/assets/icons/home.svg", "www/assets/logo.png",
        ]);
        expect(totalSize(resolved)).toBe(5000);
    });

    it("resolves an exact file path", () => {
        expect(resolveSelection(index, "src-1", ["index.php"]).map((f) => f.p)).toEqual(["index.php"]);
    });

    it("does not double-count a file selected both directly and via its directory", () => {
        const resolved = resolveSelection(index, "src-1", ["www", "www/app.css"]);
        expect(resolved.filter((f) => f.p === "www/app.css")).toHaveLength(1);
    });

    it("never crosses into another directory source", () => {
        expect(resolveSelection(index, "src-1", ["other"])).toEqual([]);
    });

    it("does not match a sibling directory sharing a name prefix", () => {
        const tricky: ArchiveIndex = { ...index, files: [file("s", "app/one.txt", 1), file("s", "application/two.txt", 2)] };
        expect(resolveSelection(tricky, "s", ["app"]).map((f) => f.p)).toEqual(["app/one.txt"]);
    });

    it("returns nothing for an empty selection", () => {
        expect(resolveSelection(index, "src-1", [])).toEqual([]);
    });
});
