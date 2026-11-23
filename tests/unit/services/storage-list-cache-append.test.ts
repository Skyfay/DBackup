// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { storageService } = await import("@/services/storage/storage-service");

type Internals = {
    listingTenant: (id: string, tenantId?: string) => Promise<string>;
    loadCurrentCache: (id: string, tenantId: string) => Promise<unknown>;
    refreshInBackground: (id: string, tenantId: string, mode: string) => boolean;
    mutateStorageListCache: (...args: unknown[]) => Promise<void>;
};
const service = storageService as unknown as Internals;
const entry = { name: "shop.tar", path: "nightly/shop.tar", size: 10, lastModified: new Date() } as never;

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the backup a run adds to the listing of its destination", () => {
    it("lists a destination that was never listed in the background, so customers of a shared server see the backup at once", async () => {
        vi.spyOn(service, "listingTenant").mockResolvedValue("default");
        vi.spyOn(service, "loadCurrentCache").mockResolvedValue(null);
        const refresh = vi.spyOn(service, "refreshInBackground").mockReturnValue(true);
        const mutate = vi.spyOn(service, "mutateStorageListCache").mockResolvedValue();

        await storageService.appendStorageListCacheEntry("nas", entry);

        expect(refresh).toHaveBeenCalledWith("nas", "default", "rebuild");
        expect(mutate).not.toHaveBeenCalled();
    });

    it("is added to a listing that exists, without listing the destination again", async () => {
        vi.spyOn(service, "listingTenant").mockResolvedValue("default");
        vi.spyOn(service, "loadCurrentCache").mockResolvedValue({ files: [], v: 2 });
        const refresh = vi.spyOn(service, "refreshInBackground").mockReturnValue(true);
        const mutate = vi.spyOn(service, "mutateStorageListCache").mockResolvedValue();

        await storageService.appendStorageListCacheEntry("nas", entry);

        expect(mutate).toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });
});
