/**
 * What changing, deleting and revealing a credential profile writes to the audit log. A secret of
 * a profile is only ever marked as changed, never written with a value.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.stubEnv("ENCRYPTION_KEY", "d".repeat(64));

const mocks = vi.hoisted(() => ({
    ctx: { userId: "u1", permissions: ["credentials:write", "credentials:delete", "credentials:reveal"], isSuperAdmin: false, authMethod: "apikey", apiKeyId: "key-1" },
    findUnique: vi.fn(),
    logFor: vi.fn(),
    updateCredentialProfile: vi.fn(),
    deleteCredentialProfile: vi.fn(),
    getCredentialProfile: vi.fn(),
    getDecryptedCredentialData: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => mocks.ctx),
    checkPermissionWithContext: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.logFor(...args) } }));
vi.mock("@/services/auth/credential-service", () => ({
    updateCredentialProfile: (...args: unknown[]) => mocks.updateCredentialProfile(...args),
    deleteCredentialProfile: (...args: unknown[]) => mocks.deleteCredentialProfile(...args),
    getCredentialProfile: (...args: unknown[]) => mocks.getCredentialProfile(...args),
    getDecryptedCredentialData: (...args: unknown[]) => mocks.getDecryptedCredentialData(...args),
}));
vi.mock("@/lib/prisma", () => ({
    default: { credentialProfile: { findUnique: (...args: unknown[]) => mocks.findUnique(...args) } },
}));

import { encrypt } from "@/lib/crypto";
const { PUT, DELETE } = await import("@/app/api/credentials/[id]/route");
const { GET: reveal } = await import("@/app/api/credentials/[id]/reveal/route");

const params = { params: Promise.resolve({ id: "c-1" }) };
const row = (name: string, payload: Record<string, unknown>, description: string | null = null) => ({ name, description, data: encrypt(JSON.stringify(payload)) });

describe("the audit entries of credential profiles", () => {
    beforeEach(() => vi.clearAllMocks());

    it("marks a new password as changed without either value and writes a new user with both", async () => {
        mocks.findUnique
            .mockResolvedValueOnce(row("Shop login", { username: "backup", password: "old-login-password" }))
            .mockResolvedValueOnce(row("Shop login", { username: "dbackup", password: "new-login-password" }));
        mocks.updateCredentialProfile.mockResolvedValue({ id: "c-1", name: "Shop login", type: "USERNAME_PASSWORD" });

        const response = await PUT(
            new NextRequest("http://localhost/api/credentials/c-1", { method: "PUT", body: JSON.stringify({ name: "Shop login", data: { username: "dbackup", password: "new-login-password" } }) }),
            params
        );

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "CREDENTIAL", {
            name: "Shop login",
            changes: [
                { field: "Username", from: "backup", to: "dbackup" },
                { field: "Password", from: null, to: null, secret: true },
            ],
        }, "c-1");
        const written = JSON.stringify(mocks.logFor.mock.calls);
        expect(written).not.toContain("old-login-password");
        expect(written).not.toContain("new-login-password");
    });

    it("keeps the old name of a renamed profile", async () => {
        mocks.findUnique
            .mockResolvedValueOnce(row("Shop login", { username: "backup", password: "same" }))
            .mockResolvedValueOnce(row("Shop DB login", { username: "backup", password: "same" }, "For the shop"));
        mocks.updateCredentialProfile.mockResolvedValue({ id: "c-1", name: "Shop DB login", type: "USERNAME_PASSWORD" });

        await PUT(
            new NextRequest("http://localhost/api/credentials/c-1", { method: "PUT", body: JSON.stringify({ name: "Shop DB login", description: "For the shop" }) }),
            params
        );

        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "CREDENTIAL", {
            name: "Shop DB login",
            renamedFrom: "Shop login",
            changes: [{ field: "Description", from: null, to: "For the shop" }],
        }, "c-1");
    });

    it("names a deleted profile, read before it is gone", async () => {
        mocks.findUnique.mockResolvedValue({ name: "Shop login" });

        const response = await DELETE(new NextRequest("http://localhost/api/credentials/c-1", { method: "DELETE" }), params);

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "DELETE", "CREDENTIAL", { name: "Shop login" }, "c-1");
    });

    it("names a revealed profile and writes the entry before the secret is decrypted", async () => {
        const order: string[] = [];
        mocks.getCredentialProfile.mockResolvedValue({ id: "c-1", name: "Shop login", type: "USERNAME_PASSWORD" });
        mocks.logFor.mockImplementation(async () => { order.push("audit"); });
        mocks.getDecryptedCredentialData.mockImplementation(async () => { order.push("secret"); return { username: "backup", password: "pw" }; });

        const response = await reveal(new NextRequest("http://localhost/api/credentials/c-1/reveal"), params);

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "EXPORT", "CREDENTIAL", { action: "reveal", name: "Shop login" }, "c-1");
        expect(order).toEqual(["audit", "secret"]);
    });
});
