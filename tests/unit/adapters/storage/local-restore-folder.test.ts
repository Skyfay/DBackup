// @vitest-environment node
/**
 * A restore into a Local Filesystem connection stays inside the folder it restores into, not only
 * inside the connection. Links laid by separate restores used to chain: one backup laid `d/p -> ..`,
 * a second one `d/p/x -> ..`, which through the first landed as `x -> ..` beside the restore folder's
 * contents and pointed at the connection, and a third wrote `x/jobs/victim.txt` into the files of
 * another job. Each step stayed inside the connection, so the check of the connection let it through.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileSystemAdapter } from "@/lib/adapters/storage/local";
import { linkLeavesTarget } from "@/lib/archive/link-target";
import { restoreDestination } from "@/lib/archive/remote-paths";

let root: string;
let conn: string;
const config = () => ({ basePath: conn });

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "local-restore-folder-")));
    conn = path.join(root, "conn");
    fs.mkdirSync(path.join(conn, "apps"), { recursive: true });
    fs.mkdirSync(path.join(conn, "jobs"), { recursive: true });
    fs.writeFileSync(path.join(conn, "jobs", "victim.txt"), "ORIGINAL");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Lays a link as a restore into `apps` does, after the same check of its target. */
async function restoreLink(linkPath: string, target: string): Promise<void> {
    if (linkLeavesTarget(linkPath, target, () => false)) throw new Error("refused by linkLeavesTarget");
    const { remotePath, restoreRelativePath } = restoreDestination("apps", linkPath);
    await LocalFileSystemAdapter.createSymlink!(config(), remotePath, target, { restoreRelativePath });
}

/** Writes a file as a restore into `apps` does. */
async function restoreFile(filePath: string): Promise<boolean> {
    const stage = path.join(root, "stage");
    fs.writeFileSync(stage, "WRITTEN-BY-RESTORE");
    const { remotePath, restoreRelativePath } = restoreDestination("apps", filePath);
    return LocalFileSystemAdapter.upload(config(), stage, remotePath, undefined, undefined, { restoreRelativePath }).catch(() => false);
}

describe("three restores into one folder that chain their links", () => {
    it("lays the first link, refuses the second and keeps the file of the third inside the folder", async () => {
        // Backup A: a link that stays in the folder of the restore.
        await restoreLink("d/p", "..");
        expect(fs.readlinkSync(path.join(conn, "apps", "d", "p"))).toBe("..");

        // Backup B: through the link of A this lands as `apps/x -> ..`, which leads to the connection.
        await expect(restoreLink("d/p/x", "..")).rejects.toThrow(/Access denied/);
        expect(fs.existsSync(path.join(conn, "apps", "x"))).toBe(false);

        // Backup C: without the link its file lands in a real folder of the restore.
        await restoreFile("x/jobs/victim.txt");
        expect(fs.readFileSync(path.join(conn, "jobs", "victim.txt"), "utf-8")).toBe("ORIGINAL");
        expect(fs.lstatSync(path.join(conn, "apps", "x")).isDirectory()).toBe(true);
    });

    it("refuses the write of the third restore also where the link of the second is already there", async () => {
        // Laid by anything at all, the write below it leaves the folder of the restore.
        fs.symlinkSync("..", path.join(conn, "apps", "x"));

        expect(await restoreFile("x/jobs/victim.txt")).toBe(false);
        expect(fs.readFileSync(path.join(conn, "jobs", "victim.txt"), "utf-8")).toBe("ORIGINAL");
    });

    it("keeps writing through a link that stays inside the folder of the restore", async () => {
        fs.mkdirSync(path.join(conn, "apps", "releases", "v2"), { recursive: true });
        fs.symlinkSync("releases/v2", path.join(conn, "apps", "current"));

        expect(await restoreFile("current/app.ini")).toBe(true);
        expect(fs.readFileSync(path.join(conn, "apps", "releases", "v2", "app.ini"), "utf-8")).toBe("WRITTEN-BY-RESTORE");
    });

    it("leaves a write of no restore to the check of the connection, as before", async () => {
        fs.symlinkSync("..", path.join(conn, "apps", "x"));
        const stage = path.join(root, "stage");
        fs.writeFileSync(stage, "BACKUP");

        expect(await LocalFileSystemAdapter.upload(config(), stage, "apps/x/jobs/other.tar")).toBe(true);
        expect(fs.existsSync(path.join(conn, "jobs", "other.tar"))).toBe(true);
    });
});
