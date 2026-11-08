// @vitest-environment node
/**
 * The integrity check and the post-upload verification write a result into the `.meta.json` of the
 * copy they checked, never into the sidecar of a configuration backup, which keeps no checksum, and
 * never download one.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ open: vi.fn(), tmp: "" }));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/sharing/destination-access", () => ({ openDestination: (...args: unknown[]) => mocks.open(...args) }));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => mocks.tmp }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { updateStorageListCacheEntry: vi.fn().mockResolvedValue(undefined) } }));

const { verificationService } = await import("@/services/storage/verification-service");

mocks.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-bg-"));
afterAll(() => fs.rmSync(mocks.tmp, { recursive: true, force: true }));

/** A destination whose sidecars live in memory and whose upload reads the local file when called. */
function destination(sidecars: Record<string, string>) {
    const uploads: Record<string, string> = {};
    const adapter = {
        id: "local-filesystem",
        read: vi.fn(async (_config: unknown, file: string) => sidecars[file] ?? null),
        download: vi.fn(async () => false),
        verifyChecksum: vi.fn(async () => "passed" as const),
        upload: vi.fn(async (_config: unknown, local: string, remote: string) => {
            uploads[remote] = fs.readFileSync(local, "utf-8");
            return true;
        }),
    };
    return { adapter, uploads };
}

beforeEach(() => vi.clearAllMocks());

describe("a check of a configuration backup", () => {
    it("writes nothing beside it, since its metadata keeps no checksum", async () => {
        const meta = JSON.stringify({ sourceType: "SYSTEM", kind: "database", encryption: { enabled: true } });
        const { adapter, uploads } = destination({ "config-backups/config_backup_1.db.gz.enc.meta.json": meta });
        mocks.open.mockResolvedValue({ adapter, config: {} });

        const result = await verificationService.verifyFile("nas", "config-backups/config_backup_1.db.gz.enc", "scheduled");

        expect(result.status).toBe("no_checksum");
        expect(adapter.upload).not.toHaveBeenCalled();
        expect(adapter.download).not.toHaveBeenCalled();
        expect(uploads).toEqual({});
    });
});
