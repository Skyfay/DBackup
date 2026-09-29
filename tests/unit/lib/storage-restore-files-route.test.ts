import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    permissions: [] as string[],
    planFileRestore: vi.fn(),
    planArchiveDownload: vi.fn(),
    generateSelectionDownloadToken: vi.fn(),
    restoreFilesToStorage: vi.fn(),
    auditLogFor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
// The real checks, reduced to the permission list of the signed in user.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: "u1", permissions: mocks.permissions, isSuperAdmin: false }),
    checkPermissionWithContext: (_ctx: unknown, permission: string) => {
        if (!mocks.permissions.includes(permission)) throw new PermissionError(permission);
    },
    checkAnyPermissionWithContext: (_ctx: unknown, permissions: string[]) => {
        if (!permissions.some((permission) => mocks.permissions.includes(permission))) throw new PermissionError(permissions.join(" or "));
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn(), logFor: mocks.auditLogFor } }));
vi.mock("@/services/storage/backup-audit", () => ({
    backupAuditDetails: async (_destinationId: string, file: string) => ({ file, destination: "NAS", job: "Media" }),
    fileRestoreTarget: async () => ({ target: "Local files", targetPath: "/restore" }),
}));
vi.mock("@/services/restore/file-restore", () => ({ planFileRestore: mocks.planFileRestore, restoreFilesToStorage: mocks.restoreFilesToStorage }));
vi.mock("@/services/restore/archive-download", () => ({ planArchiveDownload: mocks.planArchiveDownload, openArchiveDownload: vi.fn() }));
vi.mock("@/lib/auth/download-tokens", () => ({ generateSelectionDownloadToken: mocks.generateSelectionDownloadToken, consumeSelectionDownloadToken: vi.fn() }));

const { POST } = await import("@/app/api/storage/[id]/restore-files/route");

const post = (body: unknown) => POST(
    new NextRequest("http://localhost/api/storage/nas/restore-files", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "nas" }) }
);
const PICK = { file: "Media/backup.tar", selections: [{ src: "src-1" }], target: { kind: "download" } };

describe("POST /api/storage/[id]/restore-files", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.planFileRestore.mockResolvedValue({ fileCount: 12, totalBytes: 1024, fullDownload: false });
    });

    it("counts a pick for someone who may restore but not download, which the restore page asks before a restore", async () => {
        mocks.permissions = ["storage:restore"];

        const response = await post({ ...PICK, dryRun: true });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { fileCount: 12, totalBytes: 1024, fullDownload: false } });
    });

    it("still keeps the download of the files from someone who may only restore", async () => {
        mocks.permissions = ["storage:restore"];

        const response = await post({ ...PICK, prepare: true });

        expect(response.ok).toBe(false);
        expect(mocks.planArchiveDownload).not.toHaveBeenCalled();
        expect(mocks.generateSelectionDownloadToken).not.toHaveBeenCalled();
    });

    it("notes files written back into storage as a restore of the backup, with where they went", async () => {
        mocks.permissions = ["storage:restore"];
        mocks.restoreFilesToStorage.mockResolvedValue({ restored: 11, failed: [{ path: "a.txt", error: "denied" }], totalBytes: 1024 });

        const response = await post({ ...PICK, target: { kind: "storage", configId: "local", basePath: "/restore" } });

        expect(response.status).toBe(200);
        expect(mocks.auditLogFor).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u1" }),
            "RESTORE",
            "BACKUP",
            { action: "file_restore", file: "Media/backup.tar", destination: "NAS", job: "Media", target: "Local files", targetPath: "/restore", restored: 11, failed: 1 },
            "nas"
        );
    });

    it("counts a pick for someone who may only download, and for nobody without either", async () => {
        mocks.permissions = ["storage:download"];
        expect((await post({ ...PICK, dryRun: true })).status).toBe(200);

        mocks.permissions = ["storage:read"];
        expect((await post({ ...PICK, dryRun: true })).ok).toBe(false);
        expect(mocks.planFileRestore).toHaveBeenCalledTimes(1);
    });
});
