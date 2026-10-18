// @vitest-environment node
/**
 * A tenant that blocks the local network reaches no address of it outside the ranges the platform
 * allows: a check that resolves the hosts a connection dials, for a saved connection at run time
 * and for a config of a form, in the tenant of the connection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => ({ default: { promises: { lookup } }, promises: { lookup } }));
vi.mock("@/lib/crypto", () => ({ decryptConfig: (config: unknown) => config, encryptConfig: (config: unknown) => config, mergeSecrets: (a: unknown) => a }));
const credentials = vi.hoisted(() => vi.fn());
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: credentials }));
vi.mock("next/headers", () => ({ headers: async () => { throw new Error("headers was called outside a request scope"); } }));

const { assertTenantReach, assertHostsReachable, localNetworkRefusal, networkOfRow, setNetwork } = await import("@/services/tenant/tenant-network");
const { assertConfigOffHost, resolveAdapterConfig } = await import("@/lib/adapters/config-resolver");
const { runAsTenant } = await import("@/lib/tenant/context");
const { registerAdapters } = await import("@/lib/adapters");

registerAdapters();

/** What the resolver answers per name, a name it does not know does not resolve. */
const DNS: Record<string, string[]> = {
    "db.internal": ["10.0.0.5"],
    "db.example.com": ["93.184.216.34"],
    "dual.example.com": ["93.184.216.34", "fd00::7"],
    "jump.example.com": ["203.0.113.10"],
    "nas.internal": ["10.10.10.20"],
};

type TenantRow = { id: string; name: string; blocksLocalNetwork: boolean; allowedNetworks: string };
let tenants: Record<string, TenantRow>;

beforeEach(() => {
    lookup.mockReset();
    lookup.mockImplementation(async (host: string) => {
        const addresses = DNS[host];
        if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
        return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    });
    tenants = {
        acme: { id: "acme", name: "Acme", blocksLocalNetwork: true, allowedNetworks: "[]" },
        open: { id: "open", name: "Open GmbH", blocksLocalNetwork: false, allowedNetworks: "[]" },
        lab: { id: "lab", name: "Lab", blocksLocalNetwork: true, allowedNetworks: '["10.10.10.0/24"]' },
        default: { id: "default", name: "Platform", blocksLocalNetwork: true, allowedNetworks: "[]" },
    };
    prismaMock.tenant.findUnique.mockImplementation((async (args: { where: { id: string } }) => tenants[args.where.id] ?? null) as never);
});

describe("the local network check of a tenant", () => {
    it("refuses a name that resolves into the local network and says which address", async () => {
        await expect(assertTenantReach("acme", "postgres", { host: "db.internal", port: 5432 })).rejects.toThrow(
            "Acme reaches no address of the local network, db.internal is 10.0.0.5. The platform allows ranges for it under Platform, Tenants."
        );
        expect(lookup).toHaveBeenCalledWith("db.internal", { all: true, verbatim: true });
    });

    it("refuses an address literal without asking the resolver", async () => {
        const refusal = assertTenantReach("acme", "mysql", { host: "127.0.0.1" });
        await expect(refusal).rejects.toBeInstanceOf(ValidationError);
        await expect(refusal).rejects.toThrow("Acme reaches no address of the local network, 127.0.0.1 is one.");
        // A link-local address with its zone, and an IPv4 address written as IPv6.
        await expect(assertTenantReach("acme", "sftp", { host: "fe80::1%eth0" })).rejects.toThrow("fe80::1%eth0 is one");
        await expect(assertTenantReach("acme", "webdav", { url: "http://[::ffff:192.168.1.1]/dav" })).rejects.toThrow("is one");
        expect(lookup).not.toHaveBeenCalled();
    });

    it("refuses a name with one public and one local address", async () => {
        await expect(assertTenantReach("acme", "generic-webhook", { webhookUrl: "https://dual.example.com/hook" })).rejects.toThrow("dual.example.com is fd00::7");
    });

    it("lets a public server through", async () => {
        await expect(assertTenantReach("acme", "postgres", { host: "db.example.com" })).resolves.toBeUndefined();
    });

    it("lets an address inside an allowed range through, and only that range", async () => {
        await expect(assertTenantReach("lab", "sftp", { host: "nas.internal" })).resolves.toBeUndefined();
        await expect(assertTenantReach("lab", "sftp", { host: "10.10.11.1" })).rejects.toThrow("Lab reaches no address of the local network, 10.10.11.1 is one.");
    });

    it("blocks nothing for the home tenant, whatever its column says, and asks nothing", async () => {
        await expect(assertTenantReach("default", "postgres", { host: "db.internal" })).resolves.toBeUndefined();
        expect(prismaMock.tenant.findUnique).not.toHaveBeenCalled();
        expect(lookup).not.toHaveBeenCalled();
    });

    it("blocks nothing for a tenant with the block off, nor outside a tenant", async () => {
        await expect(assertTenantReach("open", "postgres", { host: "db.internal" })).resolves.toBeUndefined();
        await expect(assertTenantReach(null, "postgres", { host: "db.internal" })).resolves.toBeUndefined();
        expect(lookup).not.toHaveBeenCalled();
    });

    it("checks only the SSH host in SSH mode, what lies behind it is reached from there", async () => {
        await expect(assertTenantReach("acme", "postgres", { host: "10.0.0.5", connectionMode: "ssh", sshHost: "jump.example.com" })).resolves.toBeUndefined();
        await expect(assertTenantReach("acme", "postgres", { host: "db.example.com", connectionMode: "ssh", sshHost: "db.internal" })).rejects.toThrow("db.internal is 10.0.0.5");
    });

    it("lets a host through that does not resolve, its connection fails on its own", async () => {
        await expect(assertHostsReachable("acme", ["nowhere.invalid"])).resolves.toBeUndefined();
    });

    it("names a host that is an address once", () => {
        expect(localNetworkRefusal("Acme", { host: "::1", address: "::1" })).toBe("Acme reaches no address of the local network, ::1 is one. The platform allows ranges for it under Platform, Tenants.");
    });
});

