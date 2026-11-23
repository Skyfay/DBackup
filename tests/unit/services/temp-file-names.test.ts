/**
 * A read of a backup downloads it, or its metadata, into the temporary folder of DBackup. Each read
 * gets a file of its own there, so two reads of the same backup at once, by two people or two
 * tenants, never write into or delete the file of the other.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ download: vi.fn(), analyzeDump: vi.fn() }));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => "/tmp/dbackup-test" }));
// The private folder a download of a backup goes into, see `privateTempDir`, at the same made-up place.
vi.mock("@/lib/private-temp-dir", () => ({
    privateTempPath: async (name: string) => `/tmp/dbackup-test/dbackup-private-test/${name}`,
    PRIVATE_FILE_MODE: 0o600,
}));
vi.mock("@/lib/core/registry", () => ({ registry: { get: () => ({ id: "mysql", analyzeDump: mocks.analyzeDump }) } }));
vi.mock("@/services/storage/storage-lookup", () => ({
    openStorage: async () => ({ adapter: { download: mocks.download }, config: {} }),
}));

const { analyzeBackup } = await import("@/services/storage/backup-contents");
const { storageService } = await import("@/services/storage/storage-service");

const targets = () => mocks.download.mock.calls.map((call) => String(call[2]));

describe("the temporary files of a read of a backup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.download.mockResolvedValue(true);
        mocks.analyzeDump.mockResolvedValue(["shop"]);
    });

    it("are never shared by two listings of the same backup", async () => {
        await Promise.all([analyzeBackup("nas", "jobs/shop/backup.sql", "mysql"), analyzeBackup("nas", "jobs/shop/backup.sql", "mysql")]);

        const [first, second] = targets();
        expect(first).not.toBe(second);
        expect(first).not.toBe("/tmp/dbackup-test/dbackup-private-test/backup.sql");
        expect(first.endsWith("backup.sql")).toBe(true);
    });

    it("are never shared by two reads of the metadata of the same backup", async () => {
        mocks.download.mockResolvedValue(false);
        const read = (storageService as unknown as { readBackupMetaSidecar: (adapter: unknown, config: unknown, file: string) => Promise<unknown> }).readBackupMetaSidecar.bind(storageService);
        const adapter = { download: mocks.download };

        await Promise.all([read(adapter, {}, "jobs/shop/backup.tar"), read(adapter, {}, "jobs/shop/backup.tar")]);

        const [first, second] = targets();
        expect(first).not.toBe(second);
    });
});
