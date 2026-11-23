// @ts-check
/**
 * The version of DBackup. It lives in the root package.json and is copied to the docs and to the
 * OpenAPI files.
 *
 *   pnpm version:sync                       copies the current version everywhere
 *   pnpm version:bump                       asks for the next version
 *   pnpm version:bump patch|minor|major     bumps without asking
 *   pnpm version:bump beta [major]          the next beta, of the next minor or major release
 *   pnpm version:bump release               the release a beta previews
 *   pnpm version:bump 4.1.0-beta.1          sets that version
 *
 * A bump checks the changelog fragments and the CodeQL alerts on dev first, and asks whether to go
 * on while an alert is open. Then it writes the version block of docs/changelog.md from the
 * fragments (see changelog.mjs) and the version itself. `--ignore-codeql` skips the
 * CodeQL check.
 *
 * A beta, any version with a suffix, sets the version alone. Its fragments stay for the release it
 * previews, which writes the one block of the changelog, and the release workflow makes the notes
 * of the beta from them (see release-notes.mjs).
 */

import fs from "node:fs";
import path from "node:path";
import { CHANGELOG, checkCommand as checkFragments, listedVersions, readFragments, releaseCommand } from "./changelog.mjs";
import { ROOT, ask, fail, out } from "./cli.mjs";
import { confirmCleanDev } from "./codeql.mjs";

const PACKAGE = path.join(ROOT, "package.json");

/** The package.json files that carry the version as well. */
const PACKAGES = [path.join(ROOT, "docs", "package.json")];

/** The OpenAPI descriptions, whose `info.version` shows the version of the API. */
const OPENAPI = [path.join(ROOT, "public", "openapi.yaml"), path.join(ROOT, "api-docs", "openapi.yaml")];

/** A version as the release takes it, with an optional suffix like `-beta`. */
export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The next version, counted the way npm counts it: a version with a suffix like `-beta` becomes
 * the release it is a preview of, where the bump allows that.
 *
 * @param {string} current
 * @param {"patch" | "minor" | "major"} type
 * @returns {string}
 */
export function nextVersion(current, type) {
    const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(current);
    if (!match) throw new Error(`Not a version: ${current}`);
    const [major, minor, patch] = match.slice(1, 4).map(Number);
    const preview = match[4] !== undefined;
    if (type === "major") return preview && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`;
    if (type === "minor") return preview && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`;
    return preview ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
}

/**
 * Whether a version previews a release, like `4.1.0-beta.1`. Every suffix counts, so nothing with
 * one is ever published as a release.
 *
 * @param {string} version
 * @returns {boolean}
 */
export function isPreview(version) {
    return version.includes("-");
}

/**
 * The release a version previews, the version itself for a release: `4.1.0` for `4.1.0-beta.2`.
 *
 * @param {string} version
 * @returns {string}
 */
export function releaseOf(version) {
    return version.split("-")[0];
}

/**
 * The next beta: the one after a beta of the same release, like `4.1.0-beta.2` after
 * `4.1.0-beta.1`, or the first beta of the next release after a release. A beta without a number
 * counts as the first, another suffix like `-dev` starts the betas of its release.
 *
 * @param {string} current
 * @param {"patch" | "minor" | "major"} [type] The next release after a release.
 * @returns {string}
 */
export function nextBeta(current, type = "minor") {
    const match = /^(\d+\.\d+\.\d+)(?:-(.+))?$/.exec(current);
    if (!match) throw new Error(`Not a version: ${current}`);
    const [, release, suffix] = match;
    if (suffix === undefined) return `${nextVersion(current, type)}-beta.1`;
    const beta = /^beta(?:\.(\d+))?$/.exec(suffix);
    if (!beta) return `${release}-beta.1`;
    return `${release}-beta.${Number(beta[1] ?? 1) + 1}`;
}

/**
 * Why a beta cannot be set, null when it can: its release is out already, which every instance
 * would count as newer, or there are no fragments to make its notes of.
 *
 * @param {string} version
 * @param {string} changelog The text of docs/changelog.md.
 * @param {number} fragments How many fragments wait.
 * @returns {string | null}
 */
export function previewRefusal(version, changelog, fragments) {
    const release = releaseOf(version);
    if (listedVersions(changelog).includes(release)) return `v${release} is released already, so v${version} would count as older than it.`;
    if (fragments === 0) return "There are no changelog fragments, so the beta would have no notes.";
    return null;
}

/**
 * The Docker tags the image of a version gets besides its own, as the changelog lists them.
 *
 * @param {string} version
 * @returns {string}
 */
export function dockerTags(version) {
    if (version.includes("-dev")) return "`dev`";
    if (isPreview(version)) return "`beta`";
    return `\`latest\`, \`v${version.split(".")[0]}\``;
}

/**
 * A package.json with another version, changed in place so its formatting stays as it is.
 *
 * @param {string} json
 * @param {string} version
 * @returns {string}
 */
export function withVersion(json, version) {
    const changed = json.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
    if (JSON.parse(changed).version !== version) throw new Error("package.json has no top-level version");
    return changed;
}

