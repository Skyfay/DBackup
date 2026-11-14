/**
 * A cached listing of an older version holds rows read from the storage without the start of their
 * dumps, which would hand a dump of the previous holder's time to the next one. Such a listing
 * counts for nobody until it is rebuilt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readCachedListing: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: {
            findFirst: vi.fn().mockResolvedValue({ tenantId: "default" }),
            findMany: vi.fn().mockResolvedValue([{ id: "nas" }]),
        },
        sharedServer: { findUnique: vi.fn() },
    },
}));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: (...args: unknown[]) => mocks.readCachedListing(...args) } }));
vi.mock("@/services/sharing/provided", () => ({ providedTo: vi.fn().mockResolvedValue([]) }));

const { serverBackupFiles } = await import("@/services/tenant/shared-backups");

const ROW = { name: "crm.tar", path: "Nightly/crm.tar", size: 1, lastModified: new Date(), createdAt: "2026-11-02T01:20:00.000Z", databases: ["crm"], sourceId: "srv-1", hasFileIndex: true };

describe("the backups of a shared server from the cached listings", () => {
    beforeEach(() => vi.clearAllMocks());

    it("reads a current listing", async () => {
        mocks.readCachedListing.mockResolvedValue({ files: [ROW], listedAt: new Date(), current: true });
        expect(await serverBackupFiles("srv-1")).toHaveLength(1);
    });

    it("gives nobody a backup from a listing cached before the dump start was kept", async () => {
        mocks.readCachedListing.mockResolvedValue({ files: [ROW], listedAt: new Date(), current: false });
        expect(await serverBackupFiles("srv-1")).toEqual([]);
    });
});
