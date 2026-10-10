/**
 * Lint Guard: changelog entries go into fragments.
 *
 * Every pull request writes its changelog entries into a file of its own under
 * `changelog/unreleased/`, and the release collects them into `docs/changelog.md`. Entries
 * written straight into the changelog made every pair of pull requests conflict, so this guard
 * checks the format of every fragment and keeps unreleased blocks out of the changelog itself.
 * The format is described in `changelog/unreleased/README.md`.
 *
 * Run with: pnpm test tests/unit/lint-guards/changelog-fragments.test.ts
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import { CHANGELOG, FRAGMENT_DIR, SECTIONS, readFragments } from "../../../scripts/toolbox/changelog.mjs";

describe("Lint Guard: changelog fragments", () => {
    it("follow the format of the changelog", () => {
        const problems = readFragments(FRAGMENT_DIR).flatMap((fragment) =>
            fragment.problems.map((problem) => `changelog/unreleased/${fragment.name}: ${problem}`)
        );
        expect(problems, "Fix these fragments, see changelog/unreleased/README.md").toEqual([]);
    });

    it("leave the changelog to the release, which writes no vNEXT block", () => {
        const changelog = fs.readFileSync(CHANGELOG, "utf-8");
        expect(
            /^## vNEXT/m.test(changelog),
            "docs/changelog.md has a vNEXT block, move its entries into a fragment under changelog/unreleased/"
        ).toBe(false);
    });

    it("use the section headings the changelog already shows", () => {
        const changelog = fs.readFileSync(CHANGELOG, "utf-8");
        const missing = SECTIONS.filter((heading) => !changelog.includes(`\n${heading}\n`));
        expect(missing, "scripts/toolbox/changelog.mjs names a section the changelog spells differently").toEqual([]);
    });
});