/**
 * An OpenAPI description with another version. Its `info.version` is the only key indented by two
 * spaces that is called `version`.
 *
 * @param {string} yaml
 * @param {string} version
 * @returns {string}
 */
export function withOpenapiVersion(yaml, version) {
    return yaml.replace(/^ {2}version: .*$/gm, `  version: ${version}`);
}

function readVersion() {
    return JSON.parse(fs.readFileSync(PACKAGE, "utf8")).version;
}

/**
 * Copies a version to every place that shows it.
 *
 * @param {string} version
 */
function sync(version) {
    out(`Syncing version ${version} ...`);
    for (const file of PACKAGES) {
        const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
        pkg.version = version;
        fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
        out(`  ✓ ${path.relative(ROOT, file)}`);
    }
    for (const file of OPENAPI) {
        fs.writeFileSync(file, withOpenapiVersion(fs.readFileSync(file, "utf8"), version));
        out(`  ✓ ${path.relative(ROOT, file)}`);
    }
}

/**
 * The version to bump to: from the argument, or picked on the terminal. Null when nothing was
 * picked.
 *
 * @param {string} current
 * @param {string | undefined} given
 * @param {string | undefined} type `major` for a beta of the next major release.
 * @returns {Promise<string | null>}
 */
async function pickVersion(current, given, type) {
    if (given === "patch" || given === "minor" || given === "major") return nextVersion(current, given);
    if (given === "beta") return nextBeta(current, type === "major" ? "major" : "minor");
    if (given === "release") {
        if (!isPreview(current)) throw new Error(`v${current} is a release already, pick patch, minor or major.`);
        return releaseOf(current);
    }
    if (given !== undefined) {
        if (!VERSION.test(given)) throw new Error(`Not a version: ${given}`);
        return given;
    }

    // From a beta the next step is another beta or its release, from a release any of the others.
    /** @type {[string, string][]} */
    const choices = isPreview(current)
        ? [["Next beta", nextBeta(current)], ["Release", releaseOf(current)]]
        : [
            ["Patch", nextVersion(current, "patch")],
            ["Minor", nextVersion(current, "minor")],
            ["Major", nextVersion(current, "major")],
            ["Beta of the minor", nextBeta(current, "minor")],
            ["Beta of the major", nextBeta(current, "major")],
        ];
    const width = Math.max(...choices.map(([label]) => label.length));
    out("");
    out(`  Current version: v${current}`);
    out("");
    choices.forEach(([label, version], index) => out(`  ${index + 1}) ${label.padEnd(width)}  → v${version}`));
    out(`  ${choices.length + 1}) Custom`);
    out("");
    const choice = await ask(`  Select [1-${choices.length + 1}]: `);
    const picked = /^\d+$/.test(choice) ? choices[Number(choice) - 1] : undefined;
    if (picked) return picked[1];
    if (choice !== String(choices.length + 1)) return null;
    const custom = await ask("  Enter version (e.g. 4.1.0-beta.1): ");
    if (!VERSION.test(custom)) throw new Error(`Not a version: ${custom || "(empty)"}`);
    return custom;
}

/** `pnpm version:sync`: copies the current version everywhere. */
export function syncCommand() {
    const version = readVersion();
    sync(version);
    out(`Done, all files at v${version}.`);
}

/**
 * `pnpm version:bump [patch|minor|major|beta [major]|release|<version>] [--ignore-codeql]`.
 *
 * @param {string[]} args
 */
export async function bumpCommand(args) {
    const ignoreCodeql = args.includes("--ignore-codeql");
    const [given, type] = args.filter((arg) => !arg.startsWith("--"));
    if (!checkFragments()) {
        fail("Fix the changelog fragments first, nothing changed.");
        return;
    }
    if (!ignoreCodeql && !(await confirmCleanDev())) {
        fail("Stopped, nothing changed.");
        return;
    }

    const current = readVersion();
    const version = await pickVersion(current, given, type);
    if (!version) {
        fail("Stopped, nothing changed.");
        return;
    }

    if (isPreview(version)) {
        const refused = previewRefusal(version, fs.readFileSync(CHANGELOG, "utf8"), readFragments().length);
        if (refused) {
            fail(`${refused} Nothing changed.`);
            return;
        }
        fs.writeFileSync(PACKAGE, withVersion(fs.readFileSync(PACKAGE, "utf8"), version));
        out(`package.json: ${current} → ${version}`);
        sync(version);
        out(`Done, all files at v${version}. The changelog fragments stay for v${releaseOf(version)}.`);
        out("Commit, push dev, then tag the beta with pnpm release:tag dev.");
        return;
    }

    // The changelog first, since it refuses a version it lists already, before anything else changed.
    if (!releaseCommand(version, dockerTags(version))) {
        fail("The changelog refused the version, nothing else changed.");
        return;
    }
    fs.writeFileSync(PACKAGE, withVersion(fs.readFileSync(PACKAGE, "utf8"), version));
    out(`package.json: ${current} → ${version}`);
    sync(version);
    out(`Done, all files at v${version}.`);
}
