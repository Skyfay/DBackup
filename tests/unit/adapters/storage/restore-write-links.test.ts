// @vitest-environment node
/**
 * A write of a restore stays inside the folder the restore writes into, also where another user of
 * the server planted a symbolic link below it. rsync and FTP take a path as text and the server
 * follows the link, so each checks the folders on the way before it writes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { readFileSync } from "fs";
import os from "os";
import path from "path";
import type { Client } from "basic-ftp";
import { assertRestoreDirAnswer, restoreDirCommand, writesInPlace, RESTORE_DIR_LINK, RESTORE_DIR_OK } from "@/lib/adapters/storage/rsync-restore-dir";
import { ensureFtpRestoreDir } from "@/lib/adapters/storage/ftp-restore-dir";

const run = promisify(execFile);

describe("the folders of a restore write over rsync, as the server checks them", () => {
    let server: string;
    /** Runs the command the adapter sends over SSH in a local shell, the way sshd hands it to the login shell. */
    const onServer = async (command: string) => (await run("sh", ["-c", command], { cwd: server })).stdout.trim();

    beforeEach(async () => {
        server = await fs.mkdtemp(path.join(os.tmpdir(), "rsync-restore-dir-"));
        await fs.mkdir(path.join(server, "conn/apps"), { recursive: true });
        await fs.mkdir(path.join(server, "outside"));
    });
    afterEach(async () => { await fs.rm(server, { recursive: true, force: true }); });

    it("creates missing folders inside the folder of the restore", async () => {
        const answer = await onServer(restoreDirCommand({ folder: path.join(server, "conn/apps"), parts: ["plain", "it's"] }));
        expect(answer).toBe(RESTORE_DIR_OK);
        expect((await fs.stat(path.join(server, "conn/apps/plain/it's"))).isDirectory()).toBe(true);
    });

    it("refuses a folder that is a link out of the folder of the restore, and creates nothing behind it", async () => {
        await fs.symlink("../../outside", path.join(server, "conn/apps/d"));

        const answer = await onServer(restoreDirCommand({ folder: path.join(server, "conn/apps"), parts: ["d", "sub"] }));

        expect(answer).toBe(RESTORE_DIR_LINK);
        expect(await fs.readdir(path.join(server, "outside"))).toEqual([]);
        expect(() => assertRestoreDirAnswer(answer, "conn/apps/d/sub")).toThrow(/symbolic link out of the folder of the restore/);
    });

    it("refuses a dangling link and a file where a folder should be", async () => {
        await fs.symlink("/nowhere/at/all", path.join(server, "conn/apps/gone"));
        await fs.writeFile(path.join(server, "conn/apps/file"), "x");
        expect(await onServer(restoreDirCommand({ folder: path.join(server, "conn/apps"), parts: ["gone"] }))).toBe(RESTORE_DIR_LINK);
        expect(await onServer(restoreDirCommand({ folder: path.join(server, "conn/apps"), parts: ["file"] }))).toBe(RESTORE_DIR_LINK);
    });

    it("follows a link that stays inside the folder of the restore, and a relative folder setting", async () => {
        await fs.mkdir(path.join(server, "conn/apps/real"));
        await fs.symlink("real", path.join(server, "conn/apps/media"));
        expect(await onServer(restoreDirCommand({ folder: "./conn/apps", parts: ["media", "new"] }))).toBe(RESTORE_DIR_OK);
        expect((await fs.stat(path.join(server, "conn/apps/real/new"))).isDirectory()).toBe(true);
    });

    it("removes a link at the name of the file when the options of the connection write in place", async () => {
        await fs.writeFile(path.join(server, "outside/victim.txt"), "ORIGINAL");
        await fs.symlink("../../outside/victim.txt", path.join(server, "conn/apps/leaf.txt"));

        expect(writesInPlace("--inplace -z")).toBe(true);
        expect(writesInPlace("-z --bwlimit=100")).toBe(false);
        expect(await onServer(restoreDirCommand({ folder: path.join(server, "conn/apps"), parts: [], removeLeafLink: "leaf.txt" }))).toBe(RESTORE_DIR_OK);

        await expect(fs.lstat(path.join(server, "conn/apps/leaf.txt"))).rejects.toThrow();
        expect(await fs.readFile(path.join(server, "outside/victim.txt"), "utf-8")).toBe("ORIGINAL");
    });

    it("refuses a part that is no plain name, and an answer that does not say the folders are fine", () => {
        expect(() => restoreDirCommand({ folder: "/srv", parts: [".."] })).toThrow(/no plain path/);
        expect(() => restoreDirCommand({ folder: "~other/x", parts: [] })).toThrow(/home folder of another account/);
        expect(() => assertRestoreDirAnswer("", "/srv/x")).toThrow(/could not be created and checked/);
        expect(() => assertRestoreDirAnswer(`motd\n${RESTORE_DIR_OK}\n`, "/srv/x")).not.toThrow();
    });
});

