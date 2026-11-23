import path from "path";
import { inside, pathParts } from "@/lib/server/real-path";

/**
 * The names of a directory source, as the server of the source lists them.
 *
 * Every name of a collection comes from that server, and a customer may own the server: an rsync
 * or SFTP host, an S3 bucket, a WebDAV share. Such a server can answer anything, like `../../x`,
 * `/etc/passwd` or a name with a NUL in it, and the collection joins each name onto the folder of
 * the run, hashes the file there and packs it into the archive the customer downloads. A name that
 * leaves that folder would pack a file of the server DBackup runs on, so every adapter and the runner
 * check each name here before a file is written, read or packed under it.
 *
 * The parts of a name are split the way the kernel of this platform splits them (`pathParts`), so
 * on Linux `..\x` is one plain name inside the folder, like it is on disk.
 */

/** Names longer than this are cut in the log of a run, which a server could flood otherwise. */
const SHOWN_NAME_LIMIT = 300;

/** Why a listed name cannot be a file inside the collection folder, or null when it can. */
export function collectedPathProblem(relativePath: unknown, platform: NodeJS.Platform = process.platform): string | null {
    if (typeof relativePath !== "string" || relativePath === "") return "the name is empty";
    if (relativePath.includes("\0")) return "the name holds a NUL character";
    const absolute = platform === "win32"
        ? path.win32.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)
        : relativePath.startsWith("/");
    if (absolute) return "the name is an absolute path";
    const parts = pathParts(relativePath, platform);
    for (const [index, part] of parts.entries()) {
        // A trailing separator names a folder, never a file.
        if (part === "" && index === parts.length - 1) return "the name ends in a separator";
        if (part === "." || part === "..") return `the name has a '${part}' part`;
    }
    // A restore reads `\` as a separator too (`entryPathProblem` in `index-file.ts`), so a name it
    // would refuse is left out here already, rather than packed into a backup that never restores.
    if (relativePath.startsWith("\\")) return "the name starts with a backslash";
    if (/[\\/]{2}/.test(relativePath)) return "the name has an empty part";
    const restoredPart = relativePath.split(/[\\/]/).find((part) => part === "." || part === "..");
    if (restoredPart) return `the name has a '${restoredPart}' part between backslashes`;
    return null;
}

/** A refused name of a collection, with the reason the run log names. */
export class CollectedPathError extends Error {
    constructor(readonly relativePath: string, readonly reason: string) {
        super(reason);
        this.name = "CollectedPathError";
    }
}

/**
 * The local path of a listed file below `root`, refusing a name `collectedPathProblem` refuses and
 * anything that still resolves outside `root` or to `root` itself.
 *
 * @throws CollectedPathError naming the reason.
 */
export function resolveCollectedPath(root: string, relativePath: string): string {
    const problem = collectedPathProblem(relativePath);
    if (problem) throw new CollectedPathError(String(relativePath), problem);
    const base = path.resolve(root);
    const resolved = path.resolve(base, relativePath);
    if (resolved === base || !inside(resolved, base)) {
        throw new CollectedPathError(relativePath, "the name leads out of the collection folder");
    }
    return resolved;
}

/**
 * A listed name as the run log shows it: control characters escaped, so a name cannot forge a
 * line of its own, and cut after `SHOWN_NAME_LIMIT` characters.
 */
export function shownCollectedPath(relativePath: unknown): string {
    const text = typeof relativePath === "string" ? relativePath : String(relativePath);
    const escaped = /[\x00-\x1f\x7f]/.test(text) ? JSON.stringify(text).slice(1, -1) : text;
    return escaped.length > SHOWN_NAME_LIMIT ? `${escaped.slice(0, SHOWN_NAME_LIMIT)}...` : escaped;
}
