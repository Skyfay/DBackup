/**
 * The root of a destination is never deleted or written as a whole. A storage like WebDAV deletes a
 * folder with everything in it, so a delete of the root of a shared destination would take the
 * folder of every customer along, and the root of a customer its whole folder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageAdapter } from "@/lib/core/interfaces";
import { isRootPath, storageView, type StorageViewMode } from "@/lib/tenant/storage-view";

const mocks = vi.hoisted(() => ({ openDestination: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/sharing/destination-access", () => ({ openDestination: mocks.openDestination, findDestination: vi.fn(), openRow: vi.fn() }));

const { storageService } = await import("@/services/storage/storage-service");

const PROVIDER: StorageViewMode = { kind: "provider" };
const GLOBEX: StorageViewMode = { kind: "customer", tenantId: "globex" };
const ROOTS = ["", "/", "./", "\\", "//./"];

function adapter() {
    return {
        id: "webdav",
        upload: vi.fn().mockResolvedValue(true),
        download: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(true),
    } as unknown as StorageAdapter & Record<"upload" | "delete" | "list", ReturnType<typeof vi.fn>>;
}

beforeEach(() => vi.clearAllMocks());

describe("the root of a shared destination", () => {
    it.each([["the tenant that shares it", PROVIDER], ["a customer", GLOBEX]])("is never deleted by %s", (_who, mode) => {
        const inner = adapter();
        const view = storageView(inner, mode);
        for (const root of ROOTS) expect(() => view.delete({}, root)).toThrow("Name a file");
        expect(inner.delete).not.toHaveBeenCalled();
    });

    it.each([["the tenant that shares it", PROVIDER], ["a customer", GLOBEX]])("is never the target of an upload by %s", async (_who, mode) => {
        const session = { upload: vi.fn().mockResolvedValue(true), close: vi.fn() };
        const inner = Object.assign(adapter(), { openSession: vi.fn().mockResolvedValue(session) });
        const view = storageView(inner, mode);
        for (const root of ROOTS) expect(() => view.upload({}, "/tmp/run/two.tar", root)).toThrow("Name a file");
        const opened = await view.openSession!({});
        expect(() => opened.upload("/tmp/run/two.tar", "/")).toThrow("Name a file");
        expect(inner.upload).not.toHaveBeenCalled();
        expect(session.upload).not.toHaveBeenCalled();
    });

    it("still deletes a file and lists the root", async () => {
        const inner = adapter();
        const view = storageView(inner, GLOBEX);
        await view.delete({}, "crm/two.tar");
        await view.list({}, "/");
        expect(inner.delete).toHaveBeenCalledWith({}, "tenants/globex/crm/two.tar");
        expect(inner.list).toHaveBeenCalledWith({}, "tenants/globex");
    });

    it("tells a root from a file", () => {
        for (const root of ROOTS) expect(isRootPath(root)).toBe(true);
        expect(isRootPath("tenants")).toBe(false);
        expect(isRootPath("/a.tar")).toBe(false);
    });
});

describe("deleting a backup on any destination", () => {
    it("refuses the root before the storage is opened, also on a destination nobody shares", async () => {
        const inner = adapter();
        mocks.openDestination.mockResolvedValue({ adapter: inner, config: {}, mode: { kind: "own" } });
        for (const root of ROOTS) await expect(storageService.deleteFile("own-nas", root)).rejects.toThrow("Name a file");
        expect(mocks.openDestination).not.toHaveBeenCalled();
        expect(inner.delete).not.toHaveBeenCalled();
    });
});
