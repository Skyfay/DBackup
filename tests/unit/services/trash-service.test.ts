import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ConflictError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({ restoreSnapshot: vi.fn(), refresh: vi.fn(async () => undefined) }));

vi.mock("@/services/trash/trash-restore", () => ({ restoreSnapshot: mocks.restoreSnapshot }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: mocks.refresh } }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { cleanTrash, listTrash, mayHandle, restoreFromTrash } = await import("@/services/trash/trash-service");

const deletedAt = new Date("2026-09-20T10:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
    return {
        id: "t-key",
        kind: "encryptionKey",
        recordId: "key-1",
        name: "Offsite 2025",
        detail: "Key ID 9b2e 71c4",
        data: '{"record":{}}',
        deletedAt,
        deletedByName: "Lena Graf",
        permission: "vault:write",
        superAdminOnly: false,
        ...overrides,
    };
}

const VAULT_ADMIN = { permissions: ["vault:write"], isSuperAdmin: false };

describe("who may handle a deleted record", () => {
    it("needs the permission the record was deleted with, and a SuperAdmin for the account of one", () => {
        expect(mayHandle(VAULT_ADMIN, { permission: "vault:write", superAdminOnly: false })).toBe(true);
        expect(mayHandle(VAULT_ADMIN, { permission: "users:write", superAdminOnly: false })).toBe(false);
        expect(mayHandle({ permissions: ["users:write"], isSuperAdmin: false }, { permission: "users:write", superAdminOnly: true })).toBe(false);
        expect(mayHandle({ permissions: [], isSuperAdmin: true }, { permission: "users:write", superAdminOnly: true })).toBe(true);
    });
});

describe("Recently deleted as a list", () => {
    beforeEach(() => vi.clearAllMocks());

    it("shows a viewer only what they may restore, with the day Data retention lets go of it", async () => {
        prismaMock.deletedRecord.findMany.mockResolvedValue([row(), row({ id: "t-user", kind: "user", permission: "users:write" })] as never);
        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: "trash.retentionDays", value: "14" } as never);

        const rows = await listTrash(VAULT_ADMIN);

        expect(rows).toEqual([
            {
                id: "t-key",
                kind: "encryptionKey",
                recordId: "key-1",
                name: "Offsite 2025",
                detail: "Key ID 9b2e 71c4",
                deletedAt: "2026-09-20T10:00:00.000Z",
                deletedByName: "Lena Graf",
                expiresAt: "2026-10-04T10:00:00.000Z",
            },
        ]);
    });

    it("keeps a record 30 days on an instance that never changed Data retention", async () => {
        prismaMock.deletedRecord.findMany.mockResolvedValue([row()] as never);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);

        const [entry] = await listTrash(VAULT_ADMIN);

        expect(entry.expiresAt).toBe("2026-10-20T10:00:00.000Z");
    });

    it("removes only what stayed longer than its time", async () => {
        prismaMock.deletedRecord.deleteMany.mockResolvedValue({ count: 2 });
        vi.useFakeTimers({ now: new Date("2026-09-30T00:00:00.000Z") });

        expect(await cleanTrash(30)).toBe(2);
        expect(prismaMock.deletedRecord.deleteMany).toHaveBeenCalledWith({ where: { deletedAt: { lt: new Date("2026-08-31T00:00:00.000Z") } } });
        vi.useRealTimers();
    });
});

describe("a restore from Recently deleted", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    });

    it("brings a record back and takes it out of Recently deleted in the same transaction", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(row() as never);
        mocks.restoreSnapshot.mockResolvedValue({ name: "Offsite 2025", notes: [] });

        const result = await restoreFromTrash(["t-key"]);

        expect(mocks.restoreSnapshot).toHaveBeenCalledWith(prismaMock, "encryptionKey", { record: {} }, undefined);
        expect(prismaMock.deletedRecord.delete).toHaveBeenCalledWith({ where: { id: "t-key" } });
        expect(result).toEqual({ restored: [{ id: "t-key", recordId: "key-1", kind: "encryptionKey", name: "Offsite 2025", notes: [] }], conflicts: [], failed: [] });
        expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("reports a name taken meanwhile as a conflict and keeps the record where it is", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(row() as never);
        mocks.restoreSnapshot.mockRejectedValue(new ConflictError("A key named Offsite 2025 exists already. Two keys need two names."));

        const result = await restoreFromTrash(["t-key"]);

        expect(result.conflicts).toEqual([{ id: "t-key", kind: "encryptionKey", name: "Offsite 2025", message: "A key named Offsite 2025 exists already. Two keys need two names." }]);
        expect(result.restored).toEqual([]);
    });

    it("takes a new name only for a single record, and puts a restored job back on its schedule", async () => {
        prismaMock.deletedRecord.findUnique
            .mockResolvedValueOnce(row({ id: "t-job", kind: "job", recordId: "job-1", name: "Shop nightly" }) as never)
            .mockResolvedValueOnce(row({ id: "t-job-2", kind: "job", recordId: "job-2", name: "CRM hourly" }) as never);
        mocks.restoreSnapshot.mockImplementation(async (_tx: unknown, _kind: string, _data: unknown, newName?: string) => ({ name: newName ?? "same", notes: [] }));

        await restoreFromTrash(["t-job", "t-job-2"], { newName: "Ignored for several" });

        expect(mocks.restoreSnapshot.mock.calls.map((call) => call[3])).toEqual([undefined, undefined]);
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    });

    it("names a record that is gone from Recently deleted as failed", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(null);

        const result = await restoreFromTrash(["t-gone"]);

        expect(result.failed).toEqual([{ id: "t-gone", name: "t-gone", error: "It is gone from Recently deleted." }]);
    });
});
