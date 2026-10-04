import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insertBlock, parseFragment, release, renderBlock } from "../../../scripts/changelog.mjs";

const DIR = "/repo/changelog/unreleased";
const CHANGELOG = "/repo/docs/changelog.md";

const RELEASED = [
    "# Changelog",
    "",
    "All notable changes to DBackup are documented here.",
    "",
    "## v4.0.0 - Redesigned Interface",
    "*Released: Oct 4, 2026*",
    "",
].join("\n");

/** The problems of a fragment, without the line numbers. */
function problemsOf(text: string, name = "Skyfay-fix.md") {
    return parseFragment(text, name).problems.map((problem) => problem.replace(/^line \d+: /, ""));
}

/** Files that exist in memory only, for the release. */
function memoryFiles(files: Record<string, string>) {
    const store = new Map(Object.entries(files));
    vi.spyOn(fs, "existsSync").mockImplementation((target) => [...store.keys()].some((file) => path.dirname(file) === String(target)));
    vi.spyOn(fs, "readdirSync").mockImplementation(((dir: fs.PathLike) =>
        [...store.keys()].filter((file) => path.dirname(file) === String(dir)).map((file) => path.basename(file))) as unknown as typeof fs.readdirSync);
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor) => {
        const content = store.get(String(file));
        if (content === undefined) throw new Error(`ENOENT: ${String(file)}`);
        return content;
    }) as unknown as typeof fs.readFileSync);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data) => {
        store.set(String(file), String(data));
    });
    vi.spyOn(fs, "rmSync").mockImplementation((file) => {
        store.delete(String(file));
    });
    return store;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("a changelog fragment", () => {
    it("takes a breaking note, a note before updating and entries in two sections", () => {
        const fragment = parseFragment(
            [
                "> ⚠️ **Breaking:** The old endpoint is gone.",
                "",
                "> ⚠️ **Before updating:** Back up the database first.",
                "",
                "### 🐛 Bug Fixes",
                "",
                "- **MySQL**: Backups hold the routines again. A login without the right gets a warning.",
                "",
                "### ✨ Features",
                "",
                "- **storage**: Destinations can be marked air-gapped ([#171](https://github.com/Skyfay/DBackup/issues/171)).",
            ].join("\n"),
            "Skyfay-mysql.md"
        );

        expect(fragment.problems).toEqual([]);
        expect(fragment.notes).toEqual([
            "> ⚠️ **Breaking:** The old endpoint is gone.",
            "> ⚠️ **Before updating:** Back up the database first.",
        ]);
        expect([...fragment.sections.keys()]).toEqual(["### 🐛 Bug Fixes", "### ✨ Features"]);
    });

    it("turns down a section the changelog does not have, and the Docker section the release writes", () => {
        expect(problemsOf("### 🚀 Shiny\n\n- **ui**: New.")).toEqual(['"### 🚀 Shiny" is not one of the changelog sections']);
        expect(problemsOf("### 🐳 Docker\n\n- **Image**: `skyfay/dbackup:v1`")).toEqual(["the release writes the Docker section"]);
    });

    it("turns down a version header, which the release writes", () => {
        expect(problemsOf("## vNEXT\n\n### 🐛 Bug Fixes\n\n- **ui**: Fixed.")).toEqual([
            "a fragment has no version header, the release writes it",
        ]);
    });

    it("keeps entries under a section and notes above the first one", () => {
        expect(problemsOf("- **ui**: Fixed.")).toEqual(["an entry goes under a section"]);
        expect(problemsOf("### 🐛 Bug Fixes\n\n- **ui**: Fixed.\n\n> ⚠️ **Breaking:** Late.")).toEqual([
            "a note goes above the first section",
        ]);
        expect(problemsOf("> just a quote")).toEqual(['a note starts with a bold label, like "> ⚠️ **Breaking:**"']);
    });

    it("turns down an entry with a semicolon, a dash or a third sentence", () => {
        expect(problemsOf("### 🐛 Bug Fixes\n\n- **ui**: One part; another part.")).toEqual(["a description has no `;`"]);
        expect(problemsOf("### 🐛 Bug Fixes\n\n- **ui**: One part - another part.")).toEqual(["a description has no ` - ` or `- `"]);
        expect(problemsOf("### 🐛 Bug Fixes\n\n- **ui**: One. Two. Three.")).toEqual([
            "a description has at most two sentences, this one has 3",
        ]);
    });

    it("counts code, versions and a link at the end as no extra sentence", () => {
        expect(
            problemsOf("### 🐛 Bug Fixes\n\n- **api**: `GET /api/jobs` works on v4.0.0 again. It returns `overview.nextRunAt` ([#9](https://github.com/x/y/issues/9)).")
        ).toEqual([]);
    });

    it("turns down a line that is no entry, like a wrapped one", () => {
        expect(problemsOf("### 🐛 Bug Fixes\n\n- **ui**: A long entry\n  that goes on.")).toEqual([
            '"  that goes on." is no entry, write it as - **component**: description',
        ]);
    });

    it("turns down an empty file, an empty section and a file name with a space", () => {
        expect(problemsOf("\n\n")).toEqual(["the fragment is empty"]);
        expect(problemsOf("### 🐛 Bug Fixes\n")).toEqual(['"### 🐛 Bug Fixes" has no entries']);
        expect(problemsOf("### 🐛 Bug Fixes\n\n- **ui**: Fixed.", "my fix.md")).toEqual([
            "the file name holds letters, digits, dots, dashes and underscores and ends in .md",
        ]);
    });
});

