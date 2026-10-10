import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    amend,
    creditAll,
    creditFragment,
    findContribution,
    insertBlock,
    listedVersions,
    parseFragment,
    release,
    renderBlock,
} from "../../../../scripts/toolbox/changelog.mjs";

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
            // Grouped by component, so api comes before ui.
            "- **api**: Second fix.",
            "- **ui**: First fix.",
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

describe("the entries of a section", () => {
    it("are grouped by component in the order of the alphabet, each keeping the order of its fragments", () => {
        const first = parseFragment(
            "### ✨ Features\n\n- **storage**: Storage one.\n- **MSSQL**: MSSQL one.\n- **auth**: Auth one.",
            "a.md",
        );
        const second = parseFragment(
            "### ✨ Features\n\n- **Auth**: Auth two.\n- **storage**: Storage two.\n- **backup**: Backup one.",
            "b.md",
        );

        const block = renderBlock("4.1.0", "`latest`, `v4`", [first, second]);
        const features = block.split("\n").filter((line) => line.startsWith("- **") && !line.startsWith("- **Image"));
        expect(features.slice(0, 6)).toEqual([
            "- **auth**: Auth one.",
            "- **Auth**: Auth two.",
            "- **backup**: Backup one.",
            "- **MSSQL**: MSSQL one.",
            "- **storage**: Storage one.",
            "- **storage**: Storage two.",
        ]);
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

    it("releases a version whose beta the changelog lists already", () => {
        const files = memoryFiles({
            [CHANGELOG]: RELEASED.replace("## v4.0.0 - Redesigned Interface", "## v4.1.0-beta - Preview"),
            [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **ui**: Fixed.",
        });

        release({ version: "4.1.0", tags: "`latest`, `v4`", dir: DIR, changelog: CHANGELOG });
        expect(files.get(CHANGELOG)).toMatch(/^## v4\.1\.0$/m);
    });
});

describe("the thanks of an outside contribution", () => {
    const PR_127 = "Thanks @Shlok-Zanwar ([#127](https://github.com/Skyfay/DBackup/pull/127))";
    const contribution = { author: "Shlok-Zanwar", number: 127 };

    it("goes at the end of every entry of the fragment", () => {
        const fragment = parseFragment(
            "### 🐛 Bug Fixes\n\n- **webhooks**: Fixed the method.\n\n### ✨ Features\n\n- **explorer**: Navigates back.",
            "fix-webhook-method.md",
        );
        const credited = creditFragment(fragment, contribution);
        expect(credited.sections.get("### 🐛 Bug Fixes")).toEqual([`- **webhooks**: Fixed the method. ${PR_127}`]);
        expect(credited.sections.get("### ✨ Features")).toEqual([`- **explorer**: Navigates back. ${PR_127}`]);
        // The fragment read from disk stays as it was.
        expect(fragment.sections.get("### 🐛 Bug Fixes")).toEqual(["- **webhooks**: Fixed the method."]);
    });

    it("leaves an entry that thanks someone already, and a fragment without a contribution", () => {
        const advisory =
            "- **adapters**: Secrets stay hidden. Thanks @YHalo-wyh ([GHSA-cj5h-46h6-72wc](https://github.com/Skyfay/DBackup/security/advisories/GHSA-cj5h-46h6-72wc))";
        const fragment = parseFragment(`### 🔒 Security\n\n${advisory}`, "fix.md");
        expect(creditFragment(fragment, contribution).sections.get("### 🔒 Security")).toEqual([advisory]);
        expect(creditFragment(fragment, null)).toBe(fragment);
    });

    it("ends up in the version block of the release", () => {
        const files = memoryFiles({
            [CHANGELOG]: RELEASED,
            [`${DIR}/fix-webhook-method.md`]: "### 🐛 Bug Fixes\n\n- **webhooks**: Fixed the method.",
        });

        release({
            version: "4.1.0",
            tags: "`latest`, `v4`",
            dir: DIR,
            changelog: CHANGELOG,
            credit: (fragments) => creditAll(fragments, () => contribution).fragments,
        });

        expect(files.get(CHANGELOG)).toContain(`- **webhooks**: Fixed the method. ${PR_127}`);
    });

    it("is left out for a fragment whose lookup fails, which the release names", () => {
        const fragments = [
            parseFragment("### 🐛 Bug Fixes\n\n- **ui**: One.", "a.md"),
            parseFragment("### 🐛 Bug Fixes\n\n- **api**: Two.", "b.md"),
        ];
        const { fragments: credited, missing } = creditAll(fragments, (name) => {
            if (name === "a.md") throw new Error("gh: not logged in");
            return contribution;
        });
        expect(missing).toEqual(["a.md"]);
        expect(credited[0]).toBe(fragments[0]);
        expect(credited[1]?.sections.get("### 🐛 Bug Fixes")).toEqual([`- **api**: Two. ${PR_127}`]);
    });
});

describe("the pull request behind a fragment", () => {
    const SHA = "b67382c20c9cfe746c3913cf889c4285e400c497";

    /** Answers git with the commit that added the fragment and gh with the pull request. */
    function answers(git: string, gh: string) {
        const calls: Array<[string, string[]]> = [];
        const run = (command: string, args: string[]) => {
            calls.push([command, args]);
            return command === "git" ? git : gh;
        };
        return { run, calls };
    }

    it("is the pull request of the commit that added the file, with its author", () => {
        const { run, calls } = answers(`${SHA}\n`, "127\tShlok-Zanwar\tUser\n");
        expect(findContribution("fix.md", { dir: DIR, run })).toEqual({ author: "Shlok-Zanwar", number: 127 });
        expect(calls[0]).toEqual(["git", ["log", "-1", "--diff-filter=A", "--format=%H", "--", `${DIR}/fix.md`]]);
        expect(calls[1]?.[1]).toContain(`repos/Skyfay/DBackup/commits/${SHA}/pulls`);
    });

    it("thanks nobody for a maintainer's pull request, a bot's, or a fragment without one", () => {
        expect(findContribution("a.md", { dir: DIR, ...answers(SHA, "130\tSkyfay\tUser") })).toBeNull();
        expect(findContribution("a.md", { dir: DIR, ...answers(SHA, "90\tdependabot[bot]\tBot") })).toBeNull();
        expect(findContribution("a.md", { dir: DIR, ...answers(SHA, "") })).toBeNull();
        // A fragment that is not committed yet.
        expect(findContribution("a.md", { dir: DIR, ...answers("", "unused") })).toBeNull();
    });

    it("turns down an answer that does not look like what GitHub hands out", () => {
        for (const gh of ["127\tevil)](https://x.example)\tUser", "0\tsomeone\tUser", "127\t-dash\tUser"]) {
            expect(() => findContribution("a.md", { dir: DIR, ...answers(SHA, gh) })).toThrow(/no pull request/);
        }
        expect(() => findContribution("a.md", { dir: DIR, ...answers("not-a-sha", "") })).toThrow(/no commit/);
    });
});

describe("adding fragments to a version block written already", () => {
    const BUMPED = [
        "# Changelog",
        "",
        "All notable changes to DBackup are documented here.",
        "",
        "## v4.0.1 - Offline First Start",
        "*Released: Oct 10, 2026*",
        "",
        "### 🐛 Bug Fixes",
        "",
        "- **docker**: A new container starts without internet access.",
        "- **Rsync**: A run no longer warns about known_hosts. ([#178](https://github.com/Skyfay/DBackup/issues/178))",
        "",
        "### 🐳 Docker",
        "",
        "- **Image**: `skyfay/dbackup:v4.0.1`",
        "- **Also tagged as**: `latest`, `v4`",
        "- **CI Image**: `skyfay/dbackup:ci`",
        "- **Platforms**: linux/amd64, linux/arm64",
        "",
        "## v4.0.0 - Redesigned Interface",
        "*Released: Oct 4, 2026*",
        "",
    ].join("\n");

    it("sorts the new entries in among the old ones and keeps the title, the date and the Docker section", () => {
        const files = memoryFiles({
            [CHANGELOG]: BUMPED,
            [`${DIR}/codeql-findings.md`]: "### 🐛 Bug Fixes\n\n- **jobs**: Fixed.\n\n### 🔧 CI/CD\n\n- **ci**: Faster.",
            [`${DIR}/README.md`]: "Explains the fragments.",
        });

        amend({ version: "4.0.1", dir: DIR, changelog: CHANGELOG });
        expect(files.get(CHANGELOG)).toBe(
            BUMPED.replace(
                "- **docker**: A new container starts without internet access.\n",
                "- **docker**: A new container starts without internet access.\n- **jobs**: Fixed.\n",
            ).replace("\n### 🐳 Docker", "\n### 🔧 CI/CD\n\n- **ci**: Faster.\n\n### 🐳 Docker"),
        );
        expect(files.has(`${DIR}/codeql-findings.md`)).toBe(false);
        expect(files.has(`${DIR}/README.md`)).toBe(true);
    });

    it("refuses a block with a line it cannot read, and changes nothing", () => {
        const handWritten = BUMPED.replace("*Released: Oct 10, 2026*\n", "*Released: Oct 10, 2026*\n\nA paragraph written by hand.\n");
        const files = memoryFiles({
            [CHANGELOG]: handWritten,
            [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **ui**: Fixed.",
        });

        expect(() => amend({ version: "4.0.1", dir: DIR, changelog: CHANGELOG })).toThrow(/by hand/);
        expect(files.get(CHANGELOG)).toBe(handWritten);
        expect(files.has(`${DIR}/Skyfay-fix.md`)).toBe(true);
    });

    it("refuses a version the changelog has no block for, and an empty fragment folder", () => {
        memoryFiles({ [CHANGELOG]: BUMPED, [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **ui**: Fixed." });
        expect(() => amend({ version: "9.9.9", dir: DIR, changelog: CHANGELOG })).toThrow(/no block for v9\.9\.9/);

        vi.restoreAllMocks();
        memoryFiles({ [CHANGELOG]: BUMPED });
        expect(() => amend({ version: "4.0.1", dir: DIR, changelog: CHANGELOG })).toThrow(/no fragments/);
    });

    it("lists the versions of the changelog, newest first", () => {
        expect(listedVersions(BUMPED)).toEqual(["4.0.1", "4.0.0"]);
    });
});
