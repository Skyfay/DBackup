// @vitest-environment node
/**
 * Deleting the backups of a customer on a shared destination, by a stop or by Delete its backups
 * here, leaves no empty folders behind under `tenants/<id>/` where the adapter deletes an empty
 * folder, and leaves them where it cannot, without failing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { storageView, type StorageViewMode } from "@/lib/tenant/storage-view";
import type { FileInfo, StorageAdapter } from "@/lib/core/interfaces";

/** The files and folders of the destination, by their path from its root. */
const storage = vi.hoisted(() => ({
    files: new Set<string>(),
    folders: new Set<string>(),
    foldersDeletable: true,
    folderFailure: null as Error | null,
    removed: [] as string[],
}));

vi.mock("@/services/notifications/tenant-notification-settings", () => ({ getTenantNotificationConfig: vi.fn(), saveTenantNotificationConfig: vi.fn() }));
vi.mock("@/services/sharing/destination-access", () => {
    const adapter = (): StorageAdapter => ({
        id: "memory",
        type: "storage",
        name: "Memory",
        list: async (_config: unknown, dir: string): Promise<FileInfo[]> =>
            [...storage.files]
                .filter((file) => !dir || file.startsWith(`${dir}/`))
                .map((file) => ({ name: file.split("/").at(-1)!, path: file, size: 1, lastModified: new Date() })),
        delete: async (_config: unknown, file: string) => storage.files.delete(file),
        ...(storage.foldersDeletable
            ? {
                deleteEmptyFolder: async (_config: unknown, folder: string) => {
                    if (storage.folderFailure) throw storage.folderFailure;
                    const inside = (entry: string) => entry.startsWith(`${folder}/`);
                    if ([...storage.files].some(inside) || [...storage.folders].some(inside) || !storage.folders.has(folder)) return false;
                    storage.folders.delete(folder);
                    storage.removed.push(folder);
                    return true;
                },
            }
            : {}),
    }) as unknown as StorageAdapter;
    return { openRow: async (_row: unknown, mode: StorageViewMode) => ({ adapter: storageView(adapter(), mode), config: {} }) };
});

const { deleteTenantBackups, foldersOf, sweepCustomerFolder } = await import("@/services/sharing/share-cleanup");

/** Puts files on the destination with every folder they lie in. */
function lay(...files: string[]) {
    for (const file of files) {
        storage.files.add(file);
        const parts = file.split("/");
        for (let depth = 1; depth < parts.length; depth++) storage.folders.add(parts.slice(0, depth).join("/"));
    }
}

describe("removing a folder through the view of a tenant", () => {
    const remove = vi.fn(async () => true);
    const plain = { id: "memory", type: "storage", name: "Memory", list: vi.fn(), delete: vi.fn(), upload: vi.fn(), download: vi.fn(), deleteEmptyFolder: remove } as unknown as StorageAdapter;

    beforeEach(() => remove.mockClear());

    it("puts a customer's folder under its own, its root being its own folder", async () => {
        const view = storageView(plain, { kind: "customer", tenantId: "acme" });
        await view.deleteEmptyFolder!({}, "Shop");
        await view.deleteEmptyFolder!({}, "");
        expect(remove.mock.calls).toEqual([[{}, "tenants/acme/Shop"], [{}, "tenants/acme"]]);
        await expect(Promise.resolve().then(() => view.deleteEmptyFolder!({}, "../globex"))).rejects.toThrow("leaves its folder");
    });

    it("never removes the root of the destination or the folder of the customers for the tenant that shares it", async () => {
        const view = storageView(plain, { kind: "provider" });
        await expect(Promise.resolve().then(() => view.deleteEmptyFolder!({}, ""))).rejects.toThrow("root of a destination");
        await expect(Promise.resolve().then(() => view.deleteEmptyFolder!({}, "tenants/acme"))).rejects.toThrow("tenants/");
        expect(remove).not.toHaveBeenCalled();
    });
});

describe("the folders a customer's backups leave behind", () => {
    beforeEach(() => {
        storage.files.clear();
        storage.folders.clear();
        storage.removed = [];
        storage.foldersDeletable = true;
        storage.folderFailure = null;
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ id: "nas", type: "storage", adapterId: "memory", tenantId: "msp" } as never);
        lay(
            "tenants/acme/Shop/shop_1.tar",
            "tenants/acme/Shop/shop_1.tar.meta.json",
            "tenants/acme/CRM/2026/crm_1.tar",
            "tenants/globex/Web/web_1.tar",
            "MSP/own.tar",
        );
    });

    it("lists the folders of files the deepest first", () => {
        expect(foldersOf([{ path: "a/b/c/file" }, { path: "a/x/file" }, { path: "top" }])).toEqual(["a/b/c", "a/b", "a/x", "a"]);
    });

    it("removes the folders of a customer once its backups are deleted, its own folder too, and nothing of another tenant", async () => {
        expect(await deleteTenantBackups("nas", "acme")).toBe(2);

        expect([...storage.folders].sort()).toEqual(["MSP", "tenants", "tenants/globex", "tenants/globex/Web"]);
        expect(storage.removed).toEqual(["tenants/acme/CRM/2026", "tenants/acme/Shop", "tenants/acme/CRM", "tenants/acme"]);
        expect([...storage.files].sort()).toEqual(["MSP/own.tar", "tenants/globex/Web/web_1.tar"]);
    });

    it("keeps a folder that still holds something", async () => {
        // A folder no listing names, like one a job of the customer made right now.
        storage.folders.add("tenants/acme/Shop/new");

        await deleteTenantBackups("nas", "acme");

        expect(storage.folders.has("tenants/acme/CRM")).toBe(false);
        expect(storage.folders.has("tenants/acme/Shop")).toBe(true);
        expect(storage.folders.has("tenants/acme")).toBe(true);
    });

    it("leaves the folders where the adapter deletes none, and where the storage fails at it, without failing the delete", async () => {
        storage.foldersDeletable = false;
        await expect(deleteTenantBackups("nas", "acme")).resolves.toBe(2);
        expect(storage.folders.has("tenants/acme/Shop")).toBe(true);

        storage.foldersDeletable = true;
        storage.folderFailure = new Error("connect ECONNREFUSED 10.0.0.7:22");
        lay("tenants/acme/Shop/shop_2.tar");
        await expect(deleteTenantBackups("nas", "acme")).resolves.toBe(1);
        expect(storage.files.has("tenants/acme/Shop/shop_2.tar")).toBe(false);
    });

    it("removes the folder of every customer and tenants/ itself once nobody gets the destination", async () => {
        expect(await sweepCustomerFolder("nas")).toBe(4);

        expect([...storage.folders]).toEqual(["MSP"]);
        expect(storage.removed.at(-1)).toBe("tenants");
    });
});
