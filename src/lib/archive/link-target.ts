/**
 * Which symbolic links of a backup a restore lays again. A link points wherever its target says,
 * so one with an absolute target, or a relative one that climbs out of the folder the restore
 * writes into, also through a folder that is itself a link, would lead a later write, a read of a directory source or a run of DBackup that
 * follows it to any file of the server, like the database of DBackup. Such a link is skipped and
 * named in the log of the restore, never written as a plain file, since a file with the target as
 * its content would claim to be something it never was. A download as `.tar.gz` keeps every link
 * as it is, the archive is extracted elsewhere.
 */

import { leavesFolder } from "./remote-paths";

/** Why a link is skipped, for the log of the restore. */
export const LINK_LEAVES_TARGET = "its target is absolute or leads out of the folder the restore writes into, so it was skipped";

/** Whether a target is absolute on any system: `/x`, `\\server\x` or `C:\x`. */
function isAbsoluteTarget(target: string): boolean {
    return target.startsWith("/") || target.startsWith("\\") || /^[a-zA-Z]:/.test(target);
}

/**
 * Whether the link at `linkPath`, relative to the folder the restore writes into, points outside
 * of that folder or nowhere a restore should point: absolute, empty, climbing above the folder,
 * climbing back after a folder (`up/../x`), or running through a link of the same backup.
 *
 * The target is read as text, while the system that follows it reads each part on disk. A `..`
 * after a folder climbs from wherever that folder leads, so `up/../secret` leaves the restore once
 * `up` is a link that leads elsewhere. Only the `..` parts at the start climb from a real folder,
 * the one the link lies in, which `throughLinkOf` keeps free of links. For the same reason a
 * target whose folders pass through a link of the backup is refused, `isLinkFolder` tells them,
 * like `throughLinkOf` of the same lines does for an entry.
 *
 * A part of dots and spaces alone other than `.`, like `...`, `.. ` or `%2e%2e`, climbs on a system
 * that drops trailing dots and spaces or reads `%` escapes, so it is refused wherever it stands, by
 * the rule `leavesFolder` applies to every other path of a restore.
 *
 * @param isLinkFolder Whether a path below the folder the restore writes into has a link of the same backup and source as one of its folders.
 */
export function linkLeavesTarget(linkPath: string, target: string, isLinkFolder: (resolvedPath: string) => boolean): boolean {
    if (target.trim() === "" || isAbsoluteTarget(target)) return true;
    const parts = linkPath.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
    // The folder the link lies in, from where its target is read.
    const at = parts.slice(0, -1);
    let afterFolder = false;
    for (const part of target.replace(/\\/g, "/").split("/")) {
        if (part === "" || part === ".") continue;
        if (leavesFolder(part)) return true;
        if (part === "..") {
            if (afterFolder || at.length === 0) return true;
            at.pop();
            continue;
        }
        afterFolder = true;
        at.push(part);
    }
    return isLinkFolder(at.join("/"));
}

/** Why an entry below a link of the same backup is skipped, for the log of the restore. */
export const ENTRY_THROUGH_LINK = "its path runs through a symbolic link of the same backup, which a real folder never holds, so it was skipped";

/** The folders of a path, without empty and `.` parts, compared without case. */
function pathParts(entryPath: string): string[] {
    return entryPath.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".").map((part) => part.toLowerCase());
}

/**
 * A test whether an entry of a restore lies below a symbolic link of the same backup. A walk of a
 * real folder never descends into a link, so a backup that holds `x/y` as a link and `x/y/z` as a
 * file or link was made up. Laid one after the other, `x/y -> ..` moves where `x/y/z` lands and
 * where its target points, and a destination that joins paths as text, like SFTP, then writes or
 * links out of the folder of the restore, which `linkLeavesTarget` checks for each link alone.
 * Built from every line of the index, not only the picked ones, so a chain split over two
 * restores of the same backup is refused too. Paths compare without case, since a destination
 * on Windows or macOS treats `X/y` and `x/y` as one folder.
 */
export function throughLinkOf(lines: readonly { src: string; p: string; lnk?: string }[]): (src: string, entryPath: string) => boolean {
    const links = new Set<string>();
    for (const line of lines) {
        if (line.lnk !== undefined) links.add(`${line.src}\0${pathParts(line.p).join("/")}`);
    }
    return (src, entryPath) => {
        if (links.size === 0) return false;
        const parts = pathParts(entryPath);
        for (let depth = 1; depth < parts.length; depth++) {
            if (links.has(`${src}\0${parts.slice(0, depth).join("/")}`)) return true;
        }
        return false;
    };
}
