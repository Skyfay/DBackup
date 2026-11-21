/**
 * The backups of a shared server come from the cached listings of its destinations, and a customer
 * restores one with the login of the provider.
 *
 * A cached listing of an older version holds rows read from the storage without the start of their
 * dumps, which would hand a dump of the previous holder's time to the next one. Such a listing
 * counts for nobody until it is rebuilt.
 *
 * A sidecar at the destination names the server, and whoever writes the storage outside DBackup
 * could lay an archive with such a sidecar there. So a backup counts only where a backup run of the
 * server's tenant recorded that it wrote that path to that destination.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readCachedListing: vi.fn(), runs: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: {
            findFirst: vi.fn().mockResolvedValue({ tenantId: "default" }),
            findMany: vi.fn().mockResolvedValue([{ id: "nas" }]),
        },
        sharedServer: { findUnique: vi.fn() },
        execution: { findMany: (...args: unknown[]) => mocks.runs(...args) },
    },
}));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: (...args: unknown[]) => mocks.readCachedListing(...args) } }));
vi.mock("@/services/sharing/provided", () => ({ providedTo: vi.fn().mockResolvedValue([]) }));

const { serverBackupFiles } = await import("@/services/tenant/shared-backups");

const ROW = { name: "crm.tar", path: "Nightly/crm.tar", size: 1, lastModified: new Date(), createdAt: "2026-11-02T01:20:00.000Z", databases: ["crm"], sourceId: "srv-1", hasFileIndex: true };
const LAID = { ...ROW, name: "laid.tar", path: "Nightly/laid.tar" };

/** A run as `04-completion.ts` records it, with the copy it uploaded to each destination. */
function run(destinations: { configId: string; path: string; status: string }[]) {
    return { metadata: JSON.stringify({ destinations }) };
}

describe("the backups of a shared server from the cached listings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.runs.mockResolvedValue([run([{ configId: "nas", path: "/Nightly/crm.tar", status: "success" }])]);
    });

    it("reads a current listing", async () => {
        mocks.readCachedListing.mockResolvedValue({ files: [ROW], listedAt: new Date(), current: true });
        expect(await serverBackupFiles("srv-1")).toHaveLength(1);
    });

    it("gives nobody a backup from a listing cached before the dump start was kept", async () => {
        mocks.readCachedListing.mockResolvedValue({ files: [ROW], listedAt: new Date(), current: false });
        expect(await serverBackupFiles("srv-1")).toEqual([]);
    });

    it("leaves out a backup no run wrote, whatever its sidecar says", async () => {
        mocks.readCachedListing.mockResolvedValue({ files: [ROW, LAID], listedAt: new Date(), current: true });

        const files = await serverBackupFiles("srv-1");

        expect(files.map(({ file }) => file.path)).toEqual(["Nightly/crm.tar"]);
    });

    it("asks the runs of the server's tenant alone", async () => {
        mocks.readCachedListing.mockResolvedValue({ files: [ROW], listedAt: new Date(), current: true });

        await serverBackupFiles("srv-1");

        expect(mocks.runs).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "default", type: "Backup" }) }));
    });

    it("leaves out a backup whose run failed to upload it there, or uploaded it to another destination", async () => {
        mocks.readCachedListing.mockResolvedValue({ files: [ROW], listedAt: new Date(), current: true });
        mocks.runs.mockResolvedValue([
            run([{ configId: "nas", path: "Nightly/crm.tar", status: "failed" }]),
            run([{ configId: "s3", path: "Nightly/crm.tar", status: "success" }]),
        ]);

        expect(await serverBackupFiles("srv-1")).toEqual([]);
    });
});
