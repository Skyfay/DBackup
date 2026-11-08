// @vitest-environment node
/**
 * Where the backups of a customer go on a destination another tenant shares, and what each tenant
 * reaches there by a path it sends: a job of a customer writes under its own folder whatever its
 * name, a customer reads and deletes nothing outside it, and the tenant that shares it reaches none
 * of its customers' folders. The storage is a map in memory with paths from its root.
 */
import { describe, expect, it, vi } from "vitest";
import { storageView, tenantFolder, type StorageViewMode } from "@/lib/tenant/storage-view";
import { isConfigBackupPath } from "@/lib/core/config-backup-path";
import type { FileInfo, StorageAdapter } from "@/lib/core/interfaces";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function memoryStorage(initial: string[]) {
    const files = new Set(initial);
    const uploads: string[] = [];
    const adapter = {
        id: "memory",
        type: "storage",
        name: "Memory",
        upload: async (_config: unknown, _local: string, remote: string) => { uploads.push(remote); files.add(remote); return true; },
        download: async (_config: unknown, remote: string) => files.has(remote),
        list: async (_config: unknown, dir: string): Promise<FileInfo[]> =>
            [...files].filter((file) => !dir || file.startsWith(`${dir}/`))
                .map((file) => ({ name: file.split("/").at(-1)!, path: file, size: 1, lastModified: new Date() })),
        delete: async (_config: unknown, remote: string) => files.delete(remote),
    } as unknown as StorageAdapter;
    return { files, uploads, adapter };
}

/** A call of the view as a promise, so a path it refuses before it asks the storage rejects too. */
const attempt = async <T>(call: () => Promise<T>): Promise<T> => call();

const customer: StorageViewMode ={ kind: "customer", tenantId: "globex" };
const provider: StorageViewMode = { kind: "provider" };
const stored = ["acme-job/a.tar", "tenants/globex/shop/b.tar", "tenants/initech/shop/c.tar", "config-backups/config_backup_1.db.gz.enc"];

describe("a job of a customer on a shared destination", () => {
    it("writes under its own folder whatever its name, or not at all", async () => {
        const names = ["shop", "/etc", "tenants", "tenants/initech", "Tenants./initech", "a\\b", "./x", "config-backups"];
        for (const name of names) {
            const { uploads, adapter } = memoryStorage([]);
            await storageView(adapter, customer).upload({} as never, "/tmp/x", `${name}/run.tar`);
            expect(uploads).toHaveLength(1);
            expect(uploads[0].startsWith(`${tenantFolder("globex")}/`)).toBe(true);
        }
    });

    it("writes nothing for a name that would leave its folder", async () => {
        for (const name of ["..", "../initech", "x/../../initech", "..\\initech", ".. ", "...", " . ."]) {
            const { uploads, adapter } = memoryStorage([]);
            await expect(attempt(() => storageView(adapter, customer).upload({} as never, "/tmp/x", `${name}/run.tar`))).rejects.toThrow("leaves its folder");
            expect(uploads).toEqual([]);
        }
    });
});

describe("what a customer reaches by a path it sends", () => {
    it("lists its own backups alone, with paths of its folder", async () => {
        const { adapter } = memoryStorage(stored);
        const listed = await storageView(adapter, customer).list({} as never, "");
        expect(listed.map((file) => file.path)).toEqual(["shop/b.tar"]);
    });

    it("deletes and downloads inside its folder only, never the root of it", async () => {
        const { files, adapter } = memoryStorage(stored);
        const view = storageView(adapter, customer);
        await view.delete({} as never, "tenants/initech/shop/c.tar");
        await view.delete({} as never, "/acme-job/a.tar");
        expect(files.has("tenants/initech/shop/c.tar")).toBe(true);
        expect(files.has("acme-job/a.tar")).toBe(true);
        await expect(attempt(() => view.delete({} as never, "../initech/shop/c.tar"))).rejects.toThrow("leaves its folder");
        await expect(attempt(() => view.delete({} as never, "./"))).rejects.toThrow("Name a file");
        expect(await view.download({} as never, "config-backups/config_backup_1.db.gz.enc", "/tmp/x")).toBe(false);
    });
});

describe("the tenant that shares a destination", () => {
    it("lists, downloads and deletes nothing of its customers, however it spells their folder", async () => {
        const { files, adapter } = memoryStorage(stored);
        const view = storageView(adapter, provider);
        expect((await view.list({} as never, "")).map((file) => file.path).sort()).toEqual(["acme-job/a.tar", "config-backups/config_backup_1.db.gz.enc"]);
        for (const path of ["tenants/globex/shop/b.tar", "TENANTS/globex/shop/b.tar", "tenants. /globex/shop/b.tar", "./tenants/globex/shop/b.tar", "\\tenants\\globex\\shop\\b.tar"]) {
            await expect(attempt(() => view.download({} as never, path, "/tmp/x"))).rejects.toThrow("holds the backups of the tenants");
            await expect(attempt(() => view.delete({} as never, path))).rejects.toThrow("holds the backups of the tenants");
        }
        expect(files.has("tenants/globex/shop/b.tar")).toBe(true);
    });
});

describe("a configuration backup asked for by its path", () => {
    it("is found in every spelling of its folder and its name", () => {
        for (const path of ["config-backups/x.enc", "./config-backups/x.enc", "Config-Backups./x.enc", "config-backups\\x.enc", "elsewhere/config_backup_2.db.gz.enc", "elsewhere/CONFIG_BACKUP_2.db.gz.enc.meta.json"]) {
            expect(isConfigBackupPath(path)).toBe(true);
        }
        expect(isConfigBackupPath("shop/run.tar")).toBe(false);
    });
});
