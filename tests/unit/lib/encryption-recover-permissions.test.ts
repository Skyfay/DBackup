// @vitest-environment node
/**
 * Trying a key on a backup reads the `.meta.json` of that backup at its destination, so it needs
 * the right to read the destinations besides the right to add a key to the Vault.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";

const mocks = vi.hoisted(() => ({
    granted: new Set<string>(),
    recoverKey: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.granted.has(permission)) throw new PermissionError(permission);
        return { id: "mia", isPlatformAdmin: false, tenantId: "default" };
    }),
    checkPlatformAdmin: vi.fn(),
    hasPermission: async (permission: string) => mocks.granted.has(permission),
    tenantRefusal: () => null,
}));
vi.mock("@/services/backup/encryption-service", () => ({}));
vi.mock("@/services/backup/key-recovery", () => ({ recoverEncryptionKey: mocks.recoverKey }));
vi.mock("@/services/backup/archive-index-service", () => ({ archiveIndexService: { clear: vi.fn() } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/audit/record-names", () => ({ connectionNames: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, "Office NAS"]))) }));
vi.mock("@/lib/server/config-backup-target-guard", () => ({ configBackupTargetRefusal: async () => null }));
vi.mock("@/lib/server/config-backup-guard", () => ({ configBackupFileRefusal: async () => null }));

const { recoverEncryptionKeyAction } = await import("@/app/actions/backup/encryption");

const KEY = "ab".repeat(32);

describe("a key tried on a backup to bring it into the Vault", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.recoverKey.mockResolvedValue({ status: "imported", profileId: "k1", profileName: "Recovered key" });
    });

    it("needs the right to read the destinations, so the Vault alone reads no backup", async () => {
        mocks.granted = new Set([PERMISSIONS.VAULT.WRITE]);

        await expect(recoverEncryptionKeyAction("nas", "nightly/shop.tar", KEY)).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.recoverKey).not.toHaveBeenCalled();
    });

    it.each(["../acme/nightly/shop.tar", "/srv/backups/shop.tar", "nightly\\..\\..\\shop.tar", "%2e%2e/shop.tar"])(
        "refuses the path %s that leaves the destination before it reads a backup",
        async (file) => {
            mocks.granted = new Set([PERMISSIONS.VAULT.WRITE, PERMISSIONS.STORAGE.READ]);

            const result = await recoverEncryptionKeyAction("nas", file, KEY);

            expect(result.success).toBe(false);
            expect(mocks.recoverKey).not.toHaveBeenCalled();
        }
    );

    it("tries the key with both rights", async () => {
        mocks.granted = new Set([PERMISSIONS.VAULT.WRITE, PERMISSIONS.STORAGE.READ]);

        expect((await recoverEncryptionKeyAction("nas", "nightly/shop.tar", KEY)).success).toBe(true);
        expect(mocks.recoverKey).toHaveBeenCalledWith("nas", "nightly/shop.tar", KEY, undefined, { beforeNote: expect.any(Function) });
    });
});

describe("the audit entry of a key tried on a backup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.granted = new Set([PERMISSIONS.VAULT.WRITE, PERMISSIONS.STORAGE.READ]);
    });

    it("notes a key the backup turned down, with the backup and never the key", async () => {
        mocks.recoverKey.mockResolvedValue({ status: "rejected" });

        expect(await recoverEncryptionKeyAction("nas", "nightly/shop.tar", KEY)).toEqual({ success: false, error: "This key does not open this backup." });

        expect(mocks.audit).toHaveBeenCalledTimes(1);
        expect(mocks.audit).toHaveBeenCalledWith("mia", "EXECUTE", "VAULT", { action: "key_check", file: "nightly/shop.tar", destination: "Office NAS", success: false }, undefined);
        expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(KEY);
    });

    it("notes a key the Vault holds already when it changed nothing there", async () => {
        mocks.recoverKey.mockResolvedValue({ status: "existing", profileId: "k1", profileName: "Office key" });

        await recoverEncryptionKeyAction("nas", "nightly/shop.tar", KEY);

        expect(mocks.audit).toHaveBeenCalledTimes(1);
        expect(mocks.audit).toHaveBeenCalledWith("mia", "EXECUTE", "VAULT", { action: "key_check", file: "nightly/shop.tar", destination: "Office NAS", keyName: "Office key", success: true }, "k1");
    });

    it("writes only the change of the Vault for a key it imported or noted", async () => {
        mocks.recoverKey.mockResolvedValue({ status: "existing", profileId: "k1", profileName: "Office key", notedFor: "p-old" });

        await recoverEncryptionKeyAction("nas", "nightly/shop.tar", KEY);

        expect(mocks.audit).toHaveBeenCalledTimes(1);
        expect(mocks.audit).toHaveBeenCalledWith("mia", "UPDATE", "VAULT", expect.objectContaining({ standsFor: "p-old" }), "k1");
    });
});