describe("the folders of a restore write over FTP", () => {
    type Entry = { name: string; isDirectory: boolean; isSymbolicLink: boolean };
    const dir = (name: string): Entry => ({ name, isDirectory: true, isSymbolicLink: false });
    const link = (name: string): Entry => ({ name, isDirectory: false, isSymbolicLink: true });
    const file = (name: string): Entry => ({ name, isDirectory: false, isSymbolicLink: false });

    /** A server as its listings show it, with what the adapter did to it. */
    function fakeServer(listings: Record<string, Entry[]>) {
        const made: string[] = [];
        const removed: string[] = [];
        const client = {
            list: async (folder: string) => listings[folder] ?? [],
            ensureDir: async (folder: string) => { made.push(folder); },
            cd: async () => undefined,
            remove: async (target: string) => { removed.push(target); },
        } as unknown as Client;
        return { client, made, removed };
    }

    it("refuses a folder below the folder of the restore that the server lists as a link", async () => {
        const server = fakeServer({ "/srv/apps": [link("d")] });
        await expect(ensureFtpRestoreDir(server.client, "/srv/apps", "d/sub/victim.txt", new Set())).rejects.toThrow(/symbolic link/);
        // The folder of the restore itself, nothing below the link.
        expect(server.made).toEqual(["/srv/apps"]);
    });

    it("refuses a file where a folder should be", async () => {
        const server = fakeServer({ "/srv/apps": [file("d")] });
        await expect(ensureFtpRestoreDir(server.client, "/srv/apps", "d/x.txt", new Set())).rejects.toThrow(/no folder/);
    });

    it("enters plain folders and creates the missing ones", async () => {
        const server = fakeServer({ "/srv/apps": [dir("d")], "/srv/apps/d": [] });
        await ensureFtpRestoreDir(server.client, "/srv/apps", "d/new/f.txt", new Set());
        expect(server.made).toEqual(["/srv/apps", "/srv/apps/d/new"]);
        expect(server.removed).toEqual([]);
    });

    it("deletes a link at the name of the file before the upload, and no plain file", async () => {
        const server = fakeServer({ "/srv/apps": [link("leaf.txt"), file("plain.txt")] });
        const cache = new Set<string>();
        await ensureFtpRestoreDir(server.client, "/srv/apps", "leaf.txt", cache);
        await ensureFtpRestoreDir(server.client, "/srv/apps", "plain.txt", cache);
        expect(server.removed).toEqual(["/srv/apps/leaf.txt"]);
    });
});

describe("every storage adapter whose server follows symbolic links", () => {
    it("reads the path of a restore write below its folder", () => {
        for (const adapter of ["local.ts", "sftp.ts", "rsync.ts", "ftp.ts"]) {
            const source = readFileSync(path.join(process.cwd(), "src/lib/adapters/storage", adapter), "utf-8");
            expect(source, adapter).toContain("restoreRelativePath");
        }
    });
});
