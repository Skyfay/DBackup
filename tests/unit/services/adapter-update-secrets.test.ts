// @vitest-environment node
/**
 * Saving or testing a saved connection fills its stored secrets into the form only while the form
 * still connects where the connection did. Pointed at another server with the password left
 * blank, a save stores nothing and a test connects nowhere, so the saved password never reaches
 * that server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";

vi.stubEnv("ENCRYPTION_KEY", "b".repeat(64));

const mocks = vi.hoisted(() => ({ runAdapterTest: vi.fn() }));
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: async () => ({ username: "backup", password: "login-pw" }) }));
vi.mock("@/lib/transport/adapter-invoke", () => ({ runAdapterTest: mocks.runAdapterTest }));
vi.mock("next/headers", () => ({ headers: async () => { throw new Error("headers was called outside a request scope"); } }));

const { encryptConfig, decryptConfig } = await import("@/lib/crypto");
const { updateAdapter } = await import("@/services/adapters/adapter-update");
const { testConnection } = await import("@/services/adapters/connection-test");
const { LOGIN_FOR_NEW_ADDRESS } = await import("@/lib/adapters/stored-secrets");
const { runAsTenant } = await import("@/lib/tenant/context");

const TENANT = { id: "msp", name: "MSP", blocksLocalNetwork: false, allowedNetworks: "[]", addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true, addsApiKeys: true };
const STORED = { host: "203.0.113.10", port: 3306, user: "backup", password: "saved-pw" };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.runAdapterTest.mockResolvedValue({ success: true, message: "Connected" });
    prismaMock.tenant.findUnique.mockResolvedValue(TENANT as never);
    prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
    prismaMock.credentialProfile.findMany.mockResolvedValue([]);
    prismaMock.adapterConfig.findUnique.mockResolvedValue({
        id: "db-1", type: "database", adapterId: "mysql", lastError: null, config: JSON.stringify(encryptConfig(STORED)),
        storageRole: "DESTINATION", name: "Main DB", primaryCredentialId: null, sshCredentialId: null, metadata: null,
    } as never);
    prismaMock.adapterConfig.update.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "db-1", type: "database", adapterId: "mysql", name: "Main DB", ...args.data })) as never);
});

describe("saving a connection", () => {
    it("refuses a new host with the password left blank and stores nothing", async () => {
        const save = runAsTenant("msp", () => updateAdapter("db-1", { config: { host: "198.51.100.66", port: 3306, user: "backup" } }));

        await expect(save).rejects.toBeInstanceOf(ValidationError);
        await expect(save).rejects.toThrow(LOGIN_FOR_NEW_ADDRESS);
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });

    it("stores a new host without the old password when a saved login signs in there", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({
            id: "db-1", type: "database", adapterId: "mysql", lastError: null, config: JSON.stringify(encryptConfig(STORED)),
            storageRole: "DESTINATION", name: "Main DB", primaryCredentialId: "login-1", sshCredentialId: null, metadata: null,
        } as never);

        await runAsTenant("msp", () => updateAdapter("db-1", { config: { host: "198.51.100.66", port: 3306 } }));

        const data = prismaMock.adapterConfig.update.mock.calls[0][0].data as { config: string };
        expect(decryptConfig(JSON.parse(data.config))).toEqual({ host: "198.51.100.66", port: 3306 });
    });

    it("keeps the saved password when only the user changes", async () => {
        await runAsTenant("msp", () => updateAdapter("db-1", { name: "Main DB", config: { host: "203.0.113.10", port: 3306, user: "admin" } }));

        const data = prismaMock.adapterConfig.update.mock.calls[0][0].data as { config: string };
        expect(decryptConfig(JSON.parse(data.config))).toMatchObject({ user: "admin", password: "saved-pw" });
    });
});

describe("testing a saved connection from its form", () => {
    it("never connects to a new host with the saved password", async () => {
        const test = runAsTenant("msp", () => testConnection({ adapterId: "mysql", config: { host: "198.51.100.66", port: 3306, user: "backup" }, storedConfigId: "db-1" }));

        await expect(test).rejects.toThrow(LOGIN_FOR_NEW_ADDRESS);
        expect(mocks.runAdapterTest).not.toHaveBeenCalled();
    });

    it("tries the new host with the password typed for it", async () => {
        await runAsTenant("msp", () => testConnection({ adapterId: "mysql", config: { host: "198.51.100.66", port: 3306, user: "backup", password: "typed" }, storedConfigId: "db-1" }));

        expect(mocks.runAdapterTest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ host: "198.51.100.66", password: "typed" }));
    });
});
