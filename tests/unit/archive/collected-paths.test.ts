// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import net from "net";
import os from "os";
import path from "path";
import {
    collectedPathProblem,
    CollectedPathError,
    resolveCollectedPath,
    shownCollectedPath,
} from "@/lib/archive/collected-paths";
import { hashCollectedFile, openCollectedFile, readCollectedFile, readSmallCollectedFile } from "@/lib/archive/collected-file";
import { createArchive } from "@/lib/archive/writer";
import type { ArchiveSourceEntry } from "@/lib/archive/types";

describe("the names a directory source lists", () => {
    it.each([
        ["a.txt"],
        ["sub/dir/b.txt"],
        ["odd dir/[weird]*.txt"],
        ["..hidden"],
        ["a..b/c"],
        // On Linux a backslash is a plain character of one name, the way the kernel reads it.
        ["a\\b.txt"],
    ])("takes %j as a file inside the collection folder", (name) => {
        expect(collectedPathProblem(name, "linux")).toBeNull();
    });

    it.each([
        ["", "the name is empty"],
        ["../secret", "the name has a '..' part"],
        ["a/../../secret", "the name has a '..' part"],
        ["a/./b", "the name has a '.' part"],
        ["/etc/passwd", "the name is an absolute path"],
        ["a\0b", "the name holds a NUL character"],
        ["dir/", "the name ends in a separator"],
        ["a//b", "the name has an empty part"],
        // A restore reads a backslash as a separator, so a name it would refuse never gets packed.
        ["..\\..\\etc\\passwd", "the name has a '..' part between backslashes"],
        ["\\x", "the name starts with a backslash"],
    ])("refuses %j", (name, reason) => {
        expect(collectedPathProblem(name, "linux")).toBe(reason);
    });

    it("refuses a name that is no text at all", () => {
        expect(collectedPathProblem(undefined)).toBe("the name is empty");
        expect(collectedPathProblem(42)).toBe("the name is empty");
    });

    it.each([
        ["..\\secret"],
        ["C:\\Windows\\win.ini"],
        ["C:secret"],
        ["\\\\server\\share\\x"],
    ])("refuses %j where a backslash separates, on Windows", (name) => {
        expect(collectedPathProblem(name, "win32")).not.toBeNull();
    });

    it("resolves a plain name below the folder and refuses one that leaves it", () => {
        expect(resolveCollectedPath("/work/src", "a/b.txt")).toBe(path.resolve("/work/src/a/b.txt"));
        expect(() => resolveCollectedPath("/work/src", "../other/x")).toThrow(CollectedPathError);
        expect(() => resolveCollectedPath("/work/src", "/etc/passwd")).toThrow(CollectedPathError);
    });

    it("shows an odd name escaped and cut in the run log", () => {
        expect(shownCollectedPath("a\nforged line")).toBe("a\\nforged line");
        const long = shownCollectedPath("x".repeat(5000));
        expect(long.length).toBeLessThan(400);
        expect(long.endsWith("...")).toBe(true);
    });
});

describe("reading a collected file", () => {
    let base: string;
    let root: string;
    let outside: string;

    beforeEach(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), "collected-file-"));
        root = path.join(base, "sources", "src-1");
        outside = path.join(base, "outside");
        await fs.mkdir(root, { recursive: true });
        await fs.mkdir(outside, { recursive: true });
        await fs.writeFile(path.join(outside, "secret.txt"), "SERVER SECRET");
        await fs.writeFile(path.join(root, "plain.txt"), "plain content");
    });

    afterEach(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    it("reads a regular file inside the folder", async () => {
        expect((await readCollectedFile(root, "plain.txt")).toString()).toBe("plain content");
        const hashed = await hashCollectedFile(root, "plain.txt");
        expect(hashed.checksum).toMatch(/^[0-9a-f]{64}$/);
        expect(hashed.size).toBe("plain content".length);
    });

    it("reads a small file whole and leaves one past the limit unread", async () => {
        expect((await readSmallCollectedFile(root, "plain.txt", 64))?.toString()).toBe("plain content");
        expect(await readSmallCollectedFile(root, "plain.txt", 5)).toBeNull();
    });

    it("refuses a name that climbs to a file of the server", async () => {
        await expect(readCollectedFile(root, "../../outside/secret.txt")).rejects.toBeInstanceOf(CollectedPathError);
    });

    it("refuses a file that arrived as a link to a file of the server", async () => {
        await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "looks-like-a-file.txt"));
        await expect(readCollectedFile(root, "looks-like-a-file.txt")).rejects.toThrow(/symbolic link/);
    });

    it("refuses a file below a folder that arrived as a link out of the collection folder", async () => {
        await fs.symlink(outside, path.join(root, "dir"));
        await expect(readCollectedFile(root, "dir/secret.txt")).rejects.toThrow(/leads out of the collection folder/);
    });

    it("reads a file below a folder that is a link inside the collection folder", async () => {
        await fs.mkdir(path.join(root, "real"));
        await fs.writeFile(path.join(root, "real", "x.txt"), "inside");
        await fs.symlink("real", path.join(root, "alias"));
        expect((await readCollectedFile(root, "alias/x.txt")).toString()).toBe("inside");
    });

    it("refuses a folder and a socket", async () => {
        await fs.mkdir(path.join(root, "folder"));
        await expect(openCollectedFile(root, "folder")).rejects.toThrow(/a folder/);

        const server = net.createServer();
        const socketPath = path.join(root, "s.sock");
        await new Promise<void>((resolve) => server.listen(socketPath, resolve));
        try {
            await expect(openCollectedFile(root, "s.sock")).rejects.toThrow(/a socket/);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("never packs a file that became a link to a file of the server after it was collected", async () => {
        const entries: ArchiveSourceEntry[] = [{
            kind: "directory",
            jobSourceId: "src-1",
            label: "x",
            localPath: root,
            excludePatterns: [],
            files: [{ path: "plain.txt", size: 13, mtime: new Date(0).toISOString(), checksum: "0".repeat(64) }],
        }];
        // Swapped between the hash of the collection and the packing.
        await fs.rm(path.join(root, "plain.txt"));
        await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "plain.txt"));

        const archive = path.join(base, "out.tar");
        await expect(createArchive(entries, archive, { sourceType: "directory-only" })).rejects.toThrow(/symbolic link/);
        const written = await fs.readFile(archive).catch(() => Buffer.alloc(0));
        expect(written.includes("SERVER SECRET")).toBe(false);
    });

    it("still packs a tree with a symbolic link of the source as a link", async () => {
        const entries: ArchiveSourceEntry[] = [{
            kind: "directory",
            jobSourceId: "src-1",
            label: "x",
            localPath: root,
            excludePatterns: [],
            files: [
                { path: "plain.txt", size: 13, mtime: new Date(0).toISOString(), checksum: "0".repeat(64) },
                { path: "link", size: 0, mtime: new Date(0).toISOString(), linkTarget: "plain.txt" },
            ],
        }];

        const archive = path.join(base, "out.tar");
        const { index } = await createArchive(entries, archive, { sourceType: "directory-only" });

        expect(index.files.map((f) => [f.p, f.lnk])).toEqual([["plain.txt", undefined], ["link", "plain.txt"]]);
        expect((await fs.readFile(archive)).includes("plain content")).toBe(true);
    });
});
