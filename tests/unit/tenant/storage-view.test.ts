import { describe, expect, it, vi } from "vitest";
import type { FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import { SHARED_STORAGE_FAILURE, cleanPath, innerPath, outerFiles, storageView, type StorageViewMode } from "@/lib/tenant/storage-view";

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

const OWN: StorageViewMode = { kind: "own" };
const PROVIDER: StorageViewMode = { kind: "provider" };
const GLOBEX: StorageViewMode = { kind: "customer", tenantId: "globex" };

const file = (path: string): FileInfo => ({ name: path.split("/").at(-1)!, path, size: 1, lastModified: new Date("2026-10-16T10:00:00.000Z") });

const STORED = [
    file("shop/one.tar"),
    file("tenants/globex/crm/two.tar"),
    file("tenants/initech/erp/three.tar"),
    file("tenants-archive/four.tar"),
];

describe("a customer on a shared destination", () => {
    it("reads and writes inside its own folder alone", () => {
        expect(innerPath(GLOBEX, "crm/two.tar")).toBe("tenants/globex/crm/two.tar");
        expect(innerPath(GLOBEX, "/crm//./two.tar")).toBe("tenants/globex/crm/two.tar");
        expect(innerPath(GLOBEX, "")).toBe("tenants/globex");
    });

    it("cannot leave its folder by a path it sends", () => {
        expect(() => innerPath(GLOBEX, "../initech/erp/three.tar")).toThrow("leaves its folder");
        expect(() => innerPath(GLOBEX, "crm/../../initech")).toThrow("leaves its folder");
        expect(() => innerPath(GLOBEX, "..\\initech")).toThrow("leaves its folder");
    });

    it("sees its own backups with the paths of its folder, and none of anybody else", () => {
        expect(outerFiles(GLOBEX, STORED).map((entry) => entry.path)).toEqual(["crm/two.tar"]);
    });
});

describe("the tenant of a shared destination", () => {
    it("sees everything but the folder of its customers", () => {
        expect(outerFiles(PROVIDER, STORED).map((entry) => entry.path)).toEqual(["shop/one.tar", "tenants-archive/four.tar"]);
    });

    it("cannot reach into the folder of its customers, however a storage that ignores case or trailing dots spells it", () => {
        expect(() => innerPath(PROVIDER, "Tenants/globex/crm/two.tar")).toThrow("tenants/");
        expect(() => innerPath(PROVIDER, "TENANTS. /globex")).toThrow("tenants/");
        expect(outerFiles(PROVIDER, [file("Tenants/globex/crm/two.tar")])).toEqual([]);
        expect(() => innerPath(PROVIDER, "tenants/globex/crm/two.tar")).toThrow("tenants/");
        expect(() => innerPath(PROVIDER, "tenants")).toThrow("tenants/");
        expect(() => innerPath(PROVIDER, "./tenants/globex")).toThrow("tenants/");
        expect(innerPath(PROVIDER, "tenants-archive/four.tar")).toBe("tenants-archive/four.tar");
    });
});

describe("a destination nobody shares", () => {
    it("is its adapter as it is", () => {
        const adapter = { list: vi.fn() } as unknown as StorageAdapter;
        expect(storageView(adapter, OWN)).toBe(adapter);
        expect(innerPath(OWN, "tenants/globex/x.tar")).toBe("tenants/globex/x.tar");
        expect(outerFiles(OWN, STORED)).toBe(STORED);
    });
});

describe("the adapter of a view", () => {
    const adapter = () => ({
        id: "sftp",
        upload: vi.fn().mockResolvedValue(true),
        download: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue(STORED),
        delete: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue("{}"),
        listTree: vi.fn(),
        browseDirectories: vi.fn(),
        downloadDirectory: vi.fn(),
        createSymlink: vi.fn(),
    }) as unknown as StorageAdapter & Record<string, ReturnType<typeof vi.fn>>;

    it("puts every path of a customer into its folder", async () => {
        const inner = adapter();
        const view = storageView(inner, GLOBEX);
        await view.upload({}, "/tmp/run/two.tar", "crm/two.tar");
        await view.download({}, "crm/two.tar", "/tmp/two.tar");
        await view.delete({}, "crm/two.tar");
        await view.read!({}, "crm/two.tar.meta.json");
        expect(inner.upload).toHaveBeenCalledWith({}, "/tmp/run/two.tar", "tenants/globex/crm/two.tar", undefined, undefined, undefined);
        expect(inner.download).toHaveBeenCalledWith({}, "tenants/globex/crm/two.tar", "/tmp/two.tar", undefined, undefined);
        expect(inner.delete).toHaveBeenCalledWith({}, "tenants/globex/crm/two.tar");
        expect(inner.read).toHaveBeenCalledWith({}, "tenants/globex/crm/two.tar.meta.json");
        expect((await view.list({}, "")).map((entry) => entry.path)).toEqual(["crm/two.tar"]);
        expect(inner.list).toHaveBeenLastCalledWith({}, "tenants/globex");
    });

    it("tells a customer nothing of the storage of another tenant, neither its log lines nor its errors", async () => {
        const inner = adapter();
        vi.mocked(inner.upload).mockImplementation(async (_config: unknown, _local: string, _remote: string, _progress: unknown, onLog?: (line: string) => void) => {
            onLog?.("Connected to SFTP sftp.acme.internal:22");
            throw new Error("getaddrinfo ENOTFOUND sftp.acme.internal");
        });
        const lines: string[] = [];
        const upload = storageView(inner, GLOBEX).upload({}, "/tmp/run/two.tar", "crm/two.tar", undefined, (line) => lines.push(line));
        await expect(upload).rejects.toThrow(SHARED_STORAGE_FAILURE);
        expect(lines).toEqual([]);

        vi.mocked(inner.list).mockRejectedValue(new Error("NT_STATUS_ACCESS_DENIED listing \\\\fileserver\\backups"));
        await expect(storageView(inner, GLOBEX).list({}, "")).rejects.toThrow(SHARED_STORAGE_FAILURE);
    });

    it("leaves the errors and the log of the storage to the tenant it belongs to", async () => {
        const inner = adapter();
        vi.mocked(inner.list).mockRejectedValue(new Error("getaddrinfo ENOTFOUND sftp.acme.internal"));
        await expect(storageView(inner, PROVIDER).list({}, "")).rejects.toThrow("ENOTFOUND sftp.acme.internal");
    });

    it("refuses a delete into another folder before the storage is asked", async () => {
        const inner = adapter();
        const view = storageView(inner, GLOBEX);
        expect(() => view.delete({}, "../initech/erp/three.tar")).toThrow("leaves its folder");
        expect(inner.delete).not.toHaveBeenCalled();
    });

    it("offers nothing that walks or browses directories, which a destination of a view never does", () => {
        const view = storageView(adapter(), PROVIDER);
        expect(view.listTree).toBeUndefined();
        expect(view.browseDirectories).toBeUndefined();
        expect(view.downloadDirectory).toBeUndefined();
        expect(view.createSymlink).toBeUndefined();
        expect(view.id).toBe("sftp");
    });

    it("keeps the paths of an upload session in the folder too", async () => {
        const session = { upload: vi.fn().mockResolvedValue(true), close: vi.fn() };
        const inner = Object.assign(adapter(), { openSession: vi.fn().mockResolvedValue(session) });
        const view = storageView(inner, GLOBEX);
        const opened = await view.openSession!({});
        await opened.upload("/tmp/run/two.tar", "crm/two.tar");
        expect(session.upload).toHaveBeenCalledWith("/tmp/run/two.tar", "tenants/globex/crm/two.tar", undefined, undefined, undefined);
    });
});

describe("a clean path", () => {
    it("drops empty and current segments and turns backslashes around", () => {
        expect(cleanPath("/a//b/./c\\d")).toBe("a/b/c/d");
    });
});
