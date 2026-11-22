// @vitest-environment node
/**
 * While no account exists, anyone may upload a configuration backup to the setup restore. gzip packs
 * a long run of the same byte a thousand times over, so what an upload unpacks to is bounded, and
 * the setup holds one checked backup at a time instead of one per upload for half an hour.
 */
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { byteLimit } from "@/services/config/open-backup";
import { holdRestore, peekRestore } from "@/services/config/pending-restores";

let dir = "";

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "config-upload-limits-"));
});

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

/** How many bytes a pipeline through the limit let through before it ended. */
async function passedThrough(total: number, max: number): Promise<{ written: number; error: unknown }> {
    let written = 0;
    const sink = new Writable({ write(chunk: Buffer, _encoding, done) { written += chunk.length; done(); } });
    const source = Readable.from((function* () {
        for (let sent = 0; sent < total; sent += 1024) yield Buffer.alloc(Math.min(1024, total - sent));
    })());
    const error = await pipeline(source, byteLimit(max), sink).then(() => null, (failure: unknown) => failure);
    return { written, error };
}

describe("what an uploaded configuration backup unpacks to", () => {
    it("passes a file below the bound as it is", async () => {
        expect(await passedThrough(10_000, 20_000)).toEqual({ written: 10_000, error: null });
    });

    it("fails a file past the bound before more than the bound is written", async () => {
        const { written, error } = await passedThrough(50_000, 20_000);

        expect(error).toBeInstanceOf(Error);
        expect(written).toBeLessThanOrEqual(20_000);
    });
});

describe("the backups the setup holds", () => {
    it("are one at a time, the file of the one before removed", async () => {
        const first = path.join(dir, "first.db");
        const second = path.join(dir, "second.db");
        await fs.writeFile(first, "a");
        await fs.writeFile(second, "b");
        const entry = (file: string) => ({ file, fileName: path.basename(file), preview: {} as never, keys: null, owner: "setup" as const });

        const firstToken = await holdRestore(entry(first));
        const secondToken = await holdRestore(entry(second));

        expect(await peekRestore(firstToken, "setup")).toBeNull();
        expect(await peekRestore(secondToken, "setup")).not.toBeNull();
        await expect(fs.stat(first)).rejects.toThrow();
        await expect(fs.stat(second)).resolves.toBeDefined();
    });
});
