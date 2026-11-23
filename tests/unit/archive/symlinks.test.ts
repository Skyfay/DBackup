/**
 * Symbolic links through the archive format.
 *
 * The bug these cover (#135) was silence: links were dropped during collection, so a backup
 * reported success and was incomplete, and nobody found out until a restore. The assertions
 * are therefore about what survives a full round trip, not about internal shapes.
 */

import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { createArchive } from "@/lib/archive/writer";
import { extractArchive } from "@/lib/archive/extract";
import { ENTRY_THROUGH_LINK, LINK_LEAVES_TARGET, linkLeavesTarget, throughLinkOf } from "@/lib/archive/link-target";
import { carryForward, fileKey } from "@/lib/archive/chain";
import { browseLevel } from "@/lib/archive/browse";
import {
    ArchiveIndex,
    ArchiveSourceEntry,
    IndexFileLine,
    isSymlinkLine,
    partitionSymlinks,
    SourceFileEntry,
} from "@/lib/archive/types";

const execFileAsync = promisify(execFile);

const SRC = "job-source-1";
const CERT_TARGET = "../../archive/npm-10/fullchain1.pem";
const MASTER_KEY = Buffer.alloc(32, 7);

async function tempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * The reported layout: real certificates in `archive/`, links to them in `live/`. Nginx
 * Proxy Manager reads the links, which is why losing them stops it from starting.
 */
async function buildLetsEncryptTree(root: string): Promise<void> {
    await fs.mkdir(path.join(root, "archive/npm-10"), { recursive: true });
    await fs.mkdir(path.join(root, "live/npm-10"), { recursive: true });
    await fs.writeFile(path.join(root, "archive/npm-10/fullchain1.pem"), "cert-bytes");
    await fs.symlink(CERT_TARGET, path.join(root, "live/npm-10/fullchain.pem"));
}

function sourceEntry(localPath: string, files: SourceFileEntry[]): ArchiveSourceEntry[] {
    return [{ kind: "directory", jobSourceId: SRC, label: "npm", localPath, excludePatterns: [], files }];
}

const CERT_FILE: SourceFileEntry = {
    path: "archive/npm-10/fullchain1.pem",
    size: 10,
    mtime: "2026-07-31T00:00:00.000Z",
};

const CERT_LINK: SourceFileEntry = {
    path: "live/npm-10/fullchain.pem",
    size: 0,
    mtime: "2026-07-31T00:00:00.000Z",
    linkTarget: CERT_TARGET,
};

