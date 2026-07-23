import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { pack } from "tar-stream";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { walkTarHeaders, buildUstarHeader, tarPadding, TAR_TRAILER } from "@/lib/archive/tar-blocks";

const execFileAsync = promisify(execFile);

let workDir: string;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "tar-blocks-test-"));
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

interface Member {
    name: string;
    data: Buffer;
}

/** Writes a tar with tar-stream, deliberately without finalizing so members can be appended. */
async function writeTar(members: Member[], finalize: boolean): Promise<string> {
    const target = path.join(workDir, "archive.tar");
    const tarPack = pack();
    const done = pipeline(tarPack, createWriteStream(target));

    for (const member of members) {
        const entry = tarPack.entry({ name: member.name, size: member.data.length });
        await new Promise<void>((resolve, reject) => {
            entry.on("error", reject);
            entry.on("finish", () => resolve());
            // Many small writes, to reproduce the backpressure that makes byte counting wrong.
            for (let i = 0; i < member.data.length; i += 16 * 1024) {
                entry.write(member.data.subarray(i, i + 16 * 1024));
            }
            entry.end();
        });
    }

    if (finalize) tarPack.finalize();
    else tarPack.push(null);
    await done;
    return target;
}

describe("walkTarHeaders", () => {
    it("reports byte-exact payload offsets for plain, ustar-prefixed and PAX members", async () => {
        const members: Member[] = [
            { name: "manifest.json", data: Buffer.from('{"version":2}') },
            { name: "databases/appdb.sql", data: crypto.randomBytes(200_000) },
            // Long but splittable at a slash - encoded via the ustar prefix field.
            { name: `sources/${"nested-directory/".repeat(9)}file.bin`, data: crypto.randomBytes(30_000) },
            // Too long and unsplittable - forces a PAX extended header.
            { name: `${"x".repeat(300)}.bin`, data: crypto.randomBytes(77_777) },
            { name: "sources/Ünïcødé Ordner/Datei ähnlich.txt", data: crypto.randomBytes(1024) },
            { name: "empty.bin", data: Buffer.alloc(0) },
            // Exactly one block, so padding is zero.
            { name: "aligned.bin", data: crypto.randomBytes(512) },
        ];

        const target = await writeTar(members, true);
        const located = await walkTarHeaders(target);
        const raw = await fs.readFile(target);

        expect(located.map((m) => m.name)).toEqual(members.map((m) => m.name));

        for (let i = 0; i < members.length; i++) {
            expect(located[i].size).toBe(members[i].data.length);
            const payload = raw.subarray(located[i].offset, located[i].offset + located[i].size);
            expect(payload.equals(members[i].data)).toBe(true);
        }
    });

    it("keeps its place across an entry whose size needs base-256 encoding", async () => {
        // tar-stream switches the size field to GNU base-256 at 8 GiB, where the octal
        // field runs out. Reading that as 0 would put every following offset in the wrong
        // place - and a single VM image or uncompressed dump is enough to trigger it.
        // The header is written by hand so the test does not need 8 GiB of disk.
        const target = path.join(workDir, "huge.tar");
        // tar-stream ships no types for its header codec; the shape used here is stable.
        const headers = (await import("tar-stream/headers" as string)).default as { encode: (h: Record<string, unknown>) => Buffer };

        const hugeSize = 9 * 1024 ** 3;
        const hugeHeader = headers.encode({
            name: "huge.bin", size: hugeSize, mode: 0o644, mtime: new Date(0),
            type: "file", uid: 0, gid: 0, uname: "", gname: "",
        });
        expect(hugeHeader[124] & 0x80, "expected tar-stream to use base-256 here").not.toBe(0);

        // The payload is sparse: the file is the declared length, but only the trailing
        // member after it is real. That is enough to prove the walk lands in the right spot.
        const after = Buffer.from("AFTER");
        const handle = await fs.open(target, "w");
        await handle.write(hugeHeader, 0, hugeHeader.length, 0);
        const afterOffset = 512 + Math.ceil(hugeSize / 512) * 512;
        await handle.write(buildUstarHeader("after.txt", after.length), 0, 512, afterOffset);
        await handle.write(after, 0, after.length, afterOffset + 512);
        await handle.write(tarPadding(after.length), 0, tarPadding(after.length).length, afterOffset + 512 + after.length);
        await handle.write(TAR_TRAILER, 0, TAR_TRAILER.length, afterOffset + 512 + Math.ceil(after.length / 512) * 512);
        await handle.close();

        const members = await walkTarHeaders(target);

        expect(members.map((m) => m.name)).toEqual(["huge.bin", "after.txt"]);
        expect(members[0].size).toBe(hugeSize);
        // The decisive assertion: the member after the huge one is found where it is.
        expect(members[1].offset).toBe(afterOffset + 512);
        // Read just that range - the file is 9 GiB long (sparse), so reading it whole would fail.
        const verify = await fs.open(target, "r");
        const buf = Buffer.alloc(members[1].size);
        await verify.read(buf, 0, buf.length, members[1].offset);
        await verify.close();
        expect(buf.toString()).toBe("AFTER");
    });

    it("stops early at a named member", async () => {
        const target = await writeTar(
            [
                { name: "manifest.json", data: Buffer.from("a") },
                { name: "d/000001", data: Buffer.from("b") },
                { name: "index", data: Buffer.from("c") },
                { name: "d/000002", data: Buffer.from("d") },
            ],
            true
        );

        const located = await walkTarHeaders(target, "index");
        expect(located.map((m) => m.name)).toEqual(["manifest.json", "d/000001", "index"]);
    });

    it("returns nothing for an empty archive", async () => {
        const target = path.join(workDir, "empty.tar");
        await fs.writeFile(target, TAR_TRAILER);
        expect(await walkTarHeaders(target)).toEqual([]);
    });
});

