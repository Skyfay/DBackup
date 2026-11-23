/**
 * The exclude patterns of a restore are matched against every file of the archive in the one
 * server process every tenant shares, so a restore takes them only in the shapes a save takes,
 * before it restores anything.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/logging/errors";
import { resolveContents } from "@/services/restore/archive-selection";
import type { ArchiveIndex } from "@/lib/archive/types";

const index = {
    files: [
        { k: "f", src: "s", p: "logs/app.log", s: 1, m: "2026-01-01T00:00:00.000Z" },
        { k: "f", src: "s", p: "data/a.txt", s: 1, m: "2026-01-01T00:00:00.000Z" },
    ],
    databases: [],
    dirs: [],
    deps: [],
} as unknown as ArchiveIndex;

describe("the exclude patterns of a restore of files", () => {
    it("refuses a pattern a save would refuse, before anything is chosen", () => {
        expect(() => resolveContents(index, { excludePatterns: ["logs/*a*a*a*a*a*a*a*b"] })).toThrow(ValidationError);
        expect(() => resolveContents(index, { excludePatterns: ["*a*{a,b,c,d,e,f,g,{h,i}}{a,b,c,d,e,f,g,{h,i}}"] })).toThrow(ValidationError);
    });

    it("still leaves out what an ordinary pattern names", () => {
        const { files } = resolveContents(index, { excludePatterns: ["*.log"] });

        expect(files.map((entry) => entry.file.p)).toEqual(["data/a.txt"]);
    });
});
