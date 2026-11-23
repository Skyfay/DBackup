// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { wasRewritten } from "@/services/storage/listing-changes";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { mockOpenDestination, mockReadListedSidecars } = vi.hoisted(() => ({
    mockOpenDestination: vi.fn(),
    mockReadListedSidecars: vi.fn(),
}));

vi.mock("@/services/sharing/destination-access", () => ({
    findDestination: vi.fn(),
    openRow: vi.fn(),
    openDestination: (...args: unknown[]) => mockOpenDestination(...args),
}));

vi.mock("@/services/storage/listed-sidecars", () => ({
    readListedSidecars: (...args: unknown[]) => mockReadListedSidecars(...args),
}));

const { storageService, CACHE_SCHEMA_VERSION } = await import("@/services/storage/storage-service");

type Internals = {
    listingTenant: (id: string, tenantId?: string) => Promise<string>;
    loadCurrentCache: (id: string, tenantId: string) => Promise<unknown>;
    mutateStorageListCache: (id: string, change: (files: { path: string }[]) => unknown, tenantId?: string) => Promise<void>;
    readListingRow: (id: string, tenantId: string) => Promise<{ filesJson: string } | null>;
    writeListingRow: (id: string, tenantId: string, data: { filesJson?: string; cachedAt: Date }) => Promise<unknown>;
    runReconcile: (id: string, tenantId: string) => Promise<void>;
};
const service = storageService as unknown as Internals;

const PATH = "mysql/clienti/mysql_clienti.tar";
const FIRST_RUN = "2026-10-22T11:52:00.000Z";
const SECOND_RUN = "2026-10-22T11:57:00.000Z";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("a backup written again at the same path", () => {
    const listingStartedAt = Date.parse("2026-10-22T12:00:00.000Z");

    it("counts as written again when its size changed or the storage dates it later", () => {
        expect(wasRewritten({ size: 100, lastModified: FIRST_RUN }, { size: 120, lastModified: FIRST_RUN }, listingStartedAt)).toBe(true);
        expect(wasRewritten({ size: 100, lastModified: FIRST_RUN }, { size: 100, lastModified: new Date(SECOND_RUN) }, listingStartedAt)).toBe(true);
    });

    it("stays the same backup when nothing about it changed", () => {
        expect(wasRewritten({ size: 100, lastModified: FIRST_RUN }, { size: 100, lastModified: new Date(FIRST_RUN) }, listingStartedAt)).toBe(false);
    });

    it("ignores a time the listing put on a file whose server names none", () => {
        // Some adapters date such a file with the time of the listing, which comes after its start.
        expect(wasRewritten({ size: 100, lastModified: FIRST_RUN }, { size: 100, lastModified: new Date(listingStartedAt + 50) }, listingStartedAt)).toBe(false);
        expect(wasRewritten({ size: 100, lastModified: FIRST_RUN }, { size: 100, lastModified: "not a date" }, listingStartedAt)).toBe(false);
    });

    it("leaves the row a run cached after its upload alone, which carries a time after the storage's own", () => {
        expect(wasRewritten({ size: 100, lastModified: "2026-10-22T11:57:03.000Z" }, { size: 100, lastModified: new Date(SECOND_RUN) }, listingStartedAt)).toBe(false);
    });
});

describe("the row a run adds to the listing of its destination (#201)", () => {
    it("replaces the row of the backup it overwrote instead of keeping the old one", async () => {
        vi.spyOn(service, "listingTenant").mockResolvedValue("default");
        vi.spyOn(service, "loadCurrentCache").mockResolvedValue({ files: [], v: CACHE_SCHEMA_VERSION });
        const mutate = vi.spyOn(service, "mutateStorageListCache").mockResolvedValue();
        const second = { name: "mysql_clienti.tar", path: PATH, size: 120, lastModified: new Date(SECOND_RUN), createdAt: SECOND_RUN } as never;

        await storageService.appendStorageListCacheEntry("wasabi", second);

        const change = mutate.mock.calls[0][1];
        const first = { name: "mysql_clienti.tar", path: PATH, size: 100, createdAt: FIRST_RUN, verification: { passed: true } };
        const other = { name: "other.tar", path: "other/other.tar", size: 5 };
        expect(change([first, other])).toEqual([other, second]);
    });
});

describe("the reconciliation of a listing", () => {
    const cachedRow = { name: "mysql_clienti.tar", path: PATH, size: 100, lastModified: FIRST_RUN, createdAt: FIRST_RUN, jobName: "clienti" };

    beforeEach(() => {
        prismaMock.job.findMany.mockResolvedValue([]);
        prismaMock.execution.findMany.mockResolvedValue([]);
        vi.spyOn(service, "readListingRow").mockResolvedValue({ filesJson: JSON.stringify({ v: CACHE_SCHEMA_VERSION, files: [cachedRow] }) });
    });

    function destinationListing(backup: { size: number; lastModified: Date }) {
        mockOpenDestination.mockResolvedValue({
            adapter: {
                list: vi.fn().mockResolvedValue([
                    { name: "mysql_clienti.tar", path: PATH, ...backup },
                    { name: "mysql_clienti.tar.meta.json", path: `${PATH}.meta.json`, size: 900, lastModified: backup.lastModified },
                ]),
            },
            config: {},
        });
    }

    it("reads the sidecar of a backup overwritten at the same path again, so the row shows the new run", async () => {
        destinationListing({ size: 120, lastModified: new Date(SECOND_RUN) });
        mockReadListedSidecars.mockResolvedValue(new Map([[PATH, { timestamp: SECOND_RUN, jobName: "clienti" }]]));
        const write = vi.spyOn(service, "writeListingRow").mockResolvedValue(undefined);

        await service.runReconcile("wasabi", "default");

        expect(mockReadListedSidecars.mock.calls[0][2].map((file: { path: string }) => file.path)).toEqual([`${PATH}.meta.json`]);
        const files = JSON.parse(write.mock.calls[0][2].filesJson!).files;
        expect(files).toHaveLength(1);
        expect(files[0]).toMatchObject({ path: PATH, size: 120, createdAt: SECOND_RUN });
    });

    it("reads no sidecar when the backup at the path is still the cached one", async () => {
        destinationListing({ size: 100, lastModified: new Date(FIRST_RUN) });
        const write = vi.spyOn(service, "writeListingRow").mockResolvedValue(undefined);

        await service.runReconcile("wasabi", "default");

        expect(mockReadListedSidecars).not.toHaveBeenCalled();
        expect(write.mock.calls[0][2].filesJson).toBeUndefined();
    });
});
