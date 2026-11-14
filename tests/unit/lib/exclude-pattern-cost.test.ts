import { describe, expect, it, vi } from "vitest";
import { Minimatch } from "minimatch";
import { EXCLUDE_GROUPS } from "@/lib/exclude-groups";
import { excludePatternProblem, excludePatternsProblem, isPlainPattern, matchPlainPattern } from "@/lib/exclude-pattern-rules";
import { canPruneDirectory, matchesAnyExcludePattern, matchesExcludePattern } from "@/lib/exclude-patterns";
import { ValidationError } from "@/lib/logging/errors";

vi.mock("@/lib/prisma", () => ({
    default: { excludePatternPreset: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));

/** How long a call holds the one thread of the server. */
function heldMs(run: () => void): number {
    const start = performance.now();
    run();
    return performance.now() - start;
}

describe("an exclude pattern of one tenant cannot hold the server of every tenant", () => {
    it("matches a pattern of many wildcards against a name that repeats its letter without stalling", () => {
        // Took 17 seconds in the glob library, during which no request of any tenant was answered.
        const name = `${"a".repeat(60)}.txt`;
        let matched = true;
        const held = heldMs(() => { matched = matchesExcludePattern(`photos/${name}`, "*a*a*a*a*a*a*a*b"); });

        expect(matched).toBe(false);
        expect(held).toBeLessThan(500);
    });

    it("stays fast for an object key of a thousand characters and for a folder that is checked for pruning", () => {
        const name = "a".repeat(1000);
        const held = heldMs(() => {
            expect(matchesAnyExcludePattern(name, ["*a*a*a*b", "*a*a*a*a*a*a*a*a*a*a*c"])).toBe(false);
            expect(canPruneDirectory(name, ["*a*a*a*a*a*a*a*b"])).toBeUndefined();
        });

        expect(held).toBeLessThan(500);
    });

    it.each([
        ["logs/*a*a*a*b", "three wildcards in one part of a path"],
        ["*[a]*[a]*[a]b", "three wildcards beside a class"],
        ["{*a,*a}*a*a[b]", "wildcards spread over braces"],
        ["*a{/,x}*a*a*b", "a brace that joins two parts of a path"],
        ["+(a|aa)b", "a group that repeats"],
        ["*(a)*(a)b", "a group of any count"],
        ["file{1..100000}", "a range that expands to many names"],
        ["{a,b}{a,b}{a,b}{a,b}{a,b}x", "too many brace groups"],
        ["a".repeat(1001), "a pattern longer than a path gets"],
    ])("refuses %s, %s", (pattern) => {
        expect(excludePatternProblem(pattern)).toEqual(expect.any(String));
    });

    it("refuses to match a pattern the save would refuse, instead of running it", () => {
        expect(() => matchesExcludePattern(`logs/${"a".repeat(255)}`, "logs/*a*a*a*b")).toThrow(ValidationError);
        expect(() => canPruneDirectory("logs", ["logs/*a*a*a*b"])).toThrow(ValidationError);
    });

    it("keeps every pattern of the built-in groups and the usual ones of a job", () => {
        const builtIn = EXCLUDE_GROUPS.flatMap((group) => group.patterns);
        const usual = ["*.tmp", "node_modules/**", "**/.git/**", "*.log.[0-9]*", "{cache,tmp}/**", "dir/**/*.log", "backup-*-*.tar", "lost+found", "**/*.{jpg,png}", "a/*-*.bak"];
        for (const pattern of [...builtIn, ...usual]) expect([pattern, excludePatternProblem(pattern)]).toEqual([pattern, null]);
        expect(builtIn.length).toBeGreaterThan(10);
    });

    it("limits how many patterns a source or a preset holds and takes only text", () => {
        expect(excludePatternsProblem(Array<string>(500).fill("*.tmp"))).toBeNull();
        expect(excludePatternsProblem(Array<string>(501).fill("*.tmp"))).toEqual(expect.any(String));
        expect(excludePatternsProblem(["*.tmp", { set: "x" }])).toEqual(expect.any(String));
    });

    it("refuses a preset with such a pattern on create and on update, before anything is stored", async () => {
        const prisma = (await import("@/lib/prisma")).default;
        const { createExcludePatternPreset, updateExcludePatternPreset } = await import("@/services/templates/exclude-pattern-preset-service");
        vi.mocked(prisma.excludePatternPreset.findUnique).mockResolvedValue({ id: "preset-1", name: "Logs" } as never);

        await expect(createExcludePatternPreset({ name: "Logs", patterns: ["logs/*a*a*a*b"] })).rejects.toThrow(ValidationError);
        await expect(updateExcludePatternPreset("preset-1", { patterns: ["+(a|aa)b"] })).rejects.toThrow(ValidationError);
        expect(prisma.excludePatternPreset.create).not.toHaveBeenCalled();
        expect(prisma.excludePatternPreset.update).not.toHaveBeenCalled();
    });
});

describe("the plain matcher excludes exactly what the glob library excluded", () => {
    const reference = (path: string, pattern: string) => new Minimatch(pattern, { dot: true, matchBase: true }).match(path);

    it.each([
        ["*.tmp", "a/b/file.tmp", true],
        ["*.tmp", "a/b/file.tmp.keep", false],
        ["*~", "notes.txt~", true],
        ["._*", "dir/._meta", true],
        ["*", ".hidden", true],
        ["?", "a", true],
        ["?", "ab", false],
        ["node_modules", "app/node_modules", true],
        ["node_modules", "app/node_modules/react/index.js", false],
        ["**", "a/.b", true],
        ["a*", "a", true],
        ["*.log", "dir.log/", true],
    ])("pattern %s against %s", (pattern, path, expected) => {
        expect(isPlainPattern(pattern)).toBe(true);
        expect(matchesExcludePattern(path, pattern)).toBe(expected);
        expect(reference(path, pattern)).toBe(expected);
    });

    it("agrees with the glob library on a few thousand generated patterns and paths", () => {
        // A fixed seed, so a failure names the same pair on every run.
        let seed = 20261111;
        const random = (below: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % below;
        };
        const word = (alphabet: string, most: number) => Array.from({ length: random(most + 1) }, () => alphabet[random(alphabet.length)]).join("");
        const differing: [string, string][] = [];
        for (let round = 0; round < 4000; round++) {
            const pattern = word("ab.*?*", 6);
            const path = [word("ab.", 3), word("ab.", 5)].filter((_, index) => index === 1 || random(2) === 0).join("/");
            if (pattern.trim() === "" || !isPlainPattern(pattern)) continue;
            if (matchesExcludePattern(path, pattern) !== reference(path, pattern)) differing.push([pattern, path]);
        }

        expect(differing).toEqual([]);
    });

    it("matches a wildcard in the middle, at both ends and beside a question mark", () => {
        expect(matchPlainPattern("backup-2026-11.tar", "backup-*-*.tar")).toBe(true);
        expect(matchPlainPattern("backup-2026.tar", "backup-*-*.tar")).toBe(false);
        expect(matchPlainPattern("abc", "*b?")).toBe(true);
        expect(matchPlainPattern("abc", "a**c")).toBe(true);
        expect(matchPlainPattern("", "*")).toBe(true);
    });
});
