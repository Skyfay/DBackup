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
