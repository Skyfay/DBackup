// @vitest-environment node
/**
 * The local network check reads every host field as the client of its adapter reads it, so a
 * spelling the client takes for another host than a plain reading, like `user@host` of rsync or
 * `host\INSTANCE` of SQL Server, is refused for a tenant that blocks the local network. A tenant
 * that reaches the local network and the home tenant pass every valid input as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => ({ default: { promises: { lookup } }, promises: { lookup } }));

const { assertTenantReach } = await import("@/services/tenant/tenant-network");

type TenantRow = { id: string; name: string; blocksLocalNetwork: boolean; allowedNetworks: string };
const tenants: Record<string, TenantRow> = {
    acme: { id: "acme", name: "Acme", blocksLocalNetwork: true, allowedNetworks: "[]" },
    open: { id: "open", name: "Open GmbH", blocksLocalNetwork: false, allowedNetworks: "[]" },
    default: { id: "default", name: "Platform", blocksLocalNetwork: true, allowedNetworks: "[]" },
};

beforeEach(() => {
    lookup.mockReset();
    // Every name is public here, an address of the local network only comes as a literal.
    lookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
    prismaMock.tenant.findUnique.mockImplementation((async (args: { where: { id: string } }) => tenants[args.where.id] ?? null) as never);
});

/** Spellings each client reads as a host of the local network. */
const LOCAL: [string, Record<string, unknown>][] = [
    ["mongodb", { host: "admin:pw@10.0.0.5:27017" }],
    ["mongodb", { host: "public.example.com@10.0.0.5" }],
    ["mongodb", { host: "mongodb://10.0.0.5/app?tls=true" }],
    ["mongodb", { host: "public.example.com,10.0.0.6" }],
    ["mongodb", { host: "" }],
    ["mssql", { host: "10.0.0.5\\SQLEXPRESS" }],
    ["mssql", { host: "tcp:10.0.0.5,1433" }],
    ["mssql", { host: "(local)" }],
    ["azure-sql", { host: "tcp:10.0.0.5,1433" }],
    ["firebird", { host: "10.0.0.5/3051" }],
    ["firebird", { host: "[fd00::5]/3051" }],
    ["firebird", { host: "" }],
    ["mysql", { host: "" }],
    ["mariadb", { host: "" }],
    ["postgres", { host: "" }],
    ["postgres", { host: "public.example.com,10.0.0.6" }],
    ["rsync", { host: "public.example.com@10.0.0.5" }],
    ["smb", { address: "\\\\10.0.0.9\\share" }],
];

/** Valid inputs of each adapter, which reach a public server. */
const VALID: [string, Record<string, unknown>][] = [
    ["mysql", { host: "db.example.com", port: 3306 }],
    ["mariadb", { host: "db.example.com:3307" }],
    ["postgres", { host: "2001:db8::5" }],
    ["postgres", { host: "db1.example.com,db2.example.com" }],
    ["mongodb", { host: "[2001:db8::5]:27017" }],
    ["mssql", { host: "sql.example.com\\INST" }],
    ["azure-sql", { host: "acme.database.windows.net" }],
    ["firebird", { host: "[2001:db8::5]/3050" }],
    ["rsync", { host: "backup.example.com" }],
    ["smb", { address: "//files.example.com/backups" }],
    ["webdav", { url: "https://cloud.example.com/remote.php/dav/" }],
    ["discord", { webhookUrl: "https://discord.com/api/webhooks/1/x" }],
];

describe("the local network check of each spelling of a host", () => {
    it("refuses a host of the local network however its client spells it, for a tenant that blocks it", async () => {
        for (const [adapterId, config] of LOCAL) {
            await expect(assertTenantReach("acme", adapterId, config), `${adapterId} ${JSON.stringify(config)}`).rejects.toThrow(/Acme reaches no address of the local network/);
        }
    });

    it("passes the same spellings for a tenant that reaches the local network and for the home tenant", async () => {
        for (const [adapterId, config] of LOCAL) {
            await expect(assertTenantReach("open", adapterId, config)).resolves.toBeUndefined();
            await expect(assertTenantReach("default", adapterId, config)).resolves.toBeUndefined();
        }
    });

    it("passes valid inputs that reach public servers, in every tenant", async () => {
        for (const [adapterId, config] of VALID) {
            for (const tenant of ["acme", "open", "default"]) {
                await expect(assertTenantReach(tenant, adapterId, config), `${tenant} ${adapterId}`).resolves.toBeUndefined();
            }
        }
    });

    it("refuses an SMB address no client reads only for a tenant that blocks the local network", async () => {
        await expect(assertTenantReach("acme", "smb", { address: "fileserver/share" })).rejects.toThrow(/names no host to check. The share address does not read/);
        await expect(assertTenantReach("open", "smb", { address: "fileserver/share" })).resolves.toBeUndefined();
        await expect(assertTenantReach("default", "smb", { address: "fileserver/share" })).resolves.toBeUndefined();
    });
});
