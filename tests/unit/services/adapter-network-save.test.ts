// @vitest-environment node
/**
 * A person learns at once that a tenant reaches no address of its blocked local network: saving,
 * copying and testing a config refuse it before anything connects. And a tenant that shares a
 * destination with customers adds no second connection to its folder, which would show their
 * backups under tenants/<id>/ that the shared one hides from its own tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), runAdapterTest: vi.fn() }));
vi.mock("node:dns", () => ({ default: { promises: { lookup: mocks.lookup } }, promises: { lookup: mocks.lookup } }));
vi.mock("@/lib/crypto", () => ({
    decryptConfig: (config: unknown) => config,
    encryptConfig: (config: unknown) => config,
    mergeSecrets: (incoming: Record<string, unknown>, stored: Record<string, unknown>) => ({ ...stored, ...incoming }),
}));
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: vi.fn() }));
vi.mock("@/lib/transport/adapter-invoke", () => ({ runAdapterTest: mocks.runAdapterTest }));
vi.mock("next/headers", () => ({ headers: async () => { throw new Error("headers was called outside a request scope"); } }));

const { createAdapter } = await import("@/services/adapters/adapter-create");
const { updateAdapter } = await import("@/services/adapters/adapter-update");
const { cloneAdapter } = await import("@/services/adapters/adapter-clone");
const { testConnection } = await import("@/services/adapters/connection-test");
const { sharedPlaceRefusal } = await import("@/services/adapters/shared-place");
const { runAsTenant } = await import("@/lib/tenant/context");

const DNS: Record<string, string[]> = { "db.internal": ["10.0.0.5"], "db.example.com": ["93.184.216.34"] };

const ADDS_ALL = { addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true, addsApiKeys: true };
const TENANTS: Record<string, Record<string, unknown>> = {
    acme: { id: "acme", name: "Acme", blocksLocalNetwork: true, allowedNetworks: "[]", ...ADDS_ALL },
    msp: { id: "msp", name: "MSP", blocksLocalNetwork: false, allowedNetworks: "[]", ...ADDS_ALL },
};

/** A destination the MSP shares with its customers, on its NAS under /backups. */
const SHARED_NAS = { id: "share-1", name: "Shared NAS", adapterId: "sftp", config: JSON.stringify({ host: "nas.internal", username: "backup", authType: "password", pathPrefix: "/backups" }), primaryCredentialId: null, sshCredentialId: null };

beforeEach(() => {
    mocks.lookup.mockReset();
    mocks.lookup.mockImplementation(async (host: string) => {
        const addresses = DNS[host];
        if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
        return addresses.map((address) => ({ address, family: 4 }));
    });
    mocks.runAdapterTest.mockResolvedValue({ success: true, message: "Connected" });
    prismaMock.tenant.findUnique.mockImplementation((async (args: { where: { id: string } }) => TENANTS[args.where.id] ?? null) as never);
    prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
    prismaMock.adapterConfig.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "new", ...args.data })) as never);
    prismaMock.connectionShare.findMany.mockResolvedValue([]);
    prismaMock.connectionShare.count.mockResolvedValue(0);
    prismaMock.credentialProfile.findMany.mockResolvedValue([]);
});

const postgres = (host: string) => ({ name: "Main DB", type: "database", adapterId: "postgres", config: { host, port: 5432 } });

describe("a connection into the blocked local network", () => {
    it("is refused on save before it is stored", async () => {
        const save = runAsTenant("acme", () => createAdapter(postgres("db.internal")));
        await expect(save).rejects.toBeInstanceOf(ValidationError);
        await expect(save).rejects.toThrow("Acme reaches no address of the local network, db.internal is 10.0.0.5.");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("is stored for a public server, and for a tenant that does not block the local network", async () => {
        await expect(runAsTenant("acme", () => createAdapter(postgres("db.example.com")))).resolves.toEqual(expect.objectContaining({ id: "new" }));
        await expect(runAsTenant("msp", () => createAdapter(postgres("db.internal")))).resolves.toEqual(expect.objectContaining({ id: "new" }));
    });

    it("is refused on an edit that moves it there, also when only the mode changes", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({
            type: "database", adapterId: "postgres", lastError: null, config: JSON.stringify({ host: "db.internal", connectionMode: "ssh", sshHost: "db.example.com" }),
            storageRole: "DESTINATION", name: "Main DB", primaryCredentialId: null, sshCredentialId: null, metadata: null,
        } as never);

        await expect(runAsTenant("acme", () => updateAdapter("c1", { config: { host: "db.internal", connectionMode: "direct" } }))).rejects.toThrow("db.internal is 10.0.0.5");
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });

    it("is not copied, wherever the original came from", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ id: "c1", name: "Main DB", type: "database", adapterId: "postgres", storageRole: "DESTINATION", config: JSON.stringify({ host: "10.0.0.9" }), primaryCredentialId: null, sshCredentialId: null, metadata: null } as never);

        await expect(runAsTenant("acme", () => cloneAdapter("c1", {}))).rejects.toThrow("10.0.0.9 is one");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("is refused when a form tries it, before the adapter connects", async () => {
        const test = runAsTenant("acme", () => testConnection({ adapterId: "mysql", config: { host: "db.internal", port: 3306, user: "root" } }));
        await expect(test).rejects.toThrow("Acme reaches no address of the local network, db.internal is 10.0.0.5.");
        expect(mocks.runAdapterTest).not.toHaveBeenCalled();

        await expect(runAsTenant("acme", () => testConnection({ adapterId: "mysql", config: { host: "db.example.com", port: 3306, user: "root" } }))).resolves.toEqual({ ok: true, result: { success: true, message: "Connected" } });
    });
});

