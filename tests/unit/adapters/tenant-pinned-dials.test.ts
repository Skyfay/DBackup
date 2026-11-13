// @vitest-environment node
/**
 * Two clients of a tenant that blocks the local network dialed a name themselves, after the check
 * of the config had resolved it once, so a name that answered otherwise the second time reached an
 * address of the blocked network:
 * - Docker Volumes over SSH built its host without the reach policy of the tenant.
 * - SqlPackage of Azure SQL got the host name in its connection string.
 * Both now dial an address checked at connect time, and a tenant that blocks nothing dials as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns")>();
    const promises = { ...actual.promises, lookup };
    return { ...actual, default: { ...actual, promises }, promises };
});

const createHost = vi.hoisted(() => vi.fn());
vi.mock("@/lib/transport", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/transport")>()),
    createHost,
}));

const { markReach } = await import("@/lib/network/reach-policy");
const { createFakeHost } = await import("@/lib/testing/fake-host");
const { connectDocker } = await import("@/lib/adapters/storage/docker/engine/connect");
const { pinnedServer } = await import("@/lib/adapters/database/azure-sql/exporter/pinned-server");
const { buildConnectionString } = await import("@/lib/adapters/database/azure-sql/exporter/connection-string");
const { sqlpackageExporter } = await import("@/lib/adapters/database/azure-sql/exporter/sqlpackage");

const blocking = { allowed: [] };
let dns: Record<string, string[]>;

beforeEach(() => {
    dns = { "docker.example.com": ["93.184.216.34"], "sql.example.com": ["93.184.216.40"], "rebound.example.com": ["10.0.0.5"] };
    lookup.mockReset();
    lookup.mockImplementation(async (host: string) => {
        const addresses = dns[host];
        if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
        return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    });
    createHost.mockReset();
    createHost.mockImplementation(() => createFakeHost({ kind: "ssh" }));
});

describe("Docker Volumes over SSH of a tenant that blocks the local network", () => {
    const ssh = { connectionMode: "ssh", sshHost: "docker.example.com", sshUsername: "backup", sshAuthType: "password", sshPassword: "dummy" };

    it("hands its SSH host the reach policy of the tenant, so the dial is checked at connect time", async () => {
        const connection = connectDocker(markReach({ ...ssh }, blocking));
        expect(createHost).toHaveBeenCalledWith({ kind: "ssh", ssh: expect.objectContaining({ host: "docker.example.com", reach: blocking }) });
        await connection.close();
    });

    it("dials as before for a tenant that blocks nothing", async () => {
        const connection = connectDocker({ ...ssh });
        const spec = createHost.mock.calls[0][0] as { kind: string; ssh: Record<string, unknown> };
        expect(spec.kind).toBe("ssh");
        expect(spec.ssh.reach).toBeUndefined();
        await connection.close();
    });
});

describe("SqlPackage of an Azure SQL connection of a tenant that blocks the local network", () => {
    const config = { host: "sql.example.com", port: 1433, user: "backup", password: "dummy", database: "shop" };

    it("gets the checked address as its server and the name for the certificate check", async () => {
        const server = await pinnedServer(markReach({ ...config }, blocking) as never);
        expect(server).toEqual({ address: "93.184.216.40", name: "sql.example.com" });
        const text = buildConnectionString(config as never, "shop", server);
        expect(text).toContain('Server="tcp:93.184.216.40,1433";HostNameInCertificate="sql.example.com";');
        expect(text).not.toContain("tcp:sql.example.com");
    });

    it("never starts SqlPackage with the name, for a backup and for a restore", async () => {
        const host = createFakeHost({ kind: "direct" });
        const marked = markReach({ ...config }, blocking) as never;
        const run = async (call: () => Promise<void>) => call().catch(() => undefined);
        await run(() => sqlpackageExporter.exportDatabase(marked, "shop", "/tmp/shop.bacpac", host as never, () => {}));
        await run(() => sqlpackageExporter.importDatabase(marked, "/tmp/shop.bacpac", "shop", host as never, () => {}));
        const started = [...host.calls.spawn, ...host.calls.exec].map((argv) => argv.join(" ")).filter((line) => line.includes("ConnectionString"));
        expect(started).toHaveLength(2);
        for (const line of started) {
            expect(line).toContain("tcp:93.184.216.40,1433");
            expect(line).not.toContain("tcp:sql.example.com");
        }
    });

    it("refuses a name that leads into the blocked network when SqlPackage is about to dial it", async () => {
        const host = createFakeHost({ kind: "direct" });
        const marked = markReach({ ...config, host: "rebound.example.com" }, blocking) as never;
        await expect(sqlpackageExporter.exportDatabase(marked, "shop", "/tmp/shop.bacpac", host as never, () => {})).rejects.toThrow("rebound.example.com is 10.0.0.5");
        await expect(sqlpackageExporter.importDatabase(marked, "/tmp/shop.bacpac", "shop", host as never, () => {})).rejects.toThrow("rebound.example.com is 10.0.0.5");
        expect([...host.calls.spawn, ...host.calls.exec].filter((argv) => argv.join(" ").includes("ConnectionString"))).toEqual([]);
    });

    it("refuses a host SqlPackage would read again on its own, like one with an instance or a port", async () => {
        for (const spelled of ["tcp:sql.example.com", "sql.example.com,1444", "sql.example.com\\PROD"]) {
            await expect(pinnedServer(markReach({ ...config, host: spelled }, blocking) as never), spelled).rejects.toThrow("plain name or address");
        }
    });

    it("keeps the name for a tenant that blocks nothing", async () => {
        expect(await pinnedServer(config as never)).toBeNull();
        expect(buildConnectionString(config as never, "shop")).toContain('Server="tcp:sql.example.com,1433";');
        expect(lookup).not.toHaveBeenCalled();
    });
});
