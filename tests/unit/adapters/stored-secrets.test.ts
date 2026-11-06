import { describe, it, expect, vi, beforeEach } from "vitest";

// The stored config is encrypted at rest, so the round trip needs a system key.
vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));

const { mockFindUnique } = vi.hoisted(() => ({ mockFindUnique: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
    default: { adapterConfig: { findUnique: (...args: unknown[]) => mockFindUnique(...args) } },
}));

vi.mock("@/services/auth/credential-service", () => ({
    getDecryptedCredentialData: vi.fn(),
}));

import { applyStoredSecrets } from "@/lib/adapters/config-resolver";
import { canEditStoredConfig } from "@/lib/auth/adapter-config-access";
import { encryptConfig } from "@/lib/crypto";
import { ValidationError } from "@/lib/logging/errors";
import { LOGIN_FOR_NEW_ADDRESS, SECRETS_FOR_NEW_ADDRESS } from "@/lib/adapters/stored-secrets";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { AuthContext } from "@/lib/auth/access-control";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * A form round trip never carries a config secret back, because the adapter DTO
 * deletes it on the way out. Restoring it is what keeps a connection test on a
 * saved source from testing something the source never was.
 */
describe("applyStoredSecrets", () => {
    beforeEach(() => vi.clearAllMocks());

    function storedRow(adapterId: string, config: Record<string, unknown>) {
        return { adapterId, config: JSON.stringify(encryptConfig(config)) };
    }

    it("restores a secret the submitted config omits", async () => {
        mockFindUnique.mockResolvedValue(
            storedRow("mongodb", { host: "cluster0.ab12c.mongodb.net", uri: "mongodb+srv://u:p@cluster0.ab12c.mongodb.net" }),
        );

        const merged = await applyStoredSecrets("mongodb", "ac-1", {
            host: "cluster0.ab12c.mongodb.net",
            port: 27017,
        });

        expect(merged.uri).toBe("mongodb+srv://u:p@cluster0.ab12c.mongodb.net");
        expect(merged.port).toBe(27017);
    });

    it("lets a secret the caller did submit win over the stored one", async () => {
        mockFindUnique.mockResolvedValue(storedRow("mysql", { host: "db.local", password: "old" }));

        const merged = await applyStoredSecrets("mysql", "ac-1", { host: "db.local", password: "new" });

        expect(merged.password).toBe("new");
    });

    it("leaves structural fields to the caller while the address stays", async () => {
        mockFindUnique.mockResolvedValue(storedRow("mysql", { host: "db.local", port: 3306, user: "root", password: "pw", database: "app" }));

        const merged = await applyStoredSecrets("mysql", "ac-1", { host: "db.local", port: 3306, user: "backup", database: "shop" });

        expect(merged).toMatchObject({ host: "db.local", port: 3306, user: "backup", database: "shop", password: "pw" });
    });

    it("never sends the stored password to a host the form points at instead", async () => {
        mockFindUnique.mockResolvedValue(storedRow("mysql", { host: "db.local", port: 3306, password: "pw" }));

        const merged = applyStoredSecrets("mysql", "ac-1", { host: "attacker.example.com", port: 3306 });

        await expect(merged).rejects.toBeInstanceOf(ValidationError);
        await expect(merged).rejects.toThrow(LOGIN_FOR_NEW_ADDRESS);
    });

    it("never sends a stored connection string to another host either, which the caller has to type again", async () => {
        mockFindUnique.mockResolvedValue(storedRow("mongodb", { host: "db.local", port: 27017, uri: "mongodb://u:pw@db.local:27017/app" }));

        await expect(applyStoredSecrets("mongodb", "ac-1", { host: "attacker.example.com", port: 27017 }, { primaryCredentialId: "login-1" }))
            .rejects.toThrow(SECRETS_FOR_NEW_ADDRESS);
    });

    it("leaves the stored password behind for a new host a saved login signs in to", async () => {
        mockFindUnique.mockResolvedValue(storedRow("mysql", { host: "db.local", port: 3306, password: "pw" }));

        const merged = await applyStoredSecrets("mysql", "ac-1", { host: "db2.local", port: 3306 }, { primaryCredentialId: "login-1" });

        expect(merged).toEqual({ host: "db2.local", port: 3306 });
    });

    it("takes a new address with the secret typed for it", async () => {
        mockFindUnique.mockResolvedValue(storedRow("mysql", { host: "db.local", port: 3306, password: "pw" }));

        const merged = await applyStoredSecrets("mysql", "ac-1", { host: "db2.local", port: 3307, password: "new" });

        expect(merged).toEqual({ host: "db2.local", port: 3307, password: "new" });
    });

    it("ignores a stored config belonging to a different adapter", async () => {
        mockFindUnique.mockResolvedValue(storedRow("postgres", { password: "pg" }));

        const merged = await applyStoredSecrets("mysql", "ac-1", { host: "db.local" });

        expect(merged.password).toBeUndefined();
    });

    it("returns the submitted config when there is no such stored config", async () => {
        mockFindUnique.mockResolvedValue(null);

        expect(await applyStoredSecrets("mysql", "gone", { host: "db.local" })).toEqual({ host: "db.local" });
    });

    it("returns the submitted config when the stored one cannot be read", async () => {
        mockFindUnique.mockResolvedValue({ adapterId: "mysql", config: "not json" });

        expect(await applyStoredSecrets("mysql", "ac-1", { host: "db.local" })).toEqual({ host: "db.local" });
    });
});

describe("canEditStoredConfig", () => {
    function ctx(permissions: string[], isPlatformAdmin = false): AuthContext {
        return { userId: "user-1", permissions, isPlatformAdmin, authMethod: "session", tenantId: HOME_TENANT_ID, allTenants: false };
    }

    it("allows a caller who may write sources", () => {
        expect(canEditStoredConfig(ctx([PERMISSIONS.SOURCES.WRITE]), "mongodb")).toBe(true);
    });

    it("refuses a caller who may only view sources", () => {
        expect(canEditStoredConfig(ctx([PERMISSIONS.SOURCES.VIEW]), "mongodb")).toBe(false);
    });

    it("maps a destination adapter to the destination write permission", () => {
        expect(canEditStoredConfig(ctx([PERMISSIONS.DESTINATIONS.WRITE]), "sftp")).toBe(true);
        expect(canEditStoredConfig(ctx([PERMISSIONS.SOURCES.WRITE]), "sftp")).toBe(false);
    });

    it("maps a notification adapter to the notification write permission", () => {
        expect(canEditStoredConfig(ctx([PERMISSIONS.NOTIFICATIONS.WRITE]), "telegram")).toBe(true);
    });

    it("allows a platform admin", () => {
        expect(canEditStoredConfig(ctx([], true), "mongodb")).toBe(true);
    });

    it("refuses an adapter that is not in the permission map", () => {
        expect(canEditStoredConfig(ctx([PERMISSIONS.SOURCES.WRITE], true), "no-such-adapter")).toBe(false);
    });
});
