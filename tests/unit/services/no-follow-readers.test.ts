// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import type { StorageAdapter } from "@/lib/core/interfaces";

/**
 * The readers of a file a storage downloaded open it without following a link. The server of a
 * connection may belong to a customer, and a transfer that recreates what it holds would otherwise
 * lay a link to a file of the DBackup server where the reader looks next, see `downloaded-file.ts`.
 */

const mocks = vi.hoisted(() => ({ tempDir: "", adapter: null as StorageAdapter | null }));

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => mocks.tempDir }));
vi.mock("@/services/sharing/destination-access", () => ({
    openDestination: async () => ({ adapter: mocks.adapter, config: {} }),
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { readSidecarText } from "@/lib/adapters/storage/common/read-sidecar";
import { legacyStreamVerifier } from "@/services/restore/smart-recovery";
import { archiveIndexService } from "@/services/backup/archive-index-service";
import { INDEX_SIDECAR_SUFFIX } from "@/lib/archive/format";

let secret: string;

beforeEach(async () => {
    mocks.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "no-follow-readers-"));
    secret = path.join(mocks.tempDir, "secret-of-the-server");
});

afterEach(async () => {
    await fs.rm(mocks.tempDir, { recursive: true, force: true });
});

/** An adapter without `read()` whose download lays a link to `target` instead of a file. */
function linkingAdapter(target: string): StorageAdapter {
    return {
        id: "linking", type: "storage", name: "Linking", configSchema: {} as never,
        upload: vi.fn(), list: vi.fn(), delete: vi.fn(), test: vi.fn(),
        download: async (_config: unknown, _remote: string, local: string) => {
            await fs.symlink(target, local);
            return true;
        },
    } as unknown as StorageAdapter;
}

describe("a reader of a downloaded file", () => {
    it("reads no sidecar through a link the download left", async () => {
        await fs.writeFile(secret, JSON.stringify({ jobName: "a file of the DBackup server" }));

        const read = readSidecarText(linkingAdapter(secret), {}, "Job/backup.sql.meta.json");

        await expect(read).rejects.toThrow();
        await expect(fs.readFile(secret, "utf-8")).resolves.toContain("DBackup server");
        expect((await fs.readdir(mocks.tempDir)).filter((name) => name.startsWith("sidecar-"))).toEqual([]);
    });

    it("reads no index sidecar through a link the download left", async () => {
        await fs.writeFile(secret, "a file of the DBackup server");
        mocks.adapter = linkingAdapter(secret);

        expect(await archiveIndexService.fetchSidecar("dest", "Job/backup.tar", INDEX_SIDECAR_SUFFIX)).toBeNull();
    });

    it("tests no key of the vault against a file of the server a link points at", async () => {
        // A backup encrypted with the key, which the verifier accepts when it lies there itself.
        const key = crypto.randomBytes(32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const encrypted = Buffer.concat([cipher.update(Buffer.from("CREATE TABLE t (id int);\n".repeat(80))), cipher.final()]);
        const meta = { iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex") };
        const real = path.join(mocks.tempDir, "backup.sql.enc");
        await fs.writeFile(real, encrypted);
        expect(await legacyStreamVerifier(meta, real, undefined)(key)).toBe(true);

        const link = path.join(mocks.tempDir, "download.enc");
        await fs.symlink(real, link);

        expect(await legacyStreamVerifier(meta, link, undefined)(key)).toBe(false);
    });
});