describe("buildUstarHeader", () => {
    it("produces an archive that system tar accepts, appended after tar-stream members", async () => {
        // This is the exact sequence the archive writer uses: tar-stream writes the data
        // members, then the index member is appended by hand once its offsets are known.
        const target = await writeTar(
            [
                { name: "manifest.json", data: Buffer.from('{"version":2}') },
                { name: "d/000001", data: Buffer.from("payload-one") },
            ],
            false
        );

        const indexPayload = Buffer.from('{"k":"h","v":2}\n{"k":"f","p":"a.txt"}\n');
        await fs.appendFile(
            target,
            Buffer.concat([
                buildUstarHeader("index", indexPayload.length),
                indexPayload,
                tarPadding(indexPayload.length),
                TAR_TRAILER,
            ])
        );

        const { stdout } = await execFileAsync("tar", ["-tf", target]);
        expect(stdout.split("\n").filter(Boolean)).toEqual(["manifest.json", "d/000001", "index"]);

        const extractDir = path.join(workDir, "out");
        await fs.mkdir(extractDir);
        await execFileAsync("tar", ["-xf", target, "-C", extractDir]);
        expect(await fs.readFile(path.join(extractDir, "index"))).toEqual(indexPayload);
        expect(await fs.readFile(path.join(extractDir, "d", "000001"), "utf-8")).toBe("payload-one");

        // And our own walker agrees with system tar about where the index payload starts.
        const located = await walkTarHeaders(target, "index");
        const raw = await fs.readFile(target);
        const found = located.find((m) => m.name === "index")!;
        expect(raw.subarray(found.offset, found.offset + found.size)).toEqual(indexPayload);
    });

    it("rejects names that would need a PAX extension", () => {
        expect(() => buildUstarHeader("y".repeat(101), 10)).toThrow(/PAX/);
    });

    it("pads payloads to a block boundary", () => {
        expect(tarPadding(0)).toHaveLength(0);
        expect(tarPadding(512)).toHaveLength(0);
        expect(tarPadding(1)).toHaveLength(511);
        expect(tarPadding(513)).toHaveLength(511);
    });
});
