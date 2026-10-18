/**
 * A Recovery Kit holds the master keys of the picked encryption profiles. Its route answers a refused
 * permission with 403, finds every profile first, writes the audit entry with their names before a
 * key is decrypted, and writes none for a kit it never builds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    permissions: [] as string[],
    profiles: new Map<string, { id: string; name: string }>(),
    getProfile: vi.fn(),
    decryptKey: vi.fn(),
    markKit: vi.fn(),
    build: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: "lena", tenantId: "acme", isPlatformAdmin: false, allTenants: false, authMethod: "session", permissions: mocks.permissions }),
    checkPermissionWithContext: (_ctx: unknown, permission: string) => {
        if (!mocks.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/backup/encryption-service", () => ({
    getEncryptionProfile: (...args: unknown[]) => mocks.getProfile(...args),
    getDecryptedMasterKey: (...args: unknown[]) => mocks.decryptKey(...args),
    markRecoveryKit: (...args: unknown[]) => mocks.markKit(...args),
}));
vi.mock("@/services/backup/recovery-kit", () => ({ buildRecoveryKit: (...args: unknown[]) => mocks.build(...args) }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.audit(...args) } }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { GET } = await import("@/app/api/vault/recovery-kit/route");

const kit = (ids: string) => GET(new NextRequest(`http://dbackup.test/api/vault/recovery-kit?ids=${ids}`));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions = ["vault:write"];
    mocks.profiles = new Map([["k1", { id: "k1", name: "Prod key" }], ["k2", { id: "k2", name: "Staging key" }]]);
    mocks.getProfile.mockImplementation(async (id: string) => mocks.profiles.get(id) ?? null);
    mocks.decryptKey.mockResolvedValue("00".repeat(32));
    mocks.build.mockResolvedValue(Buffer.from("zip"));
});

describe("a Recovery Kit", () => {
    it("is refused with 403 to someone who may not change the Vault, and reads nothing", async () => {
        mocks.permissions = ["vault:read"];

        const response = await kit("k1");

        expect(response.status).toBe(403);
        expect(mocks.getProfile).not.toHaveBeenCalled();
        expect(mocks.decryptKey).not.toHaveBeenCalled();
    });

    it("is logged with the names of its keys, before any key is decrypted", async () => {
        const response = await kit("k1,k2");

        expect(response.status).toBe(200);
        expect(mocks.audit).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "lena" }),
            "EXPORT",
            "VAULT",
            { action: "recovery_kit_download", name: "Prod key, Staging key", profileIds: ["k1", "k2"] },
            undefined
        );
        expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.decryptKey.mock.invocationCallOrder[0]);
        expect(mocks.getProfile.mock.invocationCallOrder[1]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0]);
    });

    it("writes no entry and decrypts no key when a profile it names does not exist", async () => {
        const response = await kit("k1,gone");

        expect(response.status).toBe(404);
        expect(mocks.audit).not.toHaveBeenCalled();
        expect(mocks.decryptKey).not.toHaveBeenCalled();
        expect(mocks.build).not.toHaveBeenCalled();
    });
});
