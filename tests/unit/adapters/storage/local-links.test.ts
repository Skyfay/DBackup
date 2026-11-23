// @vitest-environment node
/**
 * A Local Filesystem connection stays inside its folder also where a symbolic link below it points
 * elsewhere. The check used to compare the path as written only, so a folder of a job that is a
 * link to `/etc` or to the database of DBackup let a write, a read, a listing or a delete through
 * it reach whatever it points at. Members of the home tenant pick such connections in their jobs.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalFileSystemAdapter } from "@/lib/adapters/storage/local";

let root: string;
let base: string;
let outside: string;
const config = () => ({ basePath: base });

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "local-links-")));
    base = path.join(root, "backups");
    outside = path.join(root, "secret");
    fs.mkdirSync(path.join(base, "nightly"), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "dbackup.db"), "SECRET");
    fs.writeFileSync(path.join(base, "nightly", "a.tar"), "A");
    // A folder of a job and a file that lead out of the base folder, and one link that stays inside.
    fs.symlinkSync(outside, path.join(base, "escape"));
    fs.symlinkSync(path.join(outside, "dbackup.db"), path.join(base, "nightly", "copy.tar"));
    fs.symlinkSync(path.join(base, "nightly"), path.join(base, "latest"));
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("a Local Filesystem path through a symbolic link", () => {
    it("writes nothing into a folder a link below the base leads out to", async () => {
        const local = path.join(root, "upload.tar");
        fs.writeFileSync(local, "NEW");

        await expect(LocalFileSystemAdapter.upload(config(), local, "escape/x.tar")).rejects.toThrow(/Access denied/);
        expect(fs.readdirSync(outside)).toEqual(["dbackup.db"]);
    });

    it("never writes through a file that is a link out of the base", async () => {
        const local = path.join(root, "upload-2.tar");
        fs.writeFileSync(local, "NEW");

        await expect(LocalFileSystemAdapter.upload(config(), local, "nightly/copy.tar")).rejects.toThrow(/Access denied/);
        expect(fs.readFileSync(path.join(outside, "dbackup.db"), "utf-8")).toBe("SECRET");
    });

    it("never creates the target of a link out of the base that does not exist yet", async () => {
        const local = path.join(root, "upload-3.tar");
        fs.writeFileSync(local, "NEW");
        fs.symlinkSync(path.join(outside, "planted.db"), path.join(base, "nightly", "dangling.tar"));
        // A chain of two links, the first inside the base, the last pointing out to nothing yet.
        fs.symlinkSync(path.join(base, "nightly", "dangling.tar"), path.join(base, "nightly", "chained.tar"));

        for (const remote of ["nightly/dangling.tar", "nightly/chained.tar"]) {
            const written = await LocalFileSystemAdapter.upload(config(), local, remote).catch(() => false);
            expect(written, remote).toBe(false);
        }
        expect(fs.existsSync(path.join(outside, "planted.db"))).toBe(false);
    });

    it("climbs with a .. from where a link really leads, never from the text of its target", async () => {
        const local = path.join(root, "upload-5.tar");
        fs.writeFileSync(local, "NEW");
        // `d1/d2/up` leads back to the base, so `up/../secret` in the target of `out` is beside the base.
        fs.mkdirSync(path.join(base, "d1", "d2"), { recursive: true });
        fs.symlinkSync("../..", path.join(base, "d1", "d2", "up"));
        fs.symlinkSync("up/../secret/chain.db", path.join(base, "d1", "d2", "out"));

        const written = await LocalFileSystemAdapter.upload(config(), local, "d1/d2/out").catch(() => false);
        expect(written).toBe(false);
        expect(fs.existsSync(path.join(outside, "chain.db"))).toBe(false);
    });

    it("follows a dangling link from the folder it really sits in, also behind another link", async () => {
        const local = path.join(root, "upload-4.tar");
        fs.writeFileSync(local, "NEW");
        // `p/q/up` leads back to the base, so `p/q/up/far` really sits in the base and climbs out of it.
        fs.mkdirSync(path.join(base, "p", "q"), { recursive: true });
        fs.symlinkSync("../..", path.join(base, "p", "q", "up"));
        fs.symlinkSync("../secret/far.db", path.join(base, "far"));

        const written = await LocalFileSystemAdapter.upload(config(), local, "p/q/up/far").catch(() => false);
        expect(written).toBe(false);
        expect(fs.existsSync(path.join(outside, "far.db"))).toBe(false);
    });

    it("reads, lists and browses nothing out there", async () => {
        await expect(LocalFileSystemAdapter.read!(config(), "escape/dbackup.db")).rejects.toThrow(/Access denied/);
        await expect(LocalFileSystemAdapter.read!(config(), "nightly/copy.tar")).rejects.toThrow(/Access denied/);
        await expect(LocalFileSystemAdapter.download(config(), "escape/dbackup.db", path.join(root, "got.db"))).rejects.toThrow(/Access denied/);
        await expect(LocalFileSystemAdapter.list(config(), "escape")).rejects.toThrow(/Access denied/);
        await expect(LocalFileSystemAdapter.browseDirectories!(config(), "escape")).rejects.toThrow(/Access denied/);
        await expect(LocalFileSystemAdapter.downloadRange!(config(), "escape/dbackup.db", 0, 5)).rejects.toThrow(/Access denied/);
    });

    it("deletes nothing out there, and lays no new link into it", async () => {
        await expect(LocalFileSystemAdapter.delete(config(), "escape/dbackup.db")).rejects.toThrow(/Access denied/);
        await expect(LocalFileSystemAdapter.createSymlink!(config(), "escape/new-link", "../x")).rejects.toThrow(/Access denied/);
        expect(fs.readdirSync(outside)).toEqual(["dbackup.db"]);
    });

    it("lays no link whose target climbs out of the base with ..", async () => {
        await expect(LocalFileSystemAdapter.createSymlink!(config(), "nightly/up", "../../secret/dbackup.db")).rejects.toThrow(/Access denied/);
        await expect(LocalFileSystemAdapter.createSymlink!(config(), "top", "..")).rejects.toThrow(/Access denied/);
        // A `..` after a folder climbs from wherever that folder leads once the link is read.
        await expect(LocalFileSystemAdapter.createSymlink!(config(), "nightly/later", "sub/../../..")).rejects.toThrow(/Access denied/);
        expect(fs.existsSync(path.join(base, "nightly", "up"))).toBe(false);
        expect(fs.existsSync(path.join(base, "top"))).toBe(false);
    });

    it("lays no link with an absolute target outside the base", async () => {
        await expect(LocalFileSystemAdapter.createSymlink!(config(), "nightly/abs", path.join(outside, "dbackup.db"))).rejects.toThrow(/Access denied/);
        await expect(LocalFileSystemAdapter.createSymlink!(config(), "nightly/etc", "/etc")).rejects.toThrow(/Access denied/);
        expect(fs.existsSync(path.join(base, "nightly", "abs"))).toBe(false);
    });

    it("lays no link whose target runs through an existing link that leads out", async () => {
        // `escape` is a link to the folder beside the base, so `escape/dbackup.db` lies out there.
        await expect(LocalFileSystemAdapter.createSymlink!(config(), "nightly/through", "../escape/dbackup.db")).rejects.toThrow(/Access denied/);
        await expect(LocalFileSystemAdapter.createSymlink!(config(), "nightly/through-abs", path.join(base, "escape", "x"))).rejects.toThrow(/Access denied/);
        expect(fs.existsSync(path.join(base, "nightly", "through"))).toBe(false);
    });

    it("reads the target from the folder the link really lies in, not from the text of its path", async () => {
        // `latest` leads to `nightly`, so `../..` from `latest/deep` climbs from `nightly`, out of the base.
        await expect(LocalFileSystemAdapter.createSymlink!(config(), "latest/deep", "../..")).rejects.toThrow(/Access denied/);
        expect(fs.existsSync(path.join(base, "nightly", "deep"))).toBe(false);
    });

    it("still lays a link whose target stays inside the base, relative or absolute, existing or not", async () => {
        await LocalFileSystemAdapter.createSymlink!(config(), "certs/live/cert.pem", "../../nightly/a.tar");
        expect(fs.readlinkSync(path.join(base, "certs", "live", "cert.pem"))).toBe("../../nightly/a.tar");
        expect(fs.readFileSync(path.join(base, "certs", "live", "cert.pem"), "utf-8")).toBe("A");
        await LocalFileSystemAdapter.createSymlink!(config(), "current", "nightly");
        await LocalFileSystemAdapter.createSymlink!(config(), "nightly/future", "./not-yet/b.tar");
        await LocalFileSystemAdapter.createSymlink!(config(), "nightly/abs-inside", path.join(base, "nightly", "a.tar"));
        expect(fs.readlinkSync(path.join(base, "nightly", "abs-inside"))).toBe(path.join(base, "nightly", "a.tar"));
        // Laid again over the link it laid before, as a second restore does.
        await LocalFileSystemAdapter.createSymlink!(config(), "current", "latest");
        expect(fs.readlinkSync(path.join(base, "current"))).toBe("latest");
    });

    it("still removes a link itself, which never touches what it points at", async () => {
        const link = path.join(base, "dangling");
        fs.symlinkSync(path.join(outside, "gone"), link);

        await expect(LocalFileSystemAdapter.delete(config(), "dangling")).resolves.toBe(true);
        expect(fs.existsSync(link)).toBe(false);
        expect(fs.readFileSync(path.join(outside, "dbackup.db"), "utf-8")).toBe("SECRET");
    });

    it("keeps working through a link that stays inside the base, and on a path that does not exist yet", async () => {
        await expect(LocalFileSystemAdapter.read!(config(), "latest/a.tar")).resolves.toBe("A");
        const local = path.join(root, "upload-3.tar");
        fs.writeFileSync(local, "B");
        await expect(LocalFileSystemAdapter.upload(config(), local, "weekly/new/b.tar")).resolves.toBe(true);
        expect(fs.readFileSync(path.join(base, "weekly", "new", "b.tar"), "utf-8")).toBe("B");
    });
});
