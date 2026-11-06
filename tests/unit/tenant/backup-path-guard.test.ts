/**
 * A destination nobody shares hands a path to the storage as it is, so a delete or a lock of
 * `../../etc/passwd` or `/etc/passwd` on SFTP or rsync reached past the folder of the destination.
 * The services refuse such a path themselves, on every destination and for every route that calls
 * them, before the storage is opened or for its own row of a bulk action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageAdapter } from "@/lib/core/interfaces";
import { ValidationError } from "@/lib/logging/errors";
import { assertBackupPath } from "@/lib/tenant/storage-view";

const mocks = vi.hoisted(() => ({ openDestination: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/sharing/destination-access", () => ({ openDestination: mocks.openDestination, findDestination: vi.fn(), openRow: vi.fn() }));

const { storageService } = await import("@/services/storage/storage-service");
const { deleteBackupsBulk, setBackupsLocked } = await import("@/services/storage/bulk-delete");

/** Paths that leave the folder of a destination, written every way a storage may read them. */
const ESCAPES = [
    "../../etc/passwd",
    "Shop/../../../etc/passwd",
    "Shop\\..\\..\\etc\\passwd",
    "%2e%2e/%2e%2e/etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    "Shop/%2E%2E/%2e%2e/secret",
    "/etc/passwd",
    "\\\\fileserver\\share\\data",
    "%2fetc%2fpasswd",
];

function adapter() {
    return {
        id: "sftp",
        upload: vi.fn().mockResolvedValue(true),
        download: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue(JSON.stringify({ locked: false })),
    } as unknown as StorageAdapter & Record<"upload" | "delete" | "list" | "read", ReturnType<typeof vi.fn>>;
}

let inner: ReturnType<typeof adapter>;

beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    inner = adapter();
    // A destination nobody shares, whose view passes every path on unchanged.
    mocks.openDestination.mockResolvedValue({ adapter: inner, config: {}, mode: { kind: "own" } });
    vi.spyOn(storageService, "listFilesWithMetadata").mockResolvedValue([]);
    vi.spyOn(storageService, "removeStorageListCacheEntries").mockResolvedValue();
    vi.spyOn(storageService, "updateStorageListCacheEntries").mockResolvedValue();
    vi.spyOn(storageService, "updateStorageListCacheEntry").mockResolvedValue();
});

describe("a path named for a backup", () => {
    it.each(ESCAPES)("is refused when it leaves the destination: %s", (path) => {
        expect(() => assertBackupPath(path)).toThrow(ValidationError);
    });

    it("is refused when it names nothing", () => {
        for (const path of ["", "   ", undefined, 42]) expect(() => assertBackupPath(path)).toThrow(ValidationError);
    });

    it("passes for a backup inside the destination, also one whose name starts with dots", () => {
        for (const path of ["Shop/2026-10-26.tar", "Shop/chain-1/2026-10-26.tar", "Shop/..2026.tar", "Shop%20nightly/a.tar"]) {
            expect(() => assertBackupPath(path)).not.toThrow();
        }
    });
});

describe("deleting a backup on a destination nobody shares", () => {
    it.each(ESCAPES)("refuses %s before the storage is opened", async (path) => {
        await expect(storageService.deleteFile("own-nas", path)).rejects.toBeInstanceOf(ValidationError);
        expect(mocks.openDestination).not.toHaveBeenCalled();
        expect(inner.delete).not.toHaveBeenCalled();
    });

    it("refuses the escapes of a bulk delete on their own rows and deletes the rest", async () => {
        const result = await deleteBackupsBulk("own-nas", [...ESCAPES, "Shop/2026-10-26.tar"]);

        expect(result.succeeded).toEqual(["Shop/2026-10-26.tar"]);
        expect(result.failed.map((row) => row.id).sort()).toEqual([...ESCAPES].sort());
        const deleted = inner.delete.mock.calls.map((call) => call[1] as string);
        expect(deleted.every((path) => path.startsWith("Shop/2026-10-26.tar"))).toBe(true);
    });
});

describe("locking a backup on a destination nobody shares", () => {
    it("refuses the escapes of a bulk lock on their own rows and writes no sidecar for them", async () => {
        const result = await setBackupsLocked("own-nas", [...ESCAPES, "Shop/2026-10-26.tar"], true);

        expect(result.succeeded).toEqual(["Shop/2026-10-26.tar"]);
        expect(result.failed).toHaveLength(ESCAPES.length);
        expect(inner.read).toHaveBeenCalledTimes(1);
        expect(inner.upload).toHaveBeenCalledTimes(1);
        expect(inner.upload.mock.calls[0][2]).toBe("Shop/2026-10-26.tar.meta.json");
    });

    it("refuses an escape of a single lock before the storage is opened", async () => {
        await expect(storageService.toggleLock("own-nas", "../../etc/cron.d/job")).rejects.toBeInstanceOf(ValidationError);
        await expect(storageService.setLocked("own-nas", "/etc/cron.d/job", true)).rejects.toBeInstanceOf(ValidationError);
        expect(mocks.openDestination).not.toHaveBeenCalled();
    });
});
