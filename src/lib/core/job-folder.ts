/**
 * A job writes its backups into the folder its name gives on every destination, `<name>/<file>`.
 * A name with a `.` or `..` folder, or one that is nothing but slashes, would write beside that
 * folder or into the root of the destination, among the backups of other jobs, the configuration
 * backup or the folders of the customers of a shared destination. A semicolon, a double quote or a
 * control character in it would break the command of an SMB destination apart, and a folder that
 * starts with `-` reads as an option of a command on the server of a destination, like the `find` or
 * `rm` of Rsync. A plain module, the form of a job checks names with it too.
 */

/** What someone reads who names a job like that. */
export const JOB_FOLDER_NAME = "A job name cannot hold a . or .. folder or a folder that starts with a hyphen, a semicolon, a double quote or a control character, or consist of slashes alone, since a job writes into the folder its name gives.";

/** A part of a path made of dots and spaces alone, which Windows reads as `.` or `..`. */
const DOTS = /^[. ]+$/;

/**
 * A character a storage reads as part of a command rather than of a folder: smbclient takes its
 * commands as one line split at every semicolon, with each path in double quotes it never escapes,
 * see `smbCommandRefusal` in `adapters/smb-address.ts`. A control character ends a line anywhere.
 */
const COMMAND_CHARACTERS = /[;"\x00-\x1f\x7f]/;

/** A part that a command reads as an option, also after the spaces a storage may drop. */
const OPTION = /^\s*-/;

/** A part as a storage like WebDAV reads it, encoded or not. */
function decoded(part: string): string {
    try {
        return decodeURIComponent(part);
    } catch {
        return part;
    }
}

/** Whether a job of this name would write outside the folder of its own name, see the module. */
export function isUnsafeJobFolderName(name: string): boolean {
    if (COMMAND_CHARACTERS.test(name)) return true;
    const parts = name.replace(/\\/g, "/").split("/").filter((part) => part !== "");
    if (parts.length === 0) return true;
    return parts.some((part) => DOTS.test(part) || DOTS.test(decoded(part)) || OPTION.test(part) || OPTION.test(decoded(part)));
}

/**
 * The folders of a name as a path resolves them, with either slash, without empty parts and `.`,
 * and with a `..` taking the folder before it away. `x/../config-backups` is `config-backups`.
 */
export function normalizedFolderParts(name: string): string[] {
    const parts: string[] = [];
    for (const raw of name.trim().replace(/\\/g, "/").split("/")) {
        const part = raw.trim();
        if (part === "" || part === ".") continue;
        if (part === "..") {
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    return parts;
}

/** The first folder of a name, as written and as a path resolves it, without empty parts and `.`. */
export function firstFolders(name: string): string[] {
    const written = name.trim().replace(/\\/g, "/").split("/").find((part) => part !== "" && part !== ".");
    const resolved = normalizedFolderParts(name)[0];
    return [written?.trim(), resolved].filter((part): part is string => part !== undefined && part !== "");
}