describe("symbolic links in the archive format", () => {
    it("survives an unencrypted round trip and is readable by a foreign tar", async () => {
        const tmp = await tempDir("sym-plain-");
        const source = path.join(tmp, "src");
        await buildLetsEncryptTree(source);
        const archivePath = path.join(tmp, "backup.tar");

        const { manifest, index } = await createArchive(
            sourceEntry(source, [CERT_FILE, CERT_LINK]),
            archivePath,
            { sourceType: "directory-only" }
        );

        expect(manifest.counts.symlinks).toBe(1);
        expect(manifest.counts.files, "a link is one of the source's files").toBe(2);

        const link = index.files.find((f) => f.p === CERT_LINK.path)!;
        expect(link.lnk).toBe(CERT_TARGET);
        expect(link.s).toBe(0);
        expect(link.n, "a link has no payload, so it points at no entry").toBeUndefined();

        // The promise that an unencrypted archive needs no DBackup to unpack has to hold for
        // links too, or `tar -xf` produces a tree that is missing them.
        const { stdout } = await execFileAsync("tar", ["-tvf", archivePath]);
        expect(stdout).toMatch(
            new RegExp(`^l.*live/npm-10/fullchain\\.pem -> ${CERT_TARGET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m")
        );

        const out = path.join(tmp, "out");
        await extractArchive(archivePath, out);
        const restored = path.join(out, "sources", SRC, CERT_LINK.path);

        expect((await fs.lstat(restored)).isSymbolicLink()).toBe(true);
        expect(await fs.readlink(restored), "a relative target has to stay relative").toBe(CERT_TARGET);
        expect(await fs.readFile(restored, "utf-8"), "and still resolve to the real file").toBe("cert-bytes");
    });

    it("keeps the target out of the clear in an encrypted archive", async () => {
        const tmp = await tempDir("sym-enc-");
        const source = path.join(tmp, "src");
        await buildLetsEncryptTree(source);
        const archivePath = path.join(tmp, "backup.tar");

        await createArchive(sourceEntry(source, [CERT_FILE, CERT_LINK]), archivePath, {
            sourceType: "directory-only",
            encryption: { masterKey: MASTER_KEY, profileId: "p1" },
        });

        // A link target is a path, and a tar header is cleartext. Writing one there would
        // publish user data right next to the entries that exist to hide exactly that.
        const raw = await fs.readFile(archivePath);
        expect(raw.includes(Buffer.from(CERT_TARGET)), "the target must live only in the sealed index").toBe(false);
        expect(raw.includes(Buffer.from("live/npm-10")), "member names stay opaque as well").toBe(false);

        const out = path.join(tmp, "out");
        await extractArchive(archivePath, out, { masterKey: MASTER_KEY });
        expect(await fs.readlink(path.join(out, "sources", SRC, CERT_LINK.path))).toBe(CERT_TARGET);
    });

    it("stores a link to a directory without descending into it", async () => {
        const tmp = await tempDir("sym-dir-");
        const source = path.join(tmp, "src");
        await fs.mkdir(path.join(source, "real"), { recursive: true });
        await fs.writeFile(path.join(source, "real/inside.txt"), "x");
        await fs.symlink("real", path.join(source, "alias"));

        const archivePath = path.join(tmp, "backup.tar");
        await createArchive(
            sourceEntry(source, [
                { path: "real/inside.txt", size: 1, mtime: "2026-07-31T00:00:00.000Z" },
                { path: "alias", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: "real" },
            ]),
            archivePath,
            { sourceType: "directory-only" }
        );

        const out = path.join(tmp, "out");
        await extractArchive(archivePath, out);
        const root = path.join(out, "sources", SRC);

        expect((await fs.lstat(path.join(root, "alias"))).isSymbolicLink()).toBe(true);
        // Stored once, as a link. Following it would have written the target's bytes a second
        // time under the link's own path.
        expect(await fs.readFile(path.join(root, "alias/inside.txt"), "utf-8")).toBe("x");
    });

    it("preserves a dangling link rather than dropping it", async () => {
        const tmp = await tempDir("sym-dangling-");
        const source = path.join(tmp, "src");
        await fs.mkdir(source, { recursive: true });
        await fs.symlink("./gone.pem", path.join(source, "broken.pem"));

        const archivePath = path.join(tmp, "backup.tar");
        await createArchive(
            sourceEntry(source, [
                { path: "broken.pem", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: "./gone.pem" },
            ]),
            archivePath,
            { sourceType: "directory-only" }
        );

        const out = path.join(tmp, "out");
        await extractArchive(archivePath, out);
        const restored = path.join(out, "sources", SRC, "broken.pem");

        // A broken link is part of the source's state. Silently repairing or omitting it would
        // make the restore differ from what was backed up.
        expect((await fs.lstat(restored)).isSymbolicLink()).toBe(true);
        expect(await fs.readlink(restored)).toBe("./gone.pem");
    });

    it("does not let a link redirect a file write outside the output directory", async () => {
        const tmp = await tempDir("sym-traversal-");
        const source = path.join(tmp, "src");
        const escapeTarget = path.join(tmp, "escaped");
        await fs.mkdir(path.join(source, "foo"), { recursive: true });
        await fs.mkdir(escapeTarget, { recursive: true });
        await fs.writeFile(path.join(source, "foo/x"), "payload");

        // The classic tar symlink traversal: a link aimed outside, followed by a file written
        // "underneath" it. Both paths pass a string-based containment check.
        const archivePath = path.join(tmp, "backup.tar");
        await createArchive(
            sourceEntry(source, [
                { path: "foo", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: escapeTarget },
                { path: "foo/x", size: 7, mtime: "2026-07-31T00:00:00.000Z" },
            ]),
            archivePath,
            { sourceType: "directory-only" }
        );

        const out = path.join(tmp, "out");
        const result = await extractArchive(archivePath, out);

        // Links are created only after every regular file, so at the moment `foo/x` was
        // written no link existed for it to travel through.
        expect(
            await fs.readdir(escapeTarget),
            "nothing may be written outside the extraction root"
        ).toEqual([]);
        expect(await fs.readFile(path.join(out, "sources", SRC, "foo/x"), "utf-8")).toBe("payload");

        // The link points outside, so it is never laid, and the rest of the extraction is unaffected.
        expect(result.skippedSymlinks).toEqual([{ path: "foo", reason: LINK_LEAVES_TARGET }]);
    });

    it("never lays a link whose target is absolute or climbs out of the folder it restores into", async () => {
        const tmp = await tempDir("sym-outside-");
        const source = path.join(tmp, "src");
        await fs.mkdir(path.join(source, "conf"), { recursive: true });
        await fs.writeFile(path.join(source, "conf/app.ini"), "ini");

        const archivePath = path.join(tmp, "backup.tar");
        await createArchive(
            sourceEntry(source, [
                { path: "conf/app.ini", size: 3, mtime: "2026-07-31T00:00:00.000Z" },
                // Both would lead the next run that follows them to the database of DBackup.
                { path: "db", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: "/app/data/db" },
                { path: "conf/up", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: "../../../app/data" },
                { path: "conf/same", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: "./app.ini" },
            ]),
            archivePath,
            { sourceType: "directory-only" }
        );

        const out = path.join(tmp, "out");
        const result = await extractArchive(archivePath, out);
        const root = path.join(out, "sources", SRC);

        expect(result.skippedSymlinks).toEqual([
            { path: "db", reason: LINK_LEAVES_TARGET },
            { path: "conf/up", reason: LINK_LEAVES_TARGET },
        ]);
        await expect(fs.lstat(path.join(root, "db"))).rejects.toThrow();
        await expect(fs.lstat(path.join(root, "conf/up"))).rejects.toThrow();
        expect(await fs.readlink(path.join(root, "conf/same"))).toBe("./app.ini");
    });

    it("never lays a link below another link of the same backup, where it would land and point wherever that one leads", async () => {
        const tmp = await tempDir("sym-chain-");
        const source = path.join(tmp, "src");
        await fs.mkdir(source, { recursive: true });

        const archivePath = path.join(tmp, "backup.tar");
        await createArchive(
            sourceEntry(source, [
                // `x/y` leads to the root of the restore, so `x/y/z` would lie there and point above it.
                { path: "x/y", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: ".." },
                { path: "x/y/z", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: ".." },
            ]),
            archivePath,
            { sourceType: "directory-only" }
        );

        const out = path.join(tmp, "out");
        const result = await extractArchive(archivePath, out);
        const root = path.join(out, "sources", SRC);

        expect(result.skippedSymlinks).toEqual([{ path: "x/y/z", reason: ENTRY_THROUGH_LINK }]);
        expect(await fs.readlink(path.join(root, "x/y"))).toBe("..");
        await expect(fs.lstat(path.join(root, "z"))).rejects.toThrow();
    });

    it("tells an entry below a link of the same backup and source apart from one beside it", () => {
        const throughLink = throughLinkOf([
            { src: "a", p: "x/y", lnk: ".." },
            { src: "a", p: "x/real.txt" },
        ]);
        expect(throughLink("a", "x/y/z")).toBe(true);
        expect(throughLink("a", "X/Y/deeper/file")).toBe(true);
        expect(throughLink("a", "./x//y/z")).toBe(true);
        expect(throughLink("a", "x/y")).toBe(false);
        expect(throughLink("a", "x/yz/file")).toBe(false);
        expect(throughLink("a", "x/real.txt")).toBe(false);
        expect(throughLink("b", "x/y/z")).toBe(false);
    });

    it("judges a link by where its target lands from the folder the link lies in", () => {
        const noLinks = () => false;
        expect(linkLeavesTarget("live/npm-10/fullchain.pem", CERT_TARGET, noLinks)).toBe(false);
        expect(linkLeavesTarget("a/b", "../c", noLinks)).toBe(false);
        expect(linkLeavesTarget("a/b", "../../c", noLinks)).toBe(true);
        expect(linkLeavesTarget("b", "..", noLinks)).toBe(true);
        expect(linkLeavesTarget("a/b", "/etc/passwd", noLinks)).toBe(true);
        expect(linkLeavesTarget("a/b", "C:\\Windows", noLinks)).toBe(true);
        expect(linkLeavesTarget("a/b", "\\\\server\\share", noLinks)).toBe(true);
        expect(linkLeavesTarget("a/b", "..\\..\\x", noLinks)).toBe(true);
        expect(linkLeavesTarget("a/b", "", noLinks)).toBe(true);
    });

    it("refuses a target that climbs back after a folder, which may itself be a link that leads elsewhere", () => {
        const noLinks = () => false;
        // Read as text `x/up/../secret` stays inside, but with `x/up -> ..` the system climbs from the root of the restore.
        expect(linkLeavesTarget("x/leak", "up/../secret", noLinks)).toBe(true);
        expect(linkLeavesTarget("a/b", "c/..", noLinks)).toBe(true);
        expect(linkLeavesTarget("a/b/c", "../d/../e", noLinks)).toBe(true);
        expect(linkLeavesTarget("a/b/c", "./d\\..\\e", noLinks)).toBe(true);
        // Leading `..` parts climb from the real folder the link lies in, and `.` is no folder.
        expect(linkLeavesTarget("a/b/c", "../../d/e", noLinks)).toBe(false);
        expect(linkLeavesTarget("a/b/c", "./../d/./e", noLinks)).toBe(false);
    });

    it("refuses a part of dots and spaces alone, which some systems read as `..`, like every other path of a restore", () => {
        const noLinks = () => false;
        for (const part of ["...", ".. ", " ..", ". .", "%2e%2e", "%2E%2e%2e", " "]) {
            expect(linkLeavesTarget("a/b/c", `${part}/x`, noLinks), `${JSON.stringify(part)} at the start`).toBe(true);
            expect(linkLeavesTarget("a/b/c", `d/${part}`, noLinks), `${JSON.stringify(part)} after a folder`).toBe(true);
            expect(linkLeavesTarget("a/b/c", `..\\${part}\\x`, noLinks), `${JSON.stringify(part)} between backslashes`).toBe(true);
        }
        // A name that only holds dots among other characters stays a name.
        expect(linkLeavesTarget("a/b/c", "d/.hidden/x..y", noLinks)).toBe(false);
        expect(linkLeavesTarget("a/b/c", "../d.e", noLinks)).toBe(false);
    });

    it("refuses a target that runs through a link of the same backup and source", () => {
        const throughLink = throughLinkOf([
            { src: "a", p: "x/up", lnk: ".." },
            { src: "a", p: "x/peek", lnk: "up/etc" },
            { src: "a", p: "x/plain", lnk: "real/etc" },
        ]);
        expect(linkLeavesTarget("x/peek", "up/etc", (resolved) => throughLink("a", resolved))).toBe(true);
        expect(linkLeavesTarget("y/peek", "../X/Up/etc", (resolved) => throughLink("a", resolved))).toBe(true);
        expect(linkLeavesTarget("x/plain", "real/etc", (resolved) => throughLink("a", resolved))).toBe(false);
        // A link to the link itself runs through nothing.
        expect(linkLeavesTarget("x/same", "up", (resolved) => throughLink("a", resolved))).toBe(false);
        expect(linkLeavesTarget("x/peek", "up/etc", (resolved) => throughLink("b", resolved))).toBe(false);
    });

    it("never lays a link that climbs back through a link of the same backup on extraction", async () => {
        const tmp = await tempDir("sym-climb-");
        const source = path.join(tmp, "src");
        await fs.mkdir(source, { recursive: true });

        const archivePath = path.join(tmp, "backup.tar");
        await createArchive(
            sourceEntry(source, [
                // `x/up` leads to the root of the restore, so `up/../secret` from `x` lands above it.
                { path: "x/up", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: ".." },
                { path: "x/leak", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: "up/../secret" },
                { path: "x/peek", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: "up/x" },
            ]),
            archivePath,
            { sourceType: "directory-only" }
        );

        const out = path.join(tmp, "out");
        const result = await extractArchive(archivePath, out);
        const root = path.join(out, "sources", SRC);

        expect(result.skippedSymlinks).toEqual([
            { path: "x/leak", reason: LINK_LEAVES_TARGET },
            { path: "x/peek", reason: LINK_LEAVES_TARGET },
        ]);
        expect(await fs.readlink(path.join(root, "x/up"))).toBe("..");
        await expect(fs.lstat(path.join(root, "x/leak"))).rejects.toThrow();
    });

    it("never extracts a directory source whose id from the index leaves the folder of the sources", async () => {
        const tmp = await tempDir("src-id-");
        const source = path.join(tmp, "src");
        await fs.mkdir(source, { recursive: true });
        await fs.writeFile(path.join(source, "x.txt"), "payload");

        for (const jobSourceId of ["../../escaped", ".", ""]) {
            const archivePath = path.join(tmp, `backup-${jobSourceId.length}.tar`);
            await createArchive(
                [{ kind: "directory", jobSourceId, label: "evil", localPath: source, excludePatterns: [], files: [{ path: "x.txt", size: 7, mtime: "2026-07-31T00:00:00.000Z" }] }],
                archivePath,
                { sourceType: "directory-only" }
            );

            const out = path.join(tmp, `out-${jobSourceId.length}`);
            await expect(extractArchive(archivePath, out), JSON.stringify(jobSourceId)).rejects.toThrow(/Refusing to extract/);
        }
        await expect(fs.lstat(path.join(tmp, "escaped"))).rejects.toThrow();
    });

    it("keeps extracting when one link cannot be created", async () => {
        const tmp = await tempDir("sym-partial-");
        const source = path.join(tmp, "src");
        await fs.mkdir(path.join(source, "dir"), { recursive: true });
        await fs.writeFile(path.join(source, "dir/keep.txt"), "kept");

        const archivePath = path.join(tmp, "backup.tar");
        await createArchive(
            sourceEntry(source, [
                { path: "dir/keep.txt", size: 4, mtime: "2026-07-31T00:00:00.000Z" },
                // Collides with the directory above, so this one cannot be created.
                { path: "dir", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: "./elsewhere" },
                // Not through `dir`, which the index calls a link, see `linkLeavesTarget`.
                { path: "ok.pem", size: 0, mtime: "2026-07-31T00:00:00.000Z", linkTarget: "./certs/keep.pem" },
            ]),
            archivePath,
            { sourceType: "directory-only" }
        );

        const out = path.join(tmp, "out");
        const result = await extractArchive(archivePath, out);
        const root = path.join(out, "sources", SRC);

        expect(result.skippedSymlinks.map((s) => s.path)).toEqual(["dir"]);
        expect(await fs.readFile(path.join(root, "dir/keep.txt"), "utf-8")).toBe("kept");
        expect(await fs.readlink(path.join(root, "ok.pem")), "later links still get created").toBe("./certs/keep.pem");
    });

    it("restates links in an incremental chain instead of carrying them forward", () => {
        const linkLine: IndexFileLine = {
            k: "f", src: SRC, p: CERT_LINK.path, s: 0, m: CERT_LINK.mtime, lnk: CERT_TARGET,
        };
        const fileLine: IndexFileLine = {
            k: "f", src: SRC, p: CERT_FILE.path, s: 10, m: CERT_FILE.mtime, h: "abc", n: 1,
        };

        const previous: ArchiveIndex = {
            header: { k: "h", v: 2, createdAt: CERT_FILE.mtime, archive: "full-000.tar" },
            entries: new Map([["#1", { k: "e", n: 1, member: "d/000001", off: 1024, size: 10 }]]),
            databases: [],
            directories: [{ k: "d", src: SRC, label: "npm", fileCount: 2, totalSize: 10, excludePatterns: [] }],
            files: [fileLine, linkLine],
            deps: [],
        };

        // Both are asked for. Only the file may come back: a link has no bytes anywhere to
        // point at, and looking one up would resolve ordinal `undefined`.
        const keep = new Set([fileKey(SRC, CERT_FILE.path), fileKey(SRC, CERT_LINK.path)]);
        const carried = carryForward(previous, "full-000.tar", keep);

        expect(carried.files.map((f) => f.p)).toEqual([CERT_FILE.path]);
        expect(carried.entries).toHaveLength(1);
    });

    it("separates links from payload lines for the restore paths", () => {
        const link: IndexFileLine = { k: "f", src: SRC, p: "a", s: 0, m: CERT_FILE.mtime, lnk: "./b" };
        const file: IndexFileLine = { k: "f", src: SRC, p: "b", s: 2, m: CERT_FILE.mtime, n: 1 };

        expect(isSymlinkLine(link)).toBe(true);
        expect(isSymlinkLine(file)).toBe(false);

        const { payloads, symlinks } = partitionSymlinks([{ file: link, src: SRC }, { file, src: SRC }]);
        expect(payloads.map((p) => p.file.p)).toEqual(["b"]);
        expect(symlinks.map((s) => s.file.lnk)).toEqual(["./b"]);
    });

    it("shows a link in the browse tree with its target", () => {
        const index = {
            files: [
                { k: "f", src: SRC, p: "live/cert.pem", s: 0, m: CERT_FILE.mtime, lnk: CERT_TARGET },
                { k: "f", src: SRC, p: "live/real.pem", s: 12, m: CERT_FILE.mtime, n: 1 },
            ],
        } as ArchiveIndex;

        const entries = browseLevel(index, SRC, "live");
        expect(entries.find((e) => e.name === "cert.pem")?.link).toBe(CERT_TARGET);
        expect(entries.find((e) => e.name === "real.pem")?.link).toBeUndefined();
    });
});
