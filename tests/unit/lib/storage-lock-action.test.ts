/**
 * Locking a backup answers a failure of the destination with a fixed sentence. On a destination a
 * tenant shares, the words of the provider can name its hosts, buckets and paths.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({ toggleLock: vi.fn(), audit: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async () => ({ id: "mia", isPlatformAdmin: false, tenantId: "acme", permissions: ["storage:delete"] })),
}));
vi.mock("@/lib/server/config-backup-guard", () => ({ configBackupFileRefusal: vi.fn(async () => null) }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { toggleLock: mocks.toggleLock } }));
vi.mock("@/services/storage/backup-audit", () => ({ backupAuditDetails: vi.fn(async () => ({ file: "nightly.sql.gz", destination: "Shared S3" })) }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));

const { lockBackup } = await import("@/app/actions/storage/lock");

describe("locking a backup", () => {
    beforeEach(() => vi.clearAllMocks());

    it("never answers the words of the storage provider", async () => {
        mocks.toggleLock.mockRejectedValue(new Error("AccessDenied: s3://partner-bucket/customer-b/nightly.sql.gz.meta.json at s3.partner.internal"));

        const result = await lockBackup("shared-s3", "customer-a/nightly.sql.gz");

        expect(result).toEqual({ success: false, error: "The lock could not be changed. The server log has the details." });
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("passes on a sentence DBackup wrote for the user", async () => {
        mocks.toggleLock.mockRejectedValue(new ServiceError("StorageService", "toggleLock", "The destination is being moved, try again in a minute."));

        expect(await lockBackup("shared-s3", "customer-a/nightly.sql.gz")).toEqual({ success: false, error: "The destination is being moved, try again in a minute." });
    });

    it("locks and names the backup in the audit log", async () => {
        mocks.toggleLock.mockResolvedValue(true);

        expect(await lockBackup("shared-s3", "customer-a/nightly.sql.gz")).toEqual({ success: true, locked: true });
        expect(mocks.audit).toHaveBeenCalledWith("mia", "UPDATE", "BACKUP", { action: "lock", file: "nightly.sql.gz", destination: "Shared S3" }, "shared-s3");
    });

    it.each(["../other-tenant/nightly.sql.gz", "/etc/nightly.sql.gz", "a\\..\\..\\nightly.sql.gz", "%2e%2e/nightly.sql.gz"])(
        "refuses the path %s that leaves the destination before it looks at the file",
        async (filePath) => {
            const { configBackupFileRefusal } = await import("@/lib/server/config-backup-guard");

            const result = await lockBackup("shared-s3", filePath);

            expect(result.success).toBe(false);
            expect(result.error).not.toBe("Invalid request");
            expect(configBackupFileRefusal).not.toHaveBeenCalled();
            expect(mocks.toggleLock).not.toHaveBeenCalled();
        }
    );
});
