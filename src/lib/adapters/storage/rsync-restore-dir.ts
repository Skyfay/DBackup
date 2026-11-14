/**
 * How a write of a restore over rsync stays inside the folder of the restore.
 *
 * rsync and the `mkdir -p` before it take a path as text, and the server follows every symbolic
 * link on the way. A restore writes into folders that other users and programs write to as well,
 * so a link planted at a folder below the folder of the restore, like `d -> ../../outside`, would
 * carry the restored file out of that folder and out of the path of the connection. The script
 * built here runs on the server before the transfer. It creates the folder of the restore, then
 * walks the folders below it one by one: a missing one is created with a plain `mkdir`, and one
 * that exists has to resolve, with every link followed, to a folder inside the real folder of the
 * restore. A link that stays inside is followed, as `sftp.ts` and `local.ts` do. Links above the
 * folder are the setup of the server and are followed as before.
 *
 * rsync itself replaces a link at the name of the file, since it writes a new file and renames it
 * over the name. Options that make it write into the existing entry instead, like `--inplace`, would
 * follow such a link, so with `removeLeafLink` the script removes a link at that name first.
 */

/** What the script prints as its last line when every folder is inside the folder of the restore. */
export const RESTORE_DIR_OK = "DBACKUP_RESTORE_DIR:ok";
/** What it prints for a folder that is a link out of the folder of the restore, or no folder. */
export const RESTORE_DIR_LINK = "DBACKUP_RESTORE_DIR:link";
/** What it prints when a folder could not be created or read. */
export const RESTORE_DIR_FAILED = "DBACKUP_RESTORE_DIR:failed";

/** The additional rsync options that write into an entry already at the name of the file. */
const WRITES_IN_PLACE = /(^|\s)--(inplace|append|append-verify|write-devices)(\s|=|$)/;

/** Whether the additional options of a connection make rsync write through a link at the name of a file. */
export function writesInPlace(options: string | undefined): boolean {
    return !!options && WRITES_IN_PLACE.test(options);
}

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/** A path as a word of the script, with a leading `~/` read as the home folder like rsync reads it. */
function pathWord(remotePath: string): string {
    if (remotePath === "~") return '"$HOME"';
    if (remotePath.startsWith("~/")) return `"$HOME"/${quote(remotePath.slice(2))}`;
    if (remotePath.startsWith("~")) {
        throw new Error("Refusing to restore into the home folder of another account, name the folder by its full path.");
    }
    return quote(remotePath);
}

export interface RestoreDirRequest {
    /** The folder of the restore on the server, with the folder setting, as `remoteArgument` returns it. */
    folder: string;
    /** The folders below it down to the one the file goes into, none for a file right in the folder. */
    parts: string[];
    /** The name of the file, when a link at it has to be removed before the transfer. */
    removeLeafLink?: string;
}

/**
 * The command that checks and creates the folders of one write of a restore, see the top of this
 * file. It runs under `sh`, whatever the login shell of the account is, and always exits 0 when it
 * ran: its last line says how it ended.
 *
 * @throws Error for a part that is no plain name of a folder
 */
export function restoreDirCommand(request: RestoreDirRequest): string {
    for (const part of request.parts) {
        if (part === "" || part === "." || part === ".." || part.includes("/")) {
            throw new Error("Refusing to restore: the path below the folder of the restore is no plain path");
        }
    }
    const lines = [
        `f=${pathWord(request.folder)}`,
        `mkdir -p "$f" || { echo ${RESTORE_DIR_FAILED}; exit 0; }`,
        `root=$(cd "$f" && pwd -P) || { echo ${RESTORE_DIR_FAILED}; exit 0; }`,
        // The root of the file system holds everything, and `/` plus `/` would match nothing.
        `[ "$root" = / ] && root=`,
        `c=$f`,
        `step() {`,
        `  c=$c/$1`,
        `  if [ -e "$c" ] || [ -L "$c" ]; then`,
        `    r=$(cd "$c" 2>/dev/null && pwd -P) || { echo ${RESTORE_DIR_LINK}; exit 0; }`,
        `    case "$r/" in "$root"/*) ;; *) echo ${RESTORE_DIR_LINK}; exit 0 ;; esac`,
        `  else`,
        `    mkdir "$c" || { echo ${RESTORE_DIR_FAILED}; exit 0; }`,
        `  fi`,
        `}`,
        ...request.parts.map((part) => `step ${quote(part)}`),
        ...(request.removeLeafLink !== undefined
            ? [`if [ -L "$c"/${quote(request.removeLeafLink)} ]; then rm -f "$c"/${quote(request.removeLeafLink)} || { echo ${RESTORE_DIR_FAILED}; exit 0; }; fi`]
            : []),
        `echo ${RESTORE_DIR_OK}`,
    ];
    return `sh -c ${quote(lines.join("\n"))}`;
}

/**
 * Reads the answer of `restoreDirCommand`.
 *
 * @throws Error when a folder leads out of the folder of the restore, or when the server did not say that none does
 */
export function assertRestoreDirAnswer(output: string, remoteDir: string): void {
    const last = output.trim().split("\n").pop()?.trim();
    if (last === RESTORE_DIR_OK) return;
    if (last === RESTORE_DIR_LINK) {
        throw new Error(`Refusing to restore below ${remoteDir}: a folder on the way is a symbolic link out of the folder of the restore, or no folder.`);
    }
    throw new Error(`Refusing to restore below ${remoteDir}: its folders could not be created and checked on the server.`);
}
