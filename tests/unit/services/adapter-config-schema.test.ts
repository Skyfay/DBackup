// @vitest-environment node
/**
 * A connection is stored only with a config that fits the schema of its adapter, through the API as
 * well as through the form, since the adapters take a stored config as it is. The config is stored
 * as it was sent, never as the parse of the schema returns it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";

vi.stubEnv("ENCRYPTION_KEY", "c".repeat(64));

vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: async () => ({ username: "backup", password: "login-pw" }) }));
vi.mock("next/headers", () => ({ headers: async () => { throw new Error("headers was called outside a request scope"); } }));
vi.mock("@/lib/adapters/snapshot-validation", () => ({ validateSnapshotConfig: vi.fn().mockResolvedValue(undefined) }));

const { encryptConfig, decryptConfig } = await import("@/lib/crypto");
const { createAdapter } = await import("@/services/adapters/adapter-create");
const { updateAdapter } = await import("@/services/adapters/adapter-update");
const { cloneAdapter } = await import("@/services/adapters/adapter-clone");
const { runAsTenant } = await import("@/lib/tenant/context");

const TENANT = { id: "acme", name: "Acme", blocksLocalNetwork: false, allowedNetworks: "[]", addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true, addsApiKeys: true };
const RSYNC = { host: "nas.example.com", port: 22, username: "backup", authType: "password", password: "pw", pathPrefix: "/backups" };
const STORED_MYSQL = { host: "db.example.com", port: 3306, user: "backup", password: "saved-pw" };

const asCustomer = <T>(fn: () => Promise<T>) => runAsTenant("acme", fn);

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.tenant.findUnique.mockResolvedValue(TENANT as never);
    prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
    prismaMock.connectionShare.findMany.mockResolvedValue([]);
    prismaMock.credentialProfile.findMany.mockResolvedValue([]);
    prismaMock.credentialProfile.findUnique.mockResolvedValue({ id: "cred-1", type: "USERNAME_PASSWORD" } as never);
    prismaMock.adapterConfig.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "new", ...args.data })) as never);
    prismaMock.adapterConfig.update.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "db-1", type: "database", adapterId: "mysql", name: "Main DB", ...args.data })) as never);
});

describe("creating a connection", () => {
    it("refuses an rsync port that would add options to the ssh command, and stores nothing", async () => {
        const created = asCustomer(() => createAdapter({ name: "NAS", type: "storage", adapterId: "rsync", config: { ...RSYNC, port: "22 -oProxyCommand=touch /tmp/pwned" } }));

        await expect(created).rejects.toBeInstanceOf(ValidationError);
        await expect(created).rejects.toThrow(/Port/);
        await expect(created).rejects.not.toThrow(/ProxyCommand/);
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("refuses a MySQL password with a line break, and stores nothing", async () => {
        const created = asCustomer(() => createAdapter({ name: "Shop", type: "database", adapterId: "mysql", config: { ...STORED_MYSQL, password: "pw\nplugin-dir=/tmp" } }));

        await expect(created).rejects.toThrow(/line break or a NUL/);
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("refuses a field of the wrong type", async () => {
        await expect(asCustomer(() => createAdapter({ name: "Shop", type: "database", adapterId: "mysql", config: { host: ["a", "b"], port: 3306, user: "backup" } })))
            .rejects.toThrow(/Host/);
    });

    it("stores the config as it was sent, without the defaults of the schema, once it fits", async () => {
        const config = { host: "db.example.com", port: "3306", legacyFlag: true };
        await asCustomer(() => createAdapter({ name: "Shop", type: "database", adapterId: "mysql", config, primaryCredentialId: "cred-1" }));

        const stored = decryptConfig(JSON.parse(prismaMock.adapterConfig.create.mock.calls[0][0].data.config as string));
        expect(stored).toEqual(config);
    });
});

describe("editing a connection", () => {
    beforeEach(() => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({
            id: "db-1", type: "database", adapterId: "mysql", lastError: null, config: JSON.stringify(encryptConfig(STORED_MYSQL)),
            storageRole: "DESTINATION", name: "Main DB", primaryCredentialId: null, sshCredentialId: null, metadata: null,
        } as never);
    });

    it("checks the config with its stored secrets filled in, so a password left blank still saves", async () => {
        await asCustomer(() => updateAdapter("db-1", { config: { host: "db.example.com", port: 3306, user: "backup" } }));

        const data = prismaMock.adapterConfig.update.mock.calls[0][0].data as { config: string };
        expect(decryptConfig(JSON.parse(data.config))).toEqual(STORED_MYSQL);
    });

    it("refuses a port out of range and keeps the stored config", async () => {
        const saved = asCustomer(() => updateAdapter("db-1", { config: { host: "db.example.com", port: 70000, user: "backup", password: "typed" } }));

        await expect(saved).rejects.toThrow(/Port: must be a whole number from 1 to 65535/);
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });
});

describe("copying a connection", () => {
    it("refuses a copy of a config of an earlier version whose port would reach a command line", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({
            id: "nas-1", type: "storage", adapterId: "rsync", storageRole: "DESTINATION", name: "NAS", metadata: null,
            config: JSON.stringify(encryptConfig({ ...RSYNC, port: "22 -oProxyCommand=x" })), primaryCredentialId: null, sshCredentialId: null,
        } as never);
        prismaMock.connectionShare.findUnique.mockResolvedValue(null);

        await expect(asCustomer(() => cloneAdapter("nas-1", {}))).rejects.toThrow(/Port/);
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });
});
