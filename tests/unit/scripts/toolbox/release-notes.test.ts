import { describe, expect, it } from "vitest";
import { parseFragment } from "../../../../scripts/toolbox/changelog.mjs";
import { betaNotes, docsAtBeta, fragmentsAt, newSince, previousBeta, releaseNotes } from "../../../../scripts/toolbox/release-notes.mjs";

const CHANGELOG = [
    "# Changelog",
    "",
    "All notable changes to DBackup are documented here.",
    "",
    "## v4.0.2 - Rate Limit and Session Fixes",
    "*Released: Oct 12, 2026*",
    "",
    "### 🐛 Bug Fixes",
    "",
    "- **auth**: A session ends in time.",
    "",
    "## v4.0.1",
    "*Released: Oct 5, 2026*",
    "",
    "### 🐛 Bug Fixes",
    "",
    "- **rsync**: A fix.",
].join("\n");

const FRAGMENT = [
    "> ⚠️ **Before updating:** Everything moves into the first tenant.",
    "",
    "### ✨ Features",
    "",
    "- **tenants**: Tenants for MSPs.",
    "",
    "### 🐛 Bug Fixes",
    "",
    "- **MySQL**: A restore keeps its bytes. Thanks @someone ([#7](https://github.com/Skyfay/DBackup/pull/7))",
    "- **storage**: A new fix.",
].join("\n");

describe("the notes of a release", () => {
    it("takes its block of the changelog with the title as the heading and without the date", () => {
        expect(releaseNotes(CHANGELOG, "4.0.2")).toBe("## Rate Limit and Session Fixes\n\n### 🐛 Bug Fixes\n\n- **auth**: A session ends in time.\n");
    });

    it("keeps the version as the heading of a block without a title", () => {
        expect(releaseNotes(CHANGELOG, "4.0.1")).toMatch(/^## v4\.0\.1\n\n### 🐛 Bug Fixes/);
    });

    it("refuses a version the changelog has no block for, also one that merely starts the same", () => {
        expect(() => releaseNotes(CHANGELOG, "4.0.3")).toThrow(/no block for v4\.0\.3/);
        expect(() => releaseNotes(CHANGELOG, "4.0")).toThrow(/no block/);
    });
});

describe("the beta before a beta", () => {
    const tags = ["v4.0.2", "v4.1.0-beta.1", "v4.1.0-beta.2", "v4.1.0-beta.10", "v4.2.0-beta.1"];

    it("is the one of the same release with the next lower number", () => {
        expect(previousBeta("4.1.0-beta.10", tags)).toBe("4.1.0-beta.2");
        expect(previousBeta("4.1.0-beta.3", tags)).toBe("4.1.0-beta.2");
        expect(previousBeta("4.1.0-beta.2", tags)).toBe("4.1.0-beta.1");
    });

    it("does not exist for the first beta of a release", () => {
        expect(previousBeta("4.1.0-beta.1", tags)).toBeNull();
        expect(previousBeta("4.2.0-beta.1", tags)).toBeNull();
        expect(previousBeta("4.1.0-dev", tags)).toBeNull();
    });
});

describe("the notes of a beta", () => {
    const fragment = parseFragment(FRAGMENT, "Skyfay-msp-tenants.md");
    const earlier = parseFragment(
        FRAGMENT.split("\n").filter((line) => !line.includes("A new fix")).join("\n").replace(/ Thanks @someone.*$/m, ""),
        "Skyfay-msp-tenants.md",
    );

    it("keeps only what the beta before did not have, the thanks not counting as a change", () => {
        const [added] = newSince([fragment], [earlier]);
        expect(added.notes).toEqual([]);
        expect([...added.sections]).toEqual([["### 🐛 Bug Fixes", ["- **storage**: A new fix."]]]);
    });

    it("say it is a beta, list what is new since the beta before, then everything since the last release", () => {
        const notes = betaNotes({ version: "4.1.0-beta.2", fragments: [fragment], since: "4.1.0-beta.1", earlier: [earlier], lastRelease: "4.0.2" });
        const headings = notes.split("\n").filter((line) => line.startsWith("## ") || line.startsWith("> "));
        expect(headings).toEqual([
            "## Beta of v4.1.0",
            expect.stringMatching(/^> 🧪 \*\*Beta:\*\* A preview of v4\.1\.0/),
            "## New since v4.1.0-beta.1",
            "## Everything since v4.0.2",
            "> ⚠️ **Before updating:** Everything moves into the first tenant.",
        ]);
        expect(notes).toContain("- **Image**: `skyfay/dbackup:v4.1.0-beta.2`\n- **Also tagged as**: `beta`");
        expect(notes).not.toContain("CI Image");
    });

    it("point a link to the docs at the page as the beta has it, since the docs site shows main", () => {
        expect(docsAtBeta("See [Before Updating](https://docs.dbackup.app/user-guide/admin/tenants#before-updating).", "5.0.0-beta.1"))
            .toBe("See [Before Updating](https://github.com/Skyfay/DBackup/blob/v5.0.0-beta.1/docs/user-guide/admin/tenants.md#before-updating).");
        expect(docsAtBeta("[guides](https://docs.dbackup.app/user-guide/) and [home](https://docs.dbackup.app/)", "5.0.0-beta.1"))
            .toBe("[guides](https://github.com/Skyfay/DBackup/blob/v5.0.0-beta.1/docs/user-guide/index.md) and [home](https://github.com/Skyfay/DBackup/blob/v5.0.0-beta.1/docs/index.md)");

        const linked = { ...fragment, notes: ["> ⚠️ **Before updating:** Read [Before Updating](https://docs.dbackup.app/user-guide/admin/tenants#before-updating)."] };
        const notes = betaNotes({ version: "4.1.0-beta.1", fragments: [linked], lastRelease: "4.0.2" });
        expect(notes).toContain("https://github.com/Skyfay/DBackup/blob/v4.1.0-beta.1/docs/user-guide/admin/tenants.md#before-updating");
        expect(notes).not.toContain("docs.dbackup.app");
    });

    it("leave out what is new for the first beta, and a part that would be empty", () => {
        const first = betaNotes({ version: "4.1.0-beta.1", fragments: [fragment], lastRelease: "4.0.2" });
        expect(first).not.toContain("New since");
        const same = betaNotes({ version: "4.1.0-beta.2", fragments: [earlier], since: "4.1.0-beta.1", earlier: [earlier], lastRelease: "4.0.2" });
        expect(same).not.toContain("New since");
    });

    it("reads the fragments of the beta before through git", () => {
        const files: Record<string, string> = { "Skyfay-msp-tenants.md": FRAGMENT };
        const exec = (_command: string, args: string[]) => {
            if (args[0] === "ls-tree") return ["README.md", ...Object.keys(files)].join("\n");
            const name = args[1].split("/").pop() ?? "";
            return files[name];
        };
        const [read] = fragmentsAt("v4.1.0-beta.1", exec);
        expect(read.name).toBe("Skyfay-msp-tenants.md");
        expect(read.problems).toEqual([]);
        expect(read.sections.get("### ✨ Features")).toEqual(["- **tenants**: Tenants for MSPs."]);
    });
});
