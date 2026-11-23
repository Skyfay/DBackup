/**
 * The routes under `/api/storage/[id]` act on the backups of a destination: list, download, delete,
 * lock, verify and analyze them. A directory source is a storage connection too, holding the files
 * of a customer and no backups, so those routes never reach one by its id. Only the target of a
 * restore of files, which writes back into a source, and its check of the folder take one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/logging/errors";

const ROWS: Record<string, { id: string; tenantId: string; type: string; storageRole: string; adapterId: string; name: string }> = {
    "nas-backups": { id: "nas-backups", tenantId: "acme", type: "storage", storageRole: "DESTINATION", adapterId: "sftp", name: "NAS backups" },
    "nas-photos": { id: "nas-photos", tenantId: "acme", type: "storage", storageRole: "SOURCE", adapterId: "sftp", name: "NAS photos" },
    "shop-db": { id: "shop-db", tenantId: "acme", type: "database", storageRole: "DESTINATION", adapterId: "mysql", name: "Shop DB" },
};

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    delete: vi.fn(),
    resolve: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: { findUnique: async ({ where }: { where: { id: string } }) => ROWS[where.id] ?? null },
        connectionShare: { count: async () => 0 },
    },
}));
vi.mock("@/lib/tenant/current", () => ({ currentTenantId: async () => "acme" }));
vi.mock("@/services/sharing/provided", () => ({ providedConnection: async () => null }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({
    registry: { get: (id: string) => ({ id, type: "storage", list: mocks.list, delete: mocks.delete, upload: vi.fn(), download: vi.fn() }) },
}));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: (...args: unknown[]) => mocks.resolve(...args) }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

const { findDestination, openDestination, ANY_STORAGE_ROLE } = await import("@/services/sharing/destination-access");
const { openStorage } = await import("@/services/storage/storage-lookup");
const { findRestoreTarget } = await import("@/services/restore/restore-target");
const { checkRestorePath } = await import("@/services/storage/restore-path-check");
const { storageService } = await import("@/services/storage/storage-service");

beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({ host: "nas.example.ch" });
    mocks.list.mockResolvedValue([{ name: "2026.jpg", path: "photos/2026.jpg", size: 1, lastModified: new Date() }]);
});

describe("the backups of a destination by its id", () => {
    it("never reach a directory source, which reads like a storage that does not exist", async () => {
        await expect(findDestination("nas-photos")).rejects.toBeInstanceOf(NotFoundError);
        await expect(openDestination("nas-photos")).rejects.toBeInstanceOf(NotFoundError);
        await expect(openStorage("nas-photos")).rejects.toBeInstanceOf(NotFoundError);
        expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it("delete nothing on a directory source, the storage is never opened", async () => {
        await expect(storageService.deleteFile("nas-photos", "photos/2026.jpg")).rejects.toBeInstanceOf(NotFoundError);
        await expect(storageService.setLocked("nas-photos", "photos/2026.jpg", true)).rejects.toBeInstanceOf(NotFoundError);
        expect(mocks.resolve).not.toHaveBeenCalled();
        expect(mocks.delete).not.toHaveBeenCalled();
    });

    it("still reach a destination", async () => {
        expect((await findDestination("nas-backups")).row.id).toBe("nas-backups");
        await expect(openStorage("nas-backups")).resolves.toMatchObject({ config: { host: "nas.example.ch" } });
    });

    it("never reach a connection of another kind, whatever role the lookup takes", async () => {
        await expect(findDestination("shop-db", undefined, { roles: ANY_STORAGE_ROLE })).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe("the target of a restore of files", () => {
    it("is a directory source as well, where files go back to", async () => {
        expect((await findRestoreTarget("nas-photos")).row.id).toBe("nas-photos");
        expect((await findRestoreTarget("nas-backups")).row.id).toBe("nas-backups");
    });

    it("has its folder checked on a directory source too", async () => {
        expect(await checkRestorePath("nas-photos", "photos")).toEqual({ status: "occupied", itemCount: 1 });
        expect(mocks.list).toHaveBeenCalledWith({ host: "nas.example.ch" }, "photos");
    });
});
