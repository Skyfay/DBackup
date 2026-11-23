/**
 * The private temporary folder holds the copies with a secret in them, like a copy of the database
 * or a decrypted configuration backup. Only DBackup opens the folder (0700) and its files (0600).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

let root = "";
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => root }));

const { privateTempDir, privateTempPath, restrictFile, PRIVATE_FILE_MODE } = await import("@/lib/private-temp-dir");

const posix = process.platform !== "win32";

beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "private-temp-test-"));
});

afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

describe("the private temporary folder", () => {
    it.runIf(posix)("is a folder of its own in the temporary folder that only DBackup opens", async () => {
        const dir = await privateTempDir();

        expect(path.dirname(dir)).toBe(root);
        expect(path.basename(dir)).toMatch(/^dbackup-private-/);
        expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
        expect(await privateTempDir()).toBe(dir);
    });

    it("keeps a file name inside the folder", async () => {
        const dir = await privateTempDir();

        expect(await privateTempPath("../../etc/copy.db")).toBe(path.join(dir, "copy.db"));
    });

    it("is made again under a new name once a cleaner removed it", async () => {
        const first = await privateTempDir();
        await fs.rm(first, { recursive: true });

        const second = await privateTempDir();

        expect(second).not.toBe(first);
        expect((await fs.stat(second)).isDirectory()).toBe(true);
    });

    it.runIf(posix)("is made again when someone opened it to others", async () => {
        const first = await privateTempDir();
        await fs.chmod(first, 0o777);

        const second = await privateTempDir();

        expect(second).not.toBe(first);
        expect((await fs.stat(second)).mode & 0o777).toBe(0o700);
    });

    it.runIf(posix)("makes a file another program wrote readable by DBackup alone", async () => {
        const file = await privateTempPath("vacuum-into.db");
        await fs.writeFile(file, "SQLite format 3", { mode: 0o644 });

        await restrictFile(file);

        expect((await fs.stat(file)).mode & 0o777).toBe(PRIVATE_FILE_MODE);
    });
});
