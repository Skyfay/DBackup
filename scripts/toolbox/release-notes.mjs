// @ts-check
/**
 * The notes of a GitHub release, which the release workflow prints and publishes:
 *
 *   pnpm changelog:notes v4.1.0          the block of a release from docs/changelog.md
 *   pnpm changelog:notes v4.1.0-beta.2   the notes of a beta from the fragments
 *
 * A release takes its block from the changelog, with its title as the heading and without the
 * date line, which GitHub shows itself. A beta has no block, the changelog lists releases only.
 * Its notes are made of the fragments that wait for the release it previews, so they hold
 * everything since the last release, with what came since the beta before it on top. The release
 * after the betas then writes the one block of the changelog from the same fragments.
 */

import fs from "node:fs";
import { CHANGELOG, creditWithWarning, dockerSection, listedVersions, parseFragment, readFragments, renderSections } from "./changelog.mjs";
import { fail, messageOf, out, run } from "./cli.mjs";
import { TAG } from "./release-tag.mjs";
import { dockerTags, isPreview, releaseOf } from "./version.mjs";

/** @typedef {import("./changelog.mjs").Fragment} Fragment */

/** The thanks the release adds to an entry of an outside pull request, see `creditFragment`. */
const THANKS = / Thanks @[A-Za-z0-9-]+ \(\[#\d+\]\([^)]+\)\)$/;

/**
 * The notes of a release: its block of the changelog, with the title as the heading, like the
 * release workflow always published it.
 *
 * @param {string} changelog The text of docs/changelog.md.
 * @param {string} version Without the leading `v`.
 * @returns {string}
 */
export function releaseNotes(changelog, version) {
    const lines = changelog.split(/\r?\n/);
    const heading = `## v${version}`;
    const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} - `));
    if (start === -1) throw new Error(`docs/changelog.md has no block for v${version}.`);
    const next = lines.findIndex((line, index) => index > start && line.startsWith("## v"));
    const body = lines.slice(start + 1, next === -1 ? lines.length : next).filter((line) => !line.startsWith("*Release"));
    const title = lines[start].slice(heading.length).replace(/^ - /, "");
    return `${[title ? `## ${title}` : heading, ...body].join("\n").trim()}\n`;
}

/**
 * The number of a beta, 1 for one without a number like `4.1.0-beta`. Null for another suffix.
 *
 * @param {string} version
 * @returns {number | null}
 */
function betaNumber(version) {
    const match = /-beta(?:\.(\d+))?$/.exec(version);
    return match ? Number(match[1] ?? 1) : null;
}

/**
 * The beta of the same release right before this one, without the leading `v`. Null for the first
 * beta and for anything that is no beta.
 *
 * @param {string} version Without the leading `v`.
 * @param {string[]} tags The tags of the repository, like `v4.1.0-beta.1`.
 * @returns {string | null}
 */
export function previousBeta(version, tags) {
    const own = betaNumber(version);
    if (own === null) return null;
    const earlier = tags
        .map((tag) => tag.replace(/^v/, ""))
        .filter((other) => releaseOf(other) === releaseOf(version) && (betaNumber(other) ?? Infinity) < own);
    earlier.sort((a, b) => (betaNumber(a) ?? 0) - (betaNumber(b) ?? 0));
    return earlier.at(-1) ?? null;
}

/**
 * The fragments with only the notes and entries the earlier fragments did not have yet. An entry
 * the release thanks someone in counts as the same entry without the thanks.
 *
 * @param {Fragment[]} fragments
 * @param {Fragment[]} earlier
 * @returns {Fragment[]}
 */
export function newSince(fragments, earlier) {
    const seen = new Set(earlier.flatMap((fragment) => [...fragment.notes, ...[...fragment.sections.values()].flat()]));
    const known = (/** @type {string} */ line) => seen.has(line) || seen.has(line.replace(THANKS, ""));
    return fragments.map((fragment) => ({
        ...fragment,
        notes: fragment.notes.filter((note) => !known(note)),
        sections: new Map(
            [...fragment.sections]
                .map(([heading, entries]) => /** @type {[string, string[]]} */ ([heading, entries.filter((entry) => !known(entry))]))
                .filter(([, entries]) => entries.length > 0),
        ),
    }));
}

/**
 * The notes of a beta: what it previews and how to try it safely, what came since the beta before
 * it, then everything since the last release, then its Docker image.
 *
 * @param {{
 *     version: string,
 *     fragments: Fragment[],
 *     since?: string | null,
 *     earlier?: Fragment[],
 *     lastRelease?: string | null,
 * }} options `since` is the beta before it, `earlier` its fragments.
 * @returns {string}
 */
export function betaNotes({ version, fragments, since = null, earlier = [], lastRelease = null }) {
    const release = releaseOf(version);
    const lines = [
        `## Beta of v${release}`,
        "",
        `> 🧪 **Beta:** A preview of v${release} to try before it is released, it may still change. Run it on a copy of your instance or back up \`/data\` first, since an older version cannot run on a database the beta migrated.`,
        "",
    ];
    if (since) {
        const added = renderSections(newSince(fragments, earlier));
        if (added.length > 0) lines.push(`## New since v${since}`, "", ...added);
    }
    lines.push(lastRelease ? `## Everything since v${lastRelease}` : `## Everything in v${release}`, "", ...renderSections(fragments));
    lines.push(...dockerSection(version, dockerTags(version)));
    return `${lines.join("\n")}\n`;
}

/**
 * The fragments a tag holds, read through git, for the notes of the beta after it.
 *
 * @param {string} tag
 * @param {(command: string, args: string[]) => string} [exec]
 * @returns {Fragment[]}
 */
export function fragmentsAt(tag, exec = run) {
    return exec("git", ["ls-tree", "--name-only", `${tag}:changelog/unreleased`])
        .split("\n")
        .filter((name) => name.endsWith(".md") && name !== "README.md")
        .map((name) => parseFragment(exec("git", ["show", `${tag}:changelog/unreleased/${name}`]), name));
}

/**
 * `pnpm changelog:notes <tag>`: prints the notes of the GitHub release of a tag, and nothing else,
 * since the release workflow publishes what it prints. Problems go to stderr.
 *
 * @param {string[]} args
 */
export function notesCommand([tag]) {
    if (!tag || !TAG.test(tag)) {
        fail(`Name the tag of a release, like v4.1.0 or v4.1.0-beta.1${tag ? `, not ${tag}` : ""}.`);
        return;
    }
    const version = tag.slice(1);
    try {
        const changelog = fs.readFileSync(CHANGELOG, "utf8");
        if (!isPreview(version)) {
            process.stdout.write(releaseNotes(changelog, version));
            return;
        }
        const fragments = readFragments();
        const problems = fragments.flatMap((fragment) => fragment.problems.map((problem) => `${fragment.name}: ${problem}`));
        if (problems.length > 0) throw new Error(`Fix the changelog fragments first:\n${problems.join("\n")}`);
        if (fragments.length === 0) throw new Error(`There are no changelog fragments to make the notes of ${tag} of.`);

        const since = previousBeta(version, run("git", ["tag", "--list", `v${releaseOf(version)}-*`]).split("\n").filter(Boolean));
        out(betaNotes({
            version,
            fragments: creditWithWarning(fragments),
            since,
            earlier: since ? fragmentsAt(`v${since}`) : [],
            lastRelease: listedVersions(changelog).find((listed) => !isPreview(listed)) ?? null,
        }).trimEnd());
    } catch (error) {
        fail(messageOf(error));
    }
}
