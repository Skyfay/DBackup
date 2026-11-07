import fs from "fs/promises";
import path from "path";
import { getTempDir } from "@/lib/temp-dir";

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

/** The private folder of this process, by the temporary folder it lies in. */
const privateDirs = new Map<string, Promise<string>>();

/** Whether a folder is still the private one of this process: a folder, not a link, ours and 0700. */
async function stillPrivate(dir: string): Promise<boolean> {
    const stats = await fs.lstat(dir).catch(() => null);
    if (!stats?.isDirectory()) return false;
    // Windows knows neither owners nor these modes, the folder lies in the profile of the user there.
    if (process.platform === "win32") return true;
    return (stats.mode & 0o777) === 0o700 && (typeof process.getuid !== "function" || stats.uid === process.getuid());
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
        const dir = await known.catch(() => null);
        if (dir && (await stillPrivate(dir))) return dir;
    }
    const made = fs.mkdtemp(path.join(parent, "dbackup-private-")).then(async (dir) => {
        // `mkdtemp` makes it 0700 already, this holds under any umask too.
        await fs.chmod(dir, 0o700);
        return dir;
    });
    privateDirs.set(parent, made);
    return made;
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
