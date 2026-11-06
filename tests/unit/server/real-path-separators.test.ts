// @vitest-environment node
/**
 * Off Windows a backslash is part of a name, so `out\x` is one entry of its folder. The walk that
 * finds where a path really leads used to split there as well, and so took a link named `out\x`
 * that leads out of the base folder for a folder `out` with an `x` inside, which a write then
 * followed out of the base. Checked on real folders with links.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pathParts, realExisting } from "@/lib/server/real-path";
import { LocalFileSystemAdapter } from "@/lib/adapters/storage/local";

describe("the parts of a path", () => {
    it("split at a backslash on Windows alone", () => {
        expect(pathParts("a\\b/c", "linux")).toEqual(["a\\b", "c"]);
        expect(pathParts("a\\b/c", "darwin")).toEqual(["a\\b", "c"]);
        expect(pathParts("a\\b/c", "win32")).toEqual(["a", "b", "c"]);
        expect(pathParts("a//b", "linux")).toEqual(["a", "b"]);
    });
});

describe.skipIf(process.platform === "win32")("a link whose name holds a backslash", () => {
    let root: string;
    let base: string;
    let outside: string;

    beforeAll(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "real-path-sep-")));
        base = path.join(root, "backups");
        outside = path.join(root, "secret");
        fs.mkdirSync(base, { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        fs.symlinkSync(outside, path.join(base, "out\\x"));
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("is followed where the kernel follows it", async () => {
        await expect(realExisting(path.join(base, "out\\x", "new.tar"))).resolves.toBe(path.join(outside, "new.tar"));
    });

    it("lets no write of the Local Filesystem out of its folder", async () => {
        const local = path.join(root, "upload.tar");
        fs.writeFileSync(local, "NEW");

        const written = await LocalFileSystemAdapter.upload({ basePath: base }, local, "out\\x/new.tar").catch(() => false);
        expect(written).toBe(false);
        expect(fs.readdirSync(outside)).toEqual([]);
    });
});
