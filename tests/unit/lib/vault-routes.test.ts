import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getVaultKeys: vi.fn(),
    getVaultCredentials: vi.fn(),
    checkPermission: vi.fn(),
    getSession: vi.fn(),
    auditLog: vi.fn(),
    getDecryptedMasterKey: vi.fn(),
    getEncryptionProfile: vi.fn(),
    findProfileByKey: vi.fn(),
    getEncryptionProfiles: vi.fn(),
    getUserPermissions: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The real checks, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/auth/access-control")>();
    return {
        // The real refusals of All tenants and of no tenant.
        tenantOf: actual.tenantOf,
        tenantRefusal: actual.tenantRefusal,
        getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
        hasPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => ctx.permissions.includes(permission),
        checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
            if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
        },
        checkPermission: (...args: unknown[]) => mocks.checkPermission(...args),
        getUserPermissions: (...args: unknown[]) => mocks.getUserPermissions(...args),
    };
});
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: (...args: unknown[]) => mocks.getSession(...args) } } }));
vi.mock("@/services/vault/vault-keys", () => ({ getVaultKeys: (...args: unknown[]) => mocks.getVaultKeys(...args) }));
vi.mock("@/services/vault/vault-credentials", () => ({ getVaultCredentials: (...args: unknown[]) => mocks.getVaultCredentials(...args) }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.auditLog(...args) } }));
vi.mock("@/services/backup/encryption-service", () => ({
    getDecryptedMasterKey: (...args: unknown[]) => mocks.getDecryptedMasterKey(...args),
    getEncryptionProfile: (...args: unknown[]) => mocks.getEncryptionProfile(...args),
    findProfileByKey: (...args: unknown[]) => mocks.findProfileByKey(...args),
    getEncryptionProfiles: (...args: unknown[]) => mocks.getEncryptionProfiles(...args),
}));

import { GET as getKeys } from "@/app/api/vault/keys/route";
import { GET as getCredentials } from "@/app/api/vault/credentials/route";
import { getEncryptionProfiles, inspectEncryptionKey, revealMasterKey } from "@/app/actions/backup/encryption";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isPlatformAdmin: false, tenantId: "default", allTenants: false });

describe("GET /api/vault/keys", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getVaultKeys.mockResolvedValue({ keys: [], stats: {}, auditDays: 90 });
    });

    it("turns away a request without a session", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await getKeys()).status).toBe(401);
    });

    it("needs the right to read the Vault", async () => {
        signedIn(PERMISSIONS.CREDENTIALS.READ);
        expect((await getKeys()).status).toBe(403);
        expect(mocks.getVaultKeys).not.toHaveBeenCalled();
    });

    it("answers with the model of the tab", async () => {
        signedIn(PERMISSIONS.VAULT.READ);
        const response = await getKeys();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { keys: [], stats: {}, auditDays: 90 } });
    });

    it("asks for a tenant in All tenants, which would mix the keys of every tenant", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "root", permissions: [PERMISSIONS.VAULT.READ], isPlatformAdmin: true, tenantId: null, allTenants: true });
        const response = await getKeys();

        expect(response.status).toBe(403);
        expect(mocks.getVaultKeys).not.toHaveBeenCalled();
    });
});

describe("GET /api/vault/credentials", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getVaultCredentials.mockResolvedValue({ profiles: [], stats: {}, auditDays: 90 });
    });

    it("needs the right to read credential profiles, the Vault alone is not enough", async () => {
        signedIn(PERMISSIONS.VAULT.READ);
        expect((await getCredentials()).status).toBe(403);
        expect(mocks.getVaultCredentials).not.toHaveBeenCalled();
    });

    it("answers with the model of the tab", async () => {
        signedIn(PERMISSIONS.CREDENTIALS.READ);
        expect((await getCredentials()).status).toBe(200);
    });
});

describe("the key actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.checkPermission.mockResolvedValue({ id: "u1" });
    });

    it("writes the reveal of a key to the audit log before the key leaves, naming the key", async () => {
        const order: string[] = [];
        mocks.getEncryptionProfile.mockResolvedValue({ id: "production", name: "Production" });
        mocks.auditLog.mockImplementation(async () => { order.push("audit"); });
        mocks.getDecryptedMasterKey.mockImplementation(async () => { order.push("key"); return "ab".repeat(32); });

        const result = await revealMasterKey("production");

        expect(result).toEqual({ success: true, data: "ab".repeat(32) });
        expect(mocks.checkPermission).toHaveBeenCalledWith(PERMISSIONS.VAULT.WRITE);
        expect(mocks.auditLog).toHaveBeenCalledWith("u1", "EXPORT", "VAULT", { action: "reveal_key", name: "Production" }, "production");
        expect(order).toEqual(["audit", "key"]);
    });

    it("reveals nothing and writes nothing for a key that is gone", async () => {
        mocks.getEncryptionProfile.mockResolvedValue(null);

        const result = await revealMasterKey("gone");

        expect(result.success).toBe(false);
        expect(mocks.auditLog).not.toHaveBeenCalled();
        expect(mocks.getDecryptedMasterKey).not.toHaveBeenCalled();
    });

    it("inspects a key only with the right to write to the Vault and names its Key ID", async () => {
        mocks.findProfileByKey.mockResolvedValue(null);

        const result = await inspectEncryptionKey("00".repeat(32));

        expect(mocks.checkPermission).toHaveBeenCalledWith(PERMISSIONS.VAULT.WRITE);
        expect(result).toEqual({ success: true, data: { keyId: "6668 7aad", existing: null } });
    });

    it("refuses to inspect anything but a key", async () => {
        expect(await inspectEncryptionKey("not a key")).toEqual({ success: false, error: "A key is 64 hex characters." });
        expect(mocks.findProfileByKey).not.toHaveBeenCalled();
    });
});

describe("the list of keys", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getEncryptionProfiles.mockResolvedValue([{ id: "production", name: "Production" }]);
    });

    it("is for the Vault and the job form", async () => {
        mocks.checkPermission.mockResolvedValue({ id: "u1", tenantId: "default", allTenants: false });

        expect(await getEncryptionProfiles()).toEqual({ success: true, data: [{ id: "production", name: "Production" }] });
        expect(mocks.checkPermission).toHaveBeenCalledWith([PERMISSIONS.VAULT.READ, PERMISSIONS.VAULT.WRITE, PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.WRITE]);
    });

    it("stays closed to someone who holds only the settings of the instance, which carry into every tenant", async () => {
        mocks.checkPermission.mockRejectedValue(new PermissionError(PERMISSIONS.VAULT.READ));

        expect(await getEncryptionProfiles()).toEqual({ success: false, error: "Insufficient permissions" });
        expect(mocks.getEncryptionProfiles).not.toHaveBeenCalled();
    });

    it("stays closed in All tenants, where the job form would offer the keys of every tenant", async () => {
        mocks.checkPermission.mockResolvedValue({ id: "root", tenantId: null, allTenants: true });

        expect(await getEncryptionProfiles()).toEqual({ success: false, error: expect.stringContaining("All tenants only reads") });
        expect(mocks.getEncryptionProfiles).not.toHaveBeenCalled();
    });
});
