// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { writeStoreZip } from "@/lib/store-zip";

let workDir: string;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "store-zip-test-"));
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe("writeStoreZip", () => {
    it("writes an encrypted backup and its metadata into a ZIP any unzip tool reads back", async () => {
        const backup = crypto.randomBytes(300_000);
        const backupPath = path.join(workDir, "tmp_main_backup.sql.enc");
        await fs.writeFile(backupPath, backup);
        const meta = Buffer.from(JSON.stringify({ jobName: "nightly", note: "Grüße" }));
        const zipPath = path.join(workDir, "out.zip");

        await writeStoreZip(zipPath, [
            { name: "backup.sql.enc", file: backupPath },
            { name: "backup.sql.enc.meta.json", data: meta },
        ]);

        const zip = new AdmZip(zipPath);
        const entries = zip.getEntries();
        expect(entries.map((e) => e.entryName)).toEqual(["backup.sql.enc", "backup.sql.enc.meta.json"]);
        // Stored, never deflated: the backup is ciphertext and deflating it blocked the process.
        expect(entries.every((e) => e.header.method === 0)).toBe(true);
        expect(zip.readFile("backup.sql.enc")!.equals(backup)).toBe(true);
        expect(zip.readFile("backup.sql.enc.meta.json")!.equals(meta)).toBe(true);
        // Stored bytes plus the headers, nothing more.
        expect((await fs.stat(zipPath)).size).toBeLessThan(backup.length + meta.length + 512);
    });

    it("writes an empty file as an entry of its own", async () => {
        const emptyPath = path.join(workDir, "empty");
        await fs.writeFile(emptyPath, "");
        const zipPath = path.join(workDir, "out.zip");

        await writeStoreZip(zipPath, [{ name: "empty.enc", file: emptyPath }]);

        expect(new AdmZip(zipPath).readFile("empty.enc")!.length).toBe(0);
    });

    it("refuses a file that is a link, and leaves no partial ZIP behind", async () => {
        const target = path.join(workDir, "secret");
        await fs.writeFile(target, "not part of any backup");
        const link = path.join(workDir, "tmp_main_backup.enc");
        await fs.symlink(target, link);
        const zipPath = path.join(workDir, "out.zip");

        await expect(writeStoreZip(zipPath, [{ name: "backup.enc", file: link }])).rejects.toThrow();
        await expect(fs.access(zipPath)).rejects.toThrow();
    });

    it("does not hold the event loop while it writes a large file", async () => {
        const bigPath = path.join(workDir, "big.enc");
        await fs.writeFile(bigPath, crypto.randomBytes(8 * 1024 * 1024));
        const zipPath = path.join(workDir, "out.zip");

        let ticks = 0;
        const timer = setInterval(() => { ticks++; }, 0);
        try {
            await writeStoreZip(zipPath, [{ name: "big.enc", file: bigPath }]);
        } finally {
            clearInterval(timer);
        }

        // AdmZip read and wrote the file in one synchronous call, so no timer ran in between.
        expect(ticks).toBeGreaterThan(0);
    });
});
