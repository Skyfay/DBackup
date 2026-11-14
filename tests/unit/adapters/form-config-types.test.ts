// @vitest-environment node
/**
 * A config of a connection form is tried before it is saved, by a test, a browse or a read of its
 * databases, and comes from a request that can carry anything. The checks that keep a tenant off
 * the local network and a member off the server DBackup runs on read a field as text, so a host
 * sent as a list named no host for them, while redis-cli read `["127.0.0.1"]` as `127.0.0.1`. A
 * form config whose field has another type than its adapter gives it is refused before any check
 * or client reads it, and the checks themselves refuse such a field instead of skipping it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({ reach: vi.fn(async () => undefined), ownData: vi.fn(async () => undefined) }));

vi.mock("next/headers", () => ({ headers: async () => { throw new Error("no request"); } }));
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: vi.fn() }));
vi.mock("@/lib/adapters/own-data", () => ({ assertOffOwnData: mocks.ownData }));
vi.mock("@/services/tenant/tenant-network", () => ({
    assertReachFromHere: mocks.reach,
    assertTenantReach: vi.fn(),
    tenantReach: vi.fn(async () => ({ blocks: true, policy: { allowed: [] } })),
}));

const { assertConfigOffHost } = await import("@/lib/adapters/config-resolver");
const { formConfigProblems } = await import("@/lib/adapters/config-check");
const { dialedHosts, HostFormatError } = await import("@/lib/adapters/dialed-hosts");
const { hostLocalReason } = await import("@/lib/adapters/host-local");

const NOT_TEXT: [string, unknown][] = [["a list", ["127.0.0.1"]], ["an object", { toString: "127.0.0.1" }], ["a number", 2130706433], ["a boolean", true]];

beforeEach(() => {
    mocks.reach.mockClear();
    mocks.ownData.mockClear();
});

describe("a config of a connection form with a field of the wrong type", () => {
    it.each(NOT_TEXT)("is refused for a Redis host sent as %s, before the local network check reads it", async (_kind, host) => {
        for (const adapterId of ["redis", "valkey"]) {
            await expect(assertConfigOffHost(adapterId, { host, port: 6379 })).rejects.toBeInstanceOf(ValidationError);
        }
        expect(mocks.reach).not.toHaveBeenCalled();
        expect(mocks.ownData).not.toHaveBeenCalled();
    });

    it("is refused for every field the checks read as text, whichever adapter and boundary it belongs to", async () => {
        const cases: [string, Record<string, unknown>][] = [
            ["mysql", { host: ["/var/run/mysqld/mysqld.sock"] }],
            ["postgres", { host: "db.example.com", options: ["-f", "/app/data/x"] }],
            ["mongodb", { host: "db.example.com", uri: ["mongodb://127.0.0.1"] }],
            ["mongodb", { host: "db.example.com", uri: { href: "mongodb://127.0.0.1" } }],
            ["redis", { host: "db.example.com", mode: "sentinel", sentinelNodes: ["127.0.0.1:26379"] }],
            ["mssql", { host: "sql.example.com", connectionMode: "ssh", sshHost: ["127.0.0.1"], sshUsername: "u" }],
            ["docker-volume", { connectionMode: "ssh", sshHost: { name: "127.0.0.1" }, sshUsername: "u" }],
            ["sqlite", { mode: "ssh", host: "files.example.com", path: ["/app/data/dbackup.db"] }],
            ["local-filesystem", { basePath: ["/app/data"] }],
            ["s3-generic", { endpoint: ["http://127.0.0.1:9000"], bucket: "b" }],
            ["sftp", { host: 2130706433 }],
            ["smb", { address: ["//127.0.0.1/share"] }],
            ["webdav", { url: ["http://127.0.0.1"] }],
            ["generic-webhook", { webhookUrl: ["http://127.0.0.1"] }],
            ["email", { host: ["127.0.0.1"], port: 25 }],
            ["rsync", { host: "files.example.com", options: ["-e", "sh"] }],
            // A coercing field takes a list and reads it as a number, which the config never held.
            ["mysql", { host: "db.example.com", port: ["3306"] }],
            // The SSH test of a form that names no adapter.
            ["ssh", { connectionMode: "ssh", sshHost: ["127.0.0.1"] }],
            ["ssh", { connectionMode: "ssh", host: "files.example.com", proxy: { host: "127.0.0.1" } }],
        ];
        for (const [adapterId, config] of cases) {
            await expect(assertConfigOffHost(adapterId, config), `${adapterId} ${JSON.stringify(config)}`).rejects.toThrow("The settings of the connection do not fit");
        }
        expect(mocks.reach).not.toHaveBeenCalled();
    });

    it("never names the value it refuses", () => {
        expect(formConfigProblems("redis", { host: ["10.1.2.3"] }).join(" ")).not.toContain("10.1.2.3");
    });

    it("passes what a form sends: an incomplete config, a port as text, a list of databases and of recipients", async () => {
        const fine: [string, Record<string, unknown>][] = [
            ["redis", { host: "db.example.com", port: "6379", database: 0, tls: false }],
            ["mysql", { host: "db.example.com", port: 3306, database: ["shop", "crm"], disableSsl: true }],
            ["postgres", { host: "", user: null, password: undefined }],
            ["email", { host: "smtp.example.com", port: 587, from: "a@example.com", to: ["b@example.com", "c@example.com"] }],
            ["firebird", { host: "fb.example.com", databases: [{ name: "shop", path: "/data/shop.fdb" }] }],
            ["mongodb", { host: "db.example.com", uri: "" }],
        ];
        for (const [adapterId, config] of fine) {
            expect(formConfigProblems(adapterId, config), `${adapterId} ${JSON.stringify(config)}`).toEqual([]);
        }
        await expect(assertConfigOffHost("redis", { host: "db.example.com", port: 6379 })).resolves.toBeUndefined();
        expect(mocks.reach).toHaveBeenCalledTimes(1);
    });
});

describe("the checks of a config themselves", () => {
    it.each(NOT_TEXT)("refuse a host that is %s as one no client reads, never as no host", (_kind, host) => {
        for (const adapterId of ["redis", "valkey", "mysql", "postgres", "mongodb", "firebird", "azure-sql", "sftp", "ftp", "email", "unknown-kind"]) {
            expect(() => dialedHosts(adapterId, { host }), adapterId).toThrow(HostFormatError);
        }
        expect(() => dialedHosts("docker-volume", { connectionMode: "ssh", sshHost: host })).toThrow(HostFormatError);
        expect(() => dialedHosts("webdav", { url: host })).toThrow(HostFormatError);
        expect(() => dialedHosts("s3-generic", { endpoint: host, bucket: "b" })).toThrow(HostFormatError);
        expect(() => dialedHosts("redis", { host: "db.example.com", mode: "sentinel", sentinelNodes: host })).toThrow(HostFormatError);
    });

    it("still read a missing host as the fallback of its client and a text as before", () => {
        expect(dialedHosts("redis", { host: " db.example.com " })).toEqual(["db.example.com"]);
        expect(dialedHosts("redis", {})).toEqual([]);
        expect(dialedHosts("mysql", { host: null })).toEqual(["127.0.0.1"]);
    });

    it("count a database host that is no text as one that reaches the server DBackup runs on", () => {
        expect(hostLocalReason("mysql", { host: ["/var/run/mysqld/mysqld.sock"] })).toContain("only a platform admin");
        expect(hostLocalReason("mysql", { host: "db.example.com" })).toBeNull();
        expect(hostLocalReason("mysql", {})).toBeNull();
    });
});
