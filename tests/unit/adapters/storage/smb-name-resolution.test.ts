// @vitest-environment node
/**
 * smbclient and rpcclient look a server up in DNS alone (`name resolve order=host`) only for a
 * connection of a tenant that blocks the local network, whose check sees DNS answers and no NetBIOS
 * broadcast. The home tenant and a tenant without the block find their servers as before, by the
 * NetBIOS name too. The fact comes from the resolver, never from a stored config, and a config whose
 * tenant nobody knows gets the DNS-only lookup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const DNS_ONLY = "--option=name resolve order=host";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => ({ default: { promises: { lookup } }, promises: { lookup } }));
vi.mock("@/lib/crypto", () => ({ decryptConfig: (config: unknown) => config, encryptConfig: (config: unknown) => config, mergeSecrets: (a: unknown) => a }));
const credentials = vi.hoisted(() => vi.fn());
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: credentials }));
vi.mock("next/headers", () => ({ headers: async () => { throw new Error("headers was called outside a request scope"); } }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() }) },
}));

// smbclient itself, which every command of samba-client reaches through the adapter.
const smbclientCalls = vi.hoisted(() => [] as string[][]);
vi.mock("@/lib/adapters/storage/smb-run", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/adapters/storage/smb-run")>()),
    runSmbclient: async (args: string[]) => {
        smbclientCalls.push(args);
        return "";
    },
}));

// rpcclient, which the shadow copies of smb-vss.ts run through execFile.
const rpcclientCalls = vi.hoisted(() => [] as string[][]);
vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>();
    const execFile = (_command: string, args: string[], _options: unknown, callback: (error: unknown, stdout: string, stderr: string) => void) => {
        rpcclientCalls.push(args);
        const command = args[args.indexOf("-c") + 1] ?? "";
        const out = command.startsWith("fss_get_sup_version") ? "versions from 1 to 2\n" : "UNC \\\\files.example.com\\backups supports shadow copy requests\n";
        Promise.resolve().then(() => callback(null, out, ""));
    };
    return { ...actual, default: { ...actual, execFile }, execFile };
});

const { resolveAdapterConfig, overlayCredentialsOnConfig } = await import("@/lib/adapters/config-resolver");
const { tenantBlocksLocalNetwork } = await import("@/services/tenant/tenant-network");
const { SMBAdapter } = await import("@/lib/adapters/storage/smb");
const { SMBSchema } = await import("@/lib/adapters/definitions");
const { markLocalNetwork } = await import("@/lib/adapters/network-fact");
const { runAsTenant } = await import("@/lib/tenant/context");
const { registerAdapters } = await import("@/lib/adapters");
const { SMB_LOGIN_HINT } = await import("@/lib/adapters/smb-address");

registerAdapters();

type TenantRow = { id: string; name: string; blocksLocalNetwork: boolean; allowedNetworks: string };
const tenants: Record<string, TenantRow> = {
    acme: { id: "acme", name: "Acme", blocksLocalNetwork: true, allowedNetworks: "[]" },
    open: { id: "open", name: "Open GmbH", blocksLocalNetwork: false, allowedNetworks: "[]" },
    // The column says blocked, the home tenant is the platform and never is.
    default: { id: "default", name: "Platform", blocksLocalNetwork: true, allowedNetworks: "[]" },
};

const SHARE = { address: "//files.example.com/backups", maxProtocol: "SMB3", domain: "CORP" };

/** A saved SMB connection of a tenant, with its login in a credential profile. */
function savedShare(tenantId: string, config: Record<string, unknown> = SHARE) {
    return { id: `smb-${tenantId}`, adapterId: "smb", config: JSON.stringify(config), primaryCredentialId: "login-1", sshCredentialId: null, tenantId };
}

/** The argv of every smbclient and rpcclient call a ping and a shadow copy probe make with a config. */
async function toolCalls(config: unknown): Promise<{ smbclient: string[][]; rpcclient: string[][] }> {
    smbclientCalls.length = 0;
    rpcclientCalls.length = 0;
    const ping = await SMBAdapter.ping!(config);
    expect(ping.success, ping.message).toBe(true);
    const probe = await SMBAdapter.supportsSnapshot!(config, "");
    expect(probe.supported, probe.message).toBe(true);
    const calls = { smbclient: smbclientCalls.map((args) => [...args]), rpcclient: rpcclientCalls.map((args) => [...args]) };
    expect(calls.smbclient.length).toBeGreaterThan(0);
    expect(calls.rpcclient.length).toBeGreaterThan(0);
    return calls;
}

function expectDnsOnly(calls: { smbclient: string[][]; rpcclient: string[][] }): void {
    for (const args of [...calls.smbclient, ...calls.rpcclient]) expect(args).toContain(DNS_ONLY);
}

function expectNoResolveOption(calls: { smbclient: string[][]; rpcclient: string[][] }): void {
    for (const args of [...calls.smbclient, ...calls.rpcclient]) {
        expect(args).not.toContain(DNS_ONLY);
        expect(args.some((arg) => arg.includes("name resolve order"))).toBe(false);
    }
}

beforeEach(() => {
    lookup.mockReset();
    // Every name is public here, so the local network check passes and only the resolve options differ.
    lookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
    credentials.mockResolvedValue({ username: "backup", password: "pw" });
    prismaMock.tenant.findUnique.mockImplementation((async (args: { where: { id: string } }) => tenants[args.where.id] ?? null) as never);
});

