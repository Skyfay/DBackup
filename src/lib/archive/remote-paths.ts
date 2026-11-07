import path from "path";
import { stripTrailingSlashes } from "@/lib/paths";
import { cleanPath } from "@/lib/tenant/storage-view";
import { ValidationError } from "@/lib/logging/errors";

/**
 * A part of a path that some storage reads as `..`: dots and spaces alone, also once its `%` escapes
 * are read. A plain `.` and `..` are left to the caller, which knows what they do there. The link
 * targets of a restore follow the same rule, see `link-target.ts`.
 */
export function leavesFolder(part: string): boolean {
    if (/^[. ]+$/.test(part) && part !== "." && part !== "..") return true;
    try {
        const decoded = decodeURIComponent(part);
        return decoded !== part && /^[. ]+$/.test(decoded);
    } catch {
        return false;
    }
}

/** A path with its `%` escapes read, the path itself when they do not read. */
function decodedPath(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * Refuses a folder a restore writes into that leaves the folder of its connection, by a `..` or a
 * part that a storage reads as one, see `cleanPath`, also once the `%` escapes of the whole folder
 * are read, since `%2e%2e%2f` is no part of its own before that and a storage that decodes the
 * path reads it as `../`. The folder comes from the request, unlike the paths of the archive, so
 * not even a `..` that comes back in again is taken. The folder itself is kept as it was written,
 * with or without its leading slash, since some storages read that.
 *
 * @throws ValidationError naming the folder.
 */
export function assertRestoreFolder(basePath: string): void {
    cleanPath(basePath);
    cleanPath(decodedPath(basePath));
}

/**
 * Refuses the folder of a directory source that leaves the folder of its connection. SFTP, FTP and
 * SMB join it onto the folder the connection is set to, so `../other` would read beside it. `/` and
 * an empty folder are the whole connection. The rule of `assertRestoreFolder`, also once the `%`
 * escapes of the whole folder are read, since `%2e%2e%2f` is no part of its own before that.
 *
 * @throws ValidationError naming the folder.
 */
export function assertSourceFolder(folder: unknown): asserts folder is string {
    if (typeof folder !== "string") throw new ValidationError("Pick a folder for every directory source.", { field: "sources" });
    try {
        assertRestoreFolder(folder);
    } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        throw new ValidationError(`The folder ${folder} leaves the folder of its connection. Pick a folder inside it.`, { field: "sources" });
    }
}

/**
 * Builds the remote path a restored file is written to, refusing anything that escapes
 * the chosen target directory.
 *
 * The relative path comes out of the archive index, which is attacker-controlled in the
 * threat model that matters: on an unencrypted backup the `.index` sidecar sits next to
 * the archive and can be edited by anyone with write access to the destination, and the
 * paths inside it originally came from a source server. A `../` segment would otherwise
 * let a restore write anywhere the destination credentials reach - a job's own backup
 * folder, another job's, or an SFTP account's `.ssh/authorized_keys`.
 *
 * The local extraction path has had this guard from the start (`safeJoin` in extract.ts);
 * this is the same rule for destinations addressed by POSIX-style remote paths.
 */
export function safeRemoteJoin(basePath: string, relativePath: string): string {
    // Trailing slashes are stripped by a loop, not by `/\/+$/`. That regex is quadratic on a
    // run of slashes, and this base path comes from a restore target someone chose.
    const base = stripTrailingSlashes(basePath.replace(/\\/g, "/"));
    const relative = relativePath.replace(/\\/g, "/");

    if (relative.startsWith("/")) {
        throw new Error(`Refusing to restore an absolute path: ${relativePath}`);
    }
    // The folder of the request may not leave the connection either, whoever checked it before.
    assertRestoreFolder(basePath);
    // A part like `%2e%2e` or `.. ` is `..` to a storage that decodes URLs or drops dots and spaces.
    if (relative.split("/").some(leavesFolder)) {
        throw new Error(`Refusing to restore outside the target directory: ${relativePath}`);
    }

    // Only the relative part is normalised, against a sentinel root: at a real root
    // `path.posix.normalize` silently collapses a leading "/.." to "/", which would hide
    // exactly the escape being looked for. The sentinel gives the ".." something to
    // consume, so an escape stays visible. The target itself is then appended verbatim,
    // preserving whether it was absolute.
    const SENTINEL = "/__target__";
    const probe = path.posix.normalize(`${SENTINEL}/${relative}`);

    if (probe !== SENTINEL && !probe.startsWith(`${SENTINEL}/`)) {
        throw new Error(`Refusing to restore outside the target directory: ${relativePath}`);
    }

    const safeRelative = probe.slice(SENTINEL.length + 1);
    return base === "" ? safeRelative : `${base}/${safeRelative}`;
}
