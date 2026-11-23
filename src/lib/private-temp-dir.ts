import fs from "fs/promises";
import path from "path";
import { getTempDir } from "@/lib/temp-dir";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ module: "private-temp-dir" });

/**
 * Runs `fn` with a folder of its own in the temporary folder of DBackup, removed with everything in
 * it afterwards. `mkdtemp` makes the folder under a random name that nobody else can open, so no
 * link another user planted under a name that can be guessed, like a test file named after the
 * time, sends a write of DBackup into a file of theirs.
 */
export async function withPrivateTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(getTempDir(), prefix));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * Writes a new file into a folder of `withPrivateTempDir`, refusing one that is there already,
 * a link included.
 */
export async function writeNewFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, { flag: "wx", mode: 0o600 });
}

/** The mode of a file of the private temporary folder: only DBackup reads and writes it. */
export const PRIVATE_FILE_MODE = 0o600;

/**
 * Gives a file of a restore, staged in the private folder before its upload, the mode the archive
 * recorded for it. Such a file is written with the default mode by the umask (0644 mostly), not
 * with `PRIVATE_FILE_MODE`, since an upload that keeps the mode of the file, like rsync -a, carries
 * it to the destination. The 0700 of the private folder keeps it from other users meanwhile. The
 * owner may always read it, the upload reads it after this.
 */
export async function giveRecordedMode(file: string, mode: number | undefined): Promise<void> {
    if (mode === undefined || process.platform === "win32") return;
    await fs.chmod(file, (mode & 0o777) | 0o400);
}

/** A folder `privateTempDir` made, with what identifies it and whether the mount showed it private then. */
interface MadeDir {
    dir: string;
    dev: number;
    ino: number;
    shownPrivate: boolean;
}

/** The private folder of this process, by the temporary folder it lies in. */
const privateDirs = new Map<string, Promise<MadeDir>>();

/** Whether the warning about a mount that cannot show a folder as private was logged. */
let warnedMount = false;

/** Whether a folder shows as private: ours and 0700. Windows knows neither owners nor these modes, the folder lies in the profile of the user there. */
function shownPrivate(stats: { mode: number; uid: number }): boolean {
    if (process.platform === "win32") return true;
    return (stats.mode & 0o777) === 0o700 && (typeof process.getuid !== "function" || stats.uid === process.getuid());
}

/**
 * Whether a folder is still the private one of this process: a folder, not a link, ours and 0700.
 * A mount that never showed it so, like CIFS, a bind mount of Docker Desktop or NFS with
 * root_squash, keeps the folder this process made, known by its device and inode, instead of a new
 * one on every call. One that showed 0700 once and no longer does was opened by someone.
 */
async function stillPrivate(made: MadeDir): Promise<boolean> {
    const stats = await fs.lstat(made.dir).catch(() => null);
    if (!stats?.isDirectory()) return false;
    if (shownPrivate(stats)) return true;
    return !made.shownPrivate && stats.dev === made.dev && stats.ino === made.ino;
}

/**
 * A folder of this process in the temporary folder of DBackup that nobody else opens (0700), for
 * files that outlive one function, like a copy of the database that waits for its download or a
 * decrypted configuration backup that waits for its restore. The caller removes its files, the
 * folder stays for the next ones. One that a cleaner of the temporary folder removed, or that is no
 * longer private, is made again under a new name.
 */
export async function privateTempDir(): Promise<string> {
    const parent = getTempDir();
    const known = privateDirs.get(parent);
    if (known) {
        const made = await known.catch(() => null);
        if (made && (await stillPrivate(made))) return made.dir;
    }
    const making = fs.mkdtemp(path.join(parent, "dbackup-private-")).then(async (dir): Promise<MadeDir> => {
        // `mkdtemp` makes it 0700 already, this holds under any umask too.
        await fs.chmod(dir, 0o700);
        const stats = await fs.lstat(dir);
        const shown = shownPrivate(stats);
        if (!shown && !warnedMount) {
            warnedMount = true;
            log.warn("The temporary folder lies on a mount that cannot show a folder as private (0700 and owned by DBackup), so other users of the mount may read the files DBackup keeps there", {
                folder: parent,
                mode: (stats.mode & 0o777).toString(8),
            });
        }
        return { dir, dev: stats.dev, ino: stats.ino, shownPrivate: shown };
    });
    privateDirs.set(parent, making);
    return (await making).dir;
}

/** A path for a new file in `privateTempDir`, which the caller creates with `PRIVATE_FILE_MODE`. */
export async function privateTempPath(fileName: string): Promise<string> {
    return path.join(await privateTempDir(), path.basename(fileName));
}

/**
 * Makes a file of the private folder 0600 that another program created, like the copy SQLite writes
 * for `VACUUM INTO` or a download of an adapter, which take the default mode. A file that is not
 * there is left to the read that follows, which says so in its own words.
 */
export async function restrictFile(file: string): Promise<void> {
    if (process.platform === "win32") return;
    await fs.chmod(file, PRIVATE_FILE_MODE).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
    });
}