describe("where the check runs", () => {
    const row = (tenantId: string, config: Record<string, unknown>) => ({ id: "c1", adapterId: "postgres", config: JSON.stringify(config), primaryCredentialId: "login-1", sshCredentialId: null, tenantId });

    beforeEach(() => {
        credentials.mockResolvedValue({ username: "backup", password: "secret" });
    });

    it("refuses a saved connection of a blocking tenant when it is resolved for a run", async () => {
        await expect(resolveAdapterConfig(row("acme", { host: "db.internal" }))).rejects.toThrow("db.internal is 10.0.0.5");
    });

    it("follows the tenant of the connection, so a destination another tenant shares runs in a customer's run by its own setting", async () => {
        // The run belongs to Acme, which blocks the local network. The connection belongs to Open GmbH, which does not.
        const resolved = await runAsTenant("acme", () => resolveAdapterConfig(row("open", { host: "db.internal" })));
        expect(resolved).toEqual(expect.objectContaining({ host: "db.internal" }));
    });

    it("refuses a config of a form in the tenant that tries it", async () => {
        await expect(runAsTenant("acme", () => assertConfigOffHost("mysql", { host: "db.internal" }))).rejects.toThrow("Acme reaches no address of the local network");
        await expect(runAsTenant("open", () => assertConfigOffHost("mysql", { host: "db.internal" }))).resolves.toBeUndefined();
    });
});

describe("setting the network of a tenant", () => {
    it("stores the ranges in their short form, each once, and says what was before", async () => {
        const change = await setNetwork("open", { blocks: true, allowed: ["10.10.10.0/24", " 10.10.10.0/24", "FD00:1::/64", "10.0.0.5"] });

        expect(change).toEqual({
            name: "Open GmbH",
            before: { blocks: false, allowed: [] },
            after: { blocks: true, allowed: ["10.10.10.0/24", "fd00:1::/64", "10.0.0.5/32"] },
        });
        expect(prismaMock.tenant.update).toHaveBeenCalledWith({
            where: { id: "open" },
            data: { blocksLocalNetwork: true, allowedNetworks: JSON.stringify(["10.10.10.0/24", "fd00:1::/64", "10.0.0.5/32"]) },
        });
    });

    it("refuses a range that does not read, and changes nothing", async () => {
        await expect(setNetwork("acme", { blocks: true, allowed: ["10.10.10.5/24"] })).rejects.toThrow("Did you mean 10.10.10.0/24?");
        expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    });

    it("refuses the home tenant, which is the platform, and a tenant that is gone", async () => {
        await expect(setNetwork("default", { blocks: true, allowed: [] })).rejects.toBeInstanceOf(ValidationError);
        await expect(setNetwork("gone", { blocks: true, allowed: [] })).rejects.toBeInstanceOf(NotFoundError);
        expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    });

    it("reads the home tenant as never blocked and a broken column as no ranges", () => {
        expect(networkOfRow({ id: "default", blocksLocalNetwork: true, allowedNetworks: "[]" })).toEqual({ blocks: false, allowed: [] });
        expect(networkOfRow({ id: "acme", blocksLocalNetwork: true, allowedNetworks: "{broken" })).toEqual({ blocks: true, allowed: [] });
    });
});
