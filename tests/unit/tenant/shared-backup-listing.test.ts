/**
 * The backups of a shared server come from the cached listings of its destinations, and a customer
 * restores one with the login of the provider.
 *
 * A cached listing of an older version holds rows read from the storage without the start of their
 * dumps, which would hand a dump of the previous holder's time to the next one. Such a listing
 * counts for nobody until it is rebuilt.
 *
 * A sidecar at the destination names the server, and whoever writes the storage outside DBackup
 * could lay an archive with such a sidecar there. So a backup counts only with a proof that DBackup
 * made it: a run of the server's tenant that wrote the path, or for an encrypted backup the seal of
 * its key, which the read checks, see shared-copy-proof.test.ts.
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
function run(destinations: { configId: string; path: string; status: string }[], extra: Record<string, unknown> = {}) {
    return {
        path: "Nightly/crm.tar",
        startedAt: new Date("2026-11-02T01:00:00.000Z"),
        endedAt: new Date("2026-11-02T01:30:00.000Z"),
        metadata: JSON.stringify({ destinations, dumpsStartedAt: "2026-11-02T01:05:00.000Z", ...extra }),
    };
}

const listing = (...files: object[]) => mocks.readCachedListing.mockResolvedValue({ files, listedAt: new Date(), current: true });

describe("the backups of a shared server from the cached listings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.runs.mockResolvedValue([run([{ configId: "nas", path: "/Nightly/crm.tar", status: "success" }], { indexSha256: "digest-a" })]);
    });

    it("reads a current listing, with the dump start of the run", async () => {
        listing(ROW);
        const files = await serverBackupFiles("srv-1");
        expect(files).toHaveLength(1);
        expect(files[0]).toMatchObject({ file: { createdAt: ROW.createdAt, dumpsStartedAt: "2026-11-02T01:05:00.000Z" }, proof: { kind: "recorded", digests: ["digest-a"] } });
    });

    it("gives nobody a backup from a listing cached before the dump start was kept", async () => {
        mocks.readCachedListing.mockResolvedValue({ files: [ROW], listedAt: new Date(), current: false });
        expect(await serverBackupFiles("srv-1")).toEqual([]);
    });

    it("leaves out a plain backup no run wrote, whatever its sidecar says", async () => {
        listing(ROW, LAID);
        const files = await serverBackupFiles("srv-1");
        expect(files.map(({ file }) => file.path)).toEqual(["Nightly/crm.tar"]);
    });

    it("keeps an encrypted backup no run wrote, for the read to check its seal", async () => {
        listing({ ...LAID, isEncrypted: true });
        const files = await serverBackupFiles("srv-1");
        expect(files).toEqual([expect.objectContaining({ proof: { kind: "sealed" } })]);
    });

    it("asks the runs of the server's tenant alone", async () => {
        listing(ROW);
        await serverBackupFiles("srv-1");
        expect(mocks.runs).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "default", type: "Backup" }) }));
    });

    it("keeps a plain backup moved to another storage by the digest of its run, and leaves it out without one", async () => {
        listing(ROW);
        mocks.runs.mockResolvedValue([run([{ configId: "old-nas", path: "Nightly/crm.tar", status: "success" }], { indexSha256: "digest-a" })]);
        expect(await serverBackupFiles("srv-1")).toEqual([expect.objectContaining({ proof: { kind: "recorded", digests: ["digest-a"] } })]);

        mocks.runs.mockResolvedValue([run([{ configId: "old-nas", path: "Nightly/crm.tar", status: "success" }])]);
        expect(await serverBackupFiles("srv-1")).toEqual([]);
    });

    it("counts no upload that failed", async () => {
        listing(ROW);
        mocks.runs.mockResolvedValue([run([{ configId: "nas", path: "Nightly/crm.tar", status: "failed" }], { indexSha256: "digest-a" })]);
        expect(await serverBackupFiles("srv-1")).toEqual([]);
    });
});