describe("the SMB lookup of a saved connection", () => {
    it("is DNS alone for a tenant that blocks the local network, in smbclient and rpcclient", async () => {
        const config = await resolveAdapterConfig(savedShare("acme"));
        expectDnsOnly(await toolCalls(config));
    });

    it("is the one of the tools, NetBIOS included, for the home tenant and a tenant without the block", async () => {
        for (const tenantId of ["default", "open"]) {
            const config = await resolveAdapterConfig(savedShare(tenantId));
            expectNoResolveOption(await toolCalls(config));
        }
    });

    it("keeps the lookup of its tenant on the share a shadow copy exposes, which the run lays over the config", async () => {
        const open = (await resolveAdapterConfig(savedShare("open"))) as Record<string, unknown>;
        expectNoResolveOption(await toolCalls({ ...open, address: "//files.example.com/backups-snapshot" }));
        const blocked = (await resolveAdapterConfig(savedShare("acme"))) as Record<string, unknown>;
        expectDnsOnly(await toolCalls({ ...blocked, address: "//files.example.com/backups-snapshot" }));
    });

    it("follows the tenant when the platform turns the block on later", async () => {
        const before = await resolveAdapterConfig(savedShare("open"));
        expectNoResolveOption(await toolCalls(before));
        tenants.open.blocksLocalNetwork = true;
        try {
            expectDnsOnly(await toolCalls(await resolveAdapterConfig(savedShare("open"))));
        } finally {
            tenants.open.blocksLocalNetwork = false;
        }
    });
});

describe("a stored config", () => {
    // Every spelling a person could try in the JSON of a connection or a form.
    const ATTEMPTS = {
        localNetworkOpen: true,
        "dbackup.localNetworkOpen": true,
        "Symbol(dbackup.localNetworkOpen)": true,
        blocksLocalNetwork: false,
        nameResolveOrder: "lmhosts wins host bcast",
    };

    it("cannot switch the DNS-only lookup off for a tenant that blocks the local network", async () => {
        const config = await resolveAdapterConfig(savedShare("acme", { ...SHARE, ...ATTEMPTS }));
        expectDnsOnly(await toolCalls(config));
    });

    it("cannot switch it off through a form either", async () => {
        const config = await runAsTenant("acme", () => overlayCredentialsOnConfig("smb", { ...SHARE, ...ATTEMPTS }, "login-1", null));
        expectDnsOnly(await toolCalls(config));
    });

    it("loses the mark of the resolver when it is copied through JSON or the schema, and is DNS alone then", async () => {
        const open = await resolveAdapterConfig(savedShare("open"));
        expectDnsOnly(await toolCalls(JSON.parse(JSON.stringify(open))));
        expectDnsOnly(await toolCalls({ ...SMBSchema.parse(open), username: "backup", password: "pw" }));
    });
});

describe("a config whose tenant nobody knows", () => {
    it("is DNS alone when it never went through the resolver", async () => {
        expectDnsOnly(await toolCalls({ ...SHARE, username: "backup", password: "pw" }));
    });

    it("is DNS alone for a tenant that is gone or a row that names none", async () => {
        expectDnsOnly(await toolCalls(await resolveAdapterConfig(savedShare("gone"))));
        expectDnsOnly(await toolCalls(await resolveAdapterConfig(savedShare(""))));
        await expect(tenantBlocksLocalNetwork("gone")).resolves.toBe(true);
        await expect(tenantBlocksLocalNetwork(null)).resolves.toBe(true);
        await expect(tenantBlocksLocalNetwork(undefined)).resolves.toBe(true);
    });

    it("is DNS alone for a form tried outside any tenant", async () => {
        const config = await overlayCredentialsOnConfig("smb", { ...SHARE }, "login-1", null);
        expectDnsOnly(await toolCalls(config));
    });

    it("never reads the tenant row for the home tenant, which is the platform", async () => {
        prismaMock.tenant.findUnique.mockClear();
        await expect(tenantBlocksLocalNetwork("default")).resolves.toBe(false);
        expect(prismaMock.tenant.findUnique).not.toHaveBeenCalled();
    });
});

describe("the SMB lookup of a form", () => {
    it("follows the tenant that runs now", async () => {
        const inTenant = (tenantId: string) => runAsTenant(tenantId, () => overlayCredentialsOnConfig("smb", { ...SHARE }, "login-1", null));
        expectDnsOnly(await toolCalls(await inTenant("acme")));
        expectNoResolveOption(await toolCalls(await inTenant("open")));
        expectNoResolveOption(await toolCalls(await inTenant("default")));
    });
});

describe("a % in the SMB login", () => {
    it("is refused for every tenant, also where the tools keep their own lookup", async () => {
        credentials.mockResolvedValue({ username: "backup%other", password: "pw" });
        for (const tenantId of ["default", "open", "acme"]) {
            smbclientCalls.length = 0;
            rpcclientCalls.length = 0;
            const config = await resolveAdapterConfig(savedShare(tenantId));
            await expect(SMBAdapter.test!(config)).resolves.toEqual({ success: false, message: SMB_LOGIN_HINT });
            await expect(SMBAdapter.supportsSnapshot!(config, "")).resolves.toEqual({ supported: false, message: expect.stringContaining(SMB_LOGIN_HINT) });
            expect(smbclientCalls).toEqual([]);
            expect(rpcclientCalls).toEqual([]);
        }
    });
});

describe("the mark of the resolver", () => {
    it("is no key a config of JSON can hold", () => {
        const marked = markLocalNetwork({ ...SHARE }, false);
        expect(Object.keys(marked)).toEqual(Object.keys(SHARE));
        expect(JSON.parse(JSON.stringify(marked))).toEqual(SHARE);
    });
});