describe("a second connection to the folder of a destination shared with customers", () => {
    beforeEach(() => {
        prismaMock.connectionShare.findMany.mockResolvedValue([{ config: SHARED_NAS }] as never);
    });

    const sftp = (pathPrefix: string, host = "nas.internal") => ({
        name: "Own NAS", type: "storage", adapterId: "sftp", config: { host, username: "backup", authType: "password", password: "pw", pathPrefix },
    });

    it("is refused at its folder, inside it and above it", async () => {
        for (const path of ["/backups", "/backups/tenants", "/backups/tenants/acme/", "/", "/backups/./x/.."]) {
            await expect(runAsTenant("msp", () => createAdapter(sftp(path))), path).rejects.toThrow(sharedPlaceRefusal("Shared NAS"));
        }
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("is refused as a directory source too, and over rsync, which reaches the same files over SSH", async () => {
        await expect(runAsTenant("msp", () => createAdapter({ ...sftp("/backups"), storageRole: "SOURCE" }))).rejects.toThrow(sharedPlaceRefusal("Shared NAS"));
        await expect(runAsTenant("msp", () => createAdapter({ name: "Rsync", type: "storage", adapterId: "rsync", config: { host: "NAS.internal", username: "backup", authType: "password", password: "pw", pathPrefix: "/backups/tenants" } }))).rejects.toThrow(sharedPlaceRefusal("Shared NAS"));
    });

    it("is stored beside it, in another folder or on another server", async () => {
        await expect(runAsTenant("msp", () => createAdapter(sftp("/own")))).resolves.toEqual(expect.objectContaining({ id: "new" }));
        await expect(runAsTenant("msp", () => createAdapter(sftp("/backups-old")))).resolves.toEqual(expect.objectContaining({ id: "new" }));
        await expect(runAsTenant("msp", () => createAdapter(sftp("/backups", "other-nas.internal")))).resolves.toEqual(expect.objectContaining({ id: "new" }));
    });

    it("is refused on an edit that moves an own connection into it, never comparing the shared one with itself", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({
            type: "storage", adapterId: "sftp", lastError: null, config: JSON.stringify({ host: "nas.internal", username: "backup", authType: "password", password: "pw", pathPrefix: "/own" }),
            storageRole: "DESTINATION", name: "Own NAS", primaryCredentialId: null, sshCredentialId: null, metadata: null,
        } as never);

        await expect(runAsTenant("msp", () => updateAdapter("own-1", { config: { pathPrefix: "/backups/tenants" } }))).rejects.toThrow(sharedPlaceRefusal("Shared NAS"));
        expect(prismaMock.connectionShare.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { config: { type: "storage", storageRole: "DESTINATION" }, id: { not: "own-1" } } }));
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });

    it("does not copy an own connection that overlaps it from before it was shared", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ id: "own-1", name: "Own NAS", type: "storage", adapterId: "sftp", storageRole: "DESTINATION", config: JSON.stringify(sftp("/backups").config), primaryCredentialId: null, sshCredentialId: null, metadata: null } as never);

        await expect(runAsTenant("msp", () => cloneAdapter("own-1", {}))).rejects.toThrow(sharedPlaceRefusal("Shared NAS"));
    });

    it("leaves databases and channels alone", async () => {
        await expect(runAsTenant("msp", () => createAdapter({ name: "NAS DB", type: "database", adapterId: "postgres", config: { host: "nas.internal", port: 5432 } }))).resolves.toEqual(expect.objectContaining({ id: "new" }));
        expect(prismaMock.connectionShare.findMany).not.toHaveBeenCalled();
    });
});
