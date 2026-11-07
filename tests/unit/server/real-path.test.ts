// @vitest-environment node
/**
 * The Local Filesystem adapter and the check of DBackup's own data read where a path on the server
 * really leads with the same walk, so a link the one follows the other follows too. Checked on real
 * folders with links.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_LINKS, TooManyLinksError, inside, realExisting } from "@/lib/server/real-path";

let root: string;

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "real-path-")));
    fs.mkdirSync(path.join(root, "base", "d1", "d2"), { recursive: true });
    fs.mkdirSync(path.join(root, "secret"), { recursive: true });
    fs.symlinkSync(path.join(root, "secret"), path.join(root, "base", "escape"));
    fs.symlinkSync(path.join(root, "secret", "planted"), path.join(root, "base", "dangling"));
    fs.symlinkSync("../..", path.join(root, "base", "d1", "d2", "up"));
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("where a path on the server really leads", () => {
    it("resolves an existing path through its links", async () => {
        await expect(realExisting(path.join(root, "base", "escape"))).resolves.toBe(path.join(root, "secret"));
    });

    it("appends the parts that do not exist yet to the real folder they would land in", async () => {
        await expect(realExisting(path.join(root, "base", "escape", "new", "file"))).resolves.toBe(path.join(root, "secret", "new", "file"));
        await expect(realExisting(path.join(root, "base", "fresh", "file"))).resolves.toBe(path.join(root, "base", "fresh", "file"));
    });

    it("follows a link that does not lead anywhere yet to its target, where a write through it lands", async () => {
        await expect(realExisting(path.join(root, "base", "dangling"))).resolves.toBe(path.join(root, "secret", "planted"));
    });

    it("climbs with a .. in the target of a link from where the link before it really leads", async () => {
        // `d1/d2/up` leads to the base, so `up/../secret` climbs from the base, not from `d2`.
        fs.symlinkSync("up/../secret/chain.db", path.join(root, "base", "d1", "d2", "out"));
        await expect(realExisting(path.join(root, "base", "d1", "d2", "out"))).resolves.toBe(path.join(root, "secret", "chain.db"));
    });

    it("climbs with a .. after a link in the path itself from where the link leads, also for a path that does not exist yet", async () => {
        // `escape` leads to `secret`, so `escape/../x` is the folder above `secret` for the kernel, not `base`.
        fs.mkdirSync(path.join(root, "secret", "inner"), { recursive: true });
        fs.symlinkSync(path.join(root, "secret", "inner"), path.join(root, "base", "deep"));
        await expect(realExisting(path.join(root, "base", "deep") + "/../new/file")).resolves.toBe(path.join(root, "secret", "new", "file"));
    });

    it("walks a relative path from the folder DBackup runs in", async () => {
        const relative = path.relative(process.cwd(), path.join(root, "base", "deep")) + "/../fresh.db";
        await expect(realExisting(relative)).resolves.toBe(path.join(root, "secret", "fresh.db"));
    });

    it("stops a loop of links after as many links as the kernel follows", async () => {
        fs.symlinkSync("loop-b", path.join(root, "base", "loop-a"));
        fs.symlinkSync("loop-a", path.join(root, "base", "loop-b"));
        await expect(realExisting(path.join(root, "base", "loop-a", "x"))).rejects.toBeInstanceOf(TooManyLinksError);
        expect(MAX_LINKS).toBe(40);
    });

    it("counts a folder as inside itself and below it, never a sibling that only starts like it", () => {
        expect(inside("/srv/data", "/srv/data")).toBe(true);
        expect(inside("/srv/data/x", "/srv/data")).toBe(true);
        expect(inside("/srv/dataEVIL/x", "/srv/data")).toBe(false);
        expect(inside("/x", "/")).toBe(true);
    });
});
