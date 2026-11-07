import fs from "fs/promises";
import path from "path";

/**
 * Where a path on the server DBackup runs on really leads, resolved the way the kernel resolves it.
 * The Local Filesystem adapter keeps its writes inside its folder with it, and the check of DBackup's
 * own data (`adapters/own-data.ts`) finds a link into one of its folders with it, so both read a link
 * the same way.
 */

/** How many links a path may pass through before it counts as a loop, like the limit of the kernel. */
export const MAX_LINKS = 40;

/** What a walk throws on a path through more links than `MAX_LINKS`, a loop most of the time. */
export class TooManyLinksError extends Error {
    constructor(target: string) {
        super(`Too many symbolic links in ${target}`);
        this.name = "TooManyLinksError";
    }
}

/**
 * The parts of a path as the kernel of this platform reads them. Windows separates them by `\` and
 * `/`, every other platform by `/` alone, where `a\b` is one name. Splitting such a name at its `\`
 * would walk another path than the kernel follows, like a link named `out\x` that points out of the
 * folder taken for a folder `out` with a file `x` inside.
 */
export function pathParts(value: string, platform: NodeJS.Platform = process.platform): string[] {
    return value.split(platform === "win32" ? /[\\/]+/ : /\/+/);
}

/** Whether `target` is `base` or lies below it. Both are absolute and resolved. */
export function inside(target: string, base: string): boolean {
    return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

/**
 * A path with every link resolved as far as it exists, and the parts that do not exist yet appended
 * as they are. A link whose target does not exist yet still leads where it points, since a write
 * through it creates that target, so it is followed to its target instead of counting as its own name.
 *
 * @throws TooManyLinksError for a path through more than `MAX_LINKS` links.
 */
export async function realExisting(target: string): Promise<string> {
    try {
        return await fs.realpath(target);
    } catch {
        // Something on the way does not exist yet, so walk it part by part like the kernel does. The
        // path is walked as it was written: `path.resolve` would drop a `link/..` as text and climb
        // from where the link sits, while the kernel climbs from where the link leads.
        const absolute = path.isAbsolute(target) ? target : `${process.cwd()}${path.sep}${target}`;
        const root = path.parse(absolute).root;
        return walkParts(root, absolute.slice(root.length), { links: 0, target });
    }
}

/**
 * Follows `rest` from the real folder `from` one part at a time, the way the kernel resolves a path:
 * a link is read and its target walked from the folder the link really sits in, and a `..` goes up
 * from where the walk really is, never from the text of a path. So a link through another link, a
 * `..` after a link, or a link to something that does not exist yet all end where a write would land.
 *
 * @param seen The links followed so far and the path the walk started from, for the error of a loop.
 * @throws TooManyLinksError for a walk through more than `MAX_LINKS` links.
 */
export async function walkParts(from: string, rest: string, seen: { links: number; target: string }): Promise<string> {
    let current = from;
    for (const part of pathParts(rest)) {
        if (part === "" || part === ".") continue;
        if (part === "..") {
            current = path.dirname(current);
            continue;
        }
        const next = path.join(current, part);
        const entry = await fs.lstat(next).catch(() => null);
        if (!entry?.isSymbolicLink()) {
            current = next;
            continue;
        }
        if (++seen.links > MAX_LINKS) throw new TooManyLinksError(seen.target);
        const pointsTo = await fs.readlink(next);
        current = path.isAbsolute(pointsTo)
            ? await walkParts(path.parse(pointsTo).root, pointsTo.slice(path.parse(pointsTo).root.length), seen)
            : await walkParts(current, pointsTo, seen);
    }
    return current;
}