describe("the version block of a release", () => {
    const first = parseFragment("### 🐛 Bug Fixes\n\n- **ui**: First fix.", "a.md");
    const second = parseFragment(
        "> ⚠️ **Breaking:** Something breaks.\n\n### 🔧 CI/CD\n\n- **ci**: A pipeline.\n\n### ✨ Features\n\n- **jobs**: A feature.\n\n### 🐛 Bug Fixes\n\n- **api**: Second fix.",
        "b.md"
    );

    it("puts the notes first and the sections in the order of the changelog", () => {
        const block = renderBlock("4.1.0", "`latest`, `v4`", [first, second]);

        expect(block.split("\n").slice(0, 18)).toEqual([
            "## v4.1.0",
            "*Release: In Progress*",
            "",
            "> ⚠️ **Breaking:** Something breaks.",
            "",
            "### ✨ Features",
            "",
            "- **jobs**: A feature.",
            "",
            "### 🐛 Bug Fixes",
            "",
            "- **ui**: First fix.",
            "- **api**: Second fix.",
            "",
            "### 🔧 CI/CD",
            "",
            "- **ci**: A pipeline.",
            "",
        ]);
    });

    it("ends with the Docker section of the version and its tags", () => {
        const block = renderBlock("4.1.0", "`latest`, `v4`", [first]);

        expect(block.endsWith(
            [
                "### 🐳 Docker",
                "",
                "- **Image**: `skyfay/dbackup:v4.1.0`",
                "- **Also tagged as**: `latest`, `v4`",
                "- **CI Image**: `skyfay/dbackup:ci`",
                "- **Platforms**: linux/amd64, linux/arm64",
            ].join("\n")
        )).toBe(true);
    });

    it("goes above the newest version with one blank line before it", () => {
        const changelog = insertBlock(RELEASED, "## v4.1.0\n*Release: In Progress*");

        expect(changelog).toBe(
            [
                "# Changelog",
                "",
                "All notable changes to DBackup are documented here.",
                "",
                "## v4.1.0",
                "*Release: In Progress*",
                "",
                "## v4.0.0 - Redesigned Interface",
                "*Released: Oct 4, 2026*",
                "",
            ].join("\n")
        );
    });
});

describe("a release", () => {
    it("writes the block into the changelog and deletes the fragments, but keeps the README", () => {
        const files = memoryFiles({
            [CHANGELOG]: RELEASED,
            [`${DIR}/README.md`]: "# Unreleased changelog entries",
            [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **ui**: Fixed.",
        });

        const used = release({ version: "4.1.0", tags: "`latest`, `v4`", dir: DIR, changelog: CHANGELOG });

        expect(used.map((fragment) => fragment.name)).toEqual(["Skyfay-fix.md"]);
        expect(files.get(CHANGELOG)).toContain("## v4.1.0\n*Release: In Progress*\n\n### 🐛 Bug Fixes\n\n- **ui**: Fixed.");
        expect([...files.keys()]).toEqual([CHANGELOG, `${DIR}/README.md`]);
    });

    it("changes nothing while a fragment breaks the format", () => {
        const files = memoryFiles({
            [CHANGELOG]: RELEASED,
            [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **ui**: One; two.",
        });

        expect(() => release({ version: "4.1.0", tags: "`latest`, `v4`", dir: DIR, changelog: CHANGELOG })).toThrow(
            /Skyfay-fix\.md: line 3: a description has no `;`/
        );
        expect(files.get(CHANGELOG)).toBe(RELEASED);
        expect(files.has(`${DIR}/Skyfay-fix.md`)).toBe(true);
    });

    it("refuses a version the changelog lists already", () => {
        const files = memoryFiles({
            [CHANGELOG]: RELEASED,
            [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **ui**: Fixed.",
        });

        expect(() => release({ version: "4.0.0", tags: "`latest`, `v4`", dir: DIR, changelog: CHANGELOG })).toThrow(/already lists v4\.0\.0/);
        expect(files.has(`${DIR}/Skyfay-fix.md`)).toBe(true);
    });
});
