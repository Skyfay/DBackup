// @vitest-environment node
/**
 * The clients of a tenant that blocks the local network dial the address checked at connect time:
 * the database tools through `pinned-host.ts`, SQL Server through its connector, which also refuses
 * a routing redirect that leaves the SSH tunnel, rsync, smbclient, SMTP, FTP, SFTP and S3. A config
 * without the policy, the one of the home tenant or of a tenant that blocks nothing, dials as before.
 */
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns")>();
    const promises = { ...actual.promises, lookup };
    return { ...actual, default: { ...actual, promises }, promises };
});

const createTransport = vi.hoisted(() => vi.fn(() => ({ verify: vi.fn(async () => true), sendMail: vi.fn(async () => ({ messageId: "m" })) })));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
vi.mock("@/lib/notifications/brand", async (importActual) => ({
    ...(await importActual<typeof import("@/lib/notifications/brand")>()),
    loadNotificationBrand: vi.fn(async () => ({ instanceName: "Production", baseUrl: "https://backup.example.com", timeZone: "UTC" })),
}));

const ftpAccess = vi.hoisted(() => vi.fn());
vi.mock("basic-ftp", async (importOriginal) => {
    const actual = await importOriginal<typeof import("basic-ftp")>();
    class RecordingClient extends actual.Client {
        override async access(options: unknown) { ftpAccess(options); return { code: 220, message: "ok" }; }
        override async list() { return []; }
        override close() { }
    }
    return { ...actual, Client: RecordingClient };
});

const sftpConnect = vi.hoisted(() => vi.fn());
vi.mock("ssh2-sftp-client", () => ({
    default: class {
        connect = sftpConnect;
        list = async () => [];
        exists = async () => "d";
        stat = async () => ({ isDirectory: true });
        end = async () => true;
    },
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const { markReach } = await import("@/lib/network/reach-policy");
const { toRanges } = await import("@/lib/network/local-network");
const { pinDatabaseHost, withPinnedDatabaseHost } = await import("@/lib/adapters/database/common/pinned-host");
const { createFakeHost } = await import("@/lib/testing/fake-host");
const { buildConnectionArgs: redisArgs } = await import("@/lib/adapters/database/redis/args");
const { tdsConnector } = await import("@/lib/adapters/database/mssql/connector");
const { pinRsyncHost, withPinnedRsyncHost } = await import("@/lib/adapters/storage/rsync-pin");
const { smbAddressOptions } = await import("@/lib/adapters/storage/smb-pin");
const { sshTarget } = await import("@/lib/adapters/storage/rsync");
const { EmailAdapter } = await import("@/lib/adapters/notification/email");
const { FTPAdapter } = await import("@/lib/adapters/storage/ftp");
const { SFTPAdapter } = await import("@/lib/adapters/storage/sftp");

let dns: Record<string, string[]>;
const blocking = { allowed: [] };
const marked = <T extends object>(config: T, policy: { allowed: ReturnType<typeof toRanges> } | null = blocking) => markReach({ ...config }, policy);
const adapter = (id: string) => ({ id, name: id, type: "database", configSchema: {} }) as never;

beforeEach(() => {
    dns = {
        "db.example.com": ["93.184.216.34"],
        "db2.example.com": ["93.184.216.35"],
        "v6.example.com": ["2606:4700::1111"],
        "db.internal": ["10.0.0.5"],
        "redirect.internal": ["10.0.0.9"],
        "loop.example.com": ["127.0.0.1"],
        "multi.example.com": ["127.0.0.2", "127.0.0.1"],
    };
    lookup.mockReset();
    lookup.mockImplementation(async (host: string) => {
        const addresses = dns[host];
        if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
        return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    });
    createTransport.mockClear();
    ftpAccess.mockClear();
    sftpConnect.mockReset();
});

describe("the database tools", () => {
    it("keep the names of a PostgreSQL list in -h and hand libpq their checked addresses as PGHOSTADDR", async () => {
        const pinned = await pinDatabaseHost(adapter("postgres"), marked({ host: "db.example.com, db2.example.com", port: 5432 }));
        expect((pinned.config as Record<string, unknown>).host).toBe("db.example.com, db2.example.com");
        expect(pinned.env).toEqual({ PGHOSTADDR: "93.184.216.34,93.184.216.35" });
        await expect(pinDatabaseHost(adapter("postgres"), marked({ host: "db.internal" }))).rejects.toThrow("db.internal is 10.0.0.5");
    });

    it("lay PGHOSTADDR over the environment of every command of the call, the password kept", async () => {
        const dumpOne = vi.fn(async (_config: unknown, _db: string, _path: string, host: { exec(argv: string[], options?: object): Promise<unknown> }) => host.exec(["pg_dump"], { env: { PGPASSWORD: "pw" } }));
        const wrapped = withPinnedDatabaseHost({ ...(adapter("postgres") as object), dumpOne } as never);
        const envs: unknown[] = [];
        const host = createFakeHost({ kind: "direct", onExec: (_argv, options) => (envs.push(options?.env), undefined) });
        await wrapped.dumpOne!(marked({ host: "db.example.com" }) as never, "shop", "/tmp/x", host as never);
        expect(envs).toEqual([{ PGPASSWORD: "pw", PGHOSTADDR: "93.184.216.34" }]);
        expect(host.calls.exec).toEqual([["pg_dump"]]);
        // Another tenant's call gets the host as it is.
        await wrapped.dumpOne!({ host: "db.example.com" } as never, "shop", "/tmp/x", host as never);
        expect((dumpOne.mock.calls[1] as unknown[])[3]).toBe(host);
    });

    it("hand redis-cli the address and the name as the TLS server name", async () => {
        const pinned = (await pinDatabaseHost(adapter("redis"), marked({ host: "db.example.com", port: 6379, tls: true }))).config as never;
        expect(redisArgs(pinned)).toEqual(["-h", "93.184.216.34", "-p", "6379", "--tls", "--sni", "db.example.com"]);
    });

    it("pin Firebird and a single MongoDB host with their ports, an IPv6 address in brackets", async () => {
        const hostOf = async (id: string, config: object) => ((await pinDatabaseHost(adapter(id), marked(config))).config as Record<string, unknown>).host;
        expect(await hostOf("firebird", { host: "v6.example.com/3051" })).toBe("[2606:4700::1111]/3051");
        expect(await hostOf("mongodb", { host: "db.example.com:27018" })).toBe("93.184.216.34:27018");
    });

    it("leave the MongoDB host its name when its options turn TLS on, whose certificate the tools check against it", async () => {
        for (const config of [{ host: "db.example.com", options: "--tls" }, { host: "db.example.com", options: "--ssl --sslCAFile=/x" }]) {
            expect(((await pinDatabaseHost(adapter("mongodb"), marked(config))).config as Record<string, unknown>).host, JSON.stringify(config)).toBe(config.host);
        }
    });

    it("pin a MongoDB host in every spelling the adapter reads as one host, so none of them dials the name", async () => {
        const hostOf = async (host: string) => ((await pinDatabaseHost(adapter("mongodb"), marked({ host, port: 27017 }))).config as Record<string, unknown>).host;
        // The parser of the adapter cuts a path, a query, a user part and a scheme off, and the pin reads it the same way.
        for (const host of ["db.example.com", "db.example.com/", "x@db.example.com", "mongodb://db.example.com", "db.example.com/?tls=true", "mongodb://u:p@db.example.com/admin?ssl=true"]) {
            expect(await hostOf(host), host).toBe("93.184.216.34:27017");
        }
        expect(await hostOf("db.example.com:27018/")).toBe("93.184.216.34:27018");
        expect(await hostOf("v6.example.com/")).toBe("[2606:4700::1111]:27017");
        // A name that leads into the blocked network at connect time is refused in every spelling too.
        for (const host of ["db.internal/", "x@db.internal", "mongodb://db.internal", "db.internal/?tls=true"]) {
            await expect(hostOf(host), host).rejects.toThrow("db.internal is 10.0.0.5");
        }
    });

    it("refuse a host that is no text instead of leaving it unpinned, which a tool would read as its text", async () => {
        for (const id of ["redis", "valkey", "mysql", "mongodb", "postgres", "firebird"]) {
            await expect(pinDatabaseHost(adapter(id), marked({ host: ["127.0.0.1"], disableSsl: true })), id).rejects.toThrow("is no text");
        }
        expect(() => redisArgs({ host: ["127.0.0.1"], port: 6379 } as never)).toThrow("is no text");
    });

    it("lets the forward of an SSH tunnel carry SQL Server for every tenant through its own dial alone", async () => {
        const dialTunnel = vi.fn(async () => net.connect({ host: "127.0.0.1", port }));
        const open = tdsConnector("127.0.0.1", true, null, dialTunnel)!;
        const socket = await open({ host: "127.0.0.1", port: 15001 }, null, new AbortController().signal);
        socket.destroy();
        expect(dialTunnel).toHaveBeenCalledTimes(1);
        const blocked = tdsConnector("127.0.0.1", true, blocking, dialTunnel)!;
        await expect(blocked({ host: "redirect.internal", port: 1433 }, null, new AbortController().signal)).rejects.toThrow("outside the SSH tunnel");
        expect(dialTunnel).toHaveBeenCalledTimes(1);
    });

    it("pin MySQL and MariaDB only with TLS off, where no certificate is checked against the name", async () => {
        expect(((await pinDatabaseHost(adapter("mysql"), marked({ host: "db.example.com", disableSsl: true }))).config as Record<string, unknown>).host).toBe("93.184.216.34");
        expect(((await pinDatabaseHost(adapter("mariadb"), marked({ host: "db.example.com" }))).config as Record<string, unknown>).host).toBe("db.example.com");
    });

    it("leave the host alone in SSH mode, for a config without the policy and for an adapter without a pin", async () => {
        const ssh = marked({ host: "db.internal", connectionMode: "ssh", sshHost: "jump.example.com", sshUsername: "u" });
        expect(await pinDatabaseHost(adapter("postgres"), ssh)).toEqual({ config: ssh });
        const open = { host: "db.internal" };
        expect((await pinDatabaseHost(adapter("postgres"), open)).config).toBe(open);
        expect((await pinDatabaseHost(adapter("sqlite"), marked({ host: "db.internal" }))).config).toEqual(expect.objectContaining({ host: "db.internal" }));
        expect(lookup).not.toHaveBeenCalled();
    });

    it("go through the adapter, whose test answers a refusal like a failed connection", async () => {
        const dumpOne = vi.fn(async () => ({ success: true }));
        const wrapped = withPinnedDatabaseHost({ ...(adapter("redis") as object), dumpOne, test: async () => ({ success: true, message: "ok" }) } as never);
        await wrapped.dumpOne!(marked({ host: "db.example.com" }) as never, "shop", "/tmp/x", {} as never);
        expect((dumpOne.mock.calls[0] as unknown[])[0]).toEqual(expect.objectContaining({ host: "93.184.216.34" }));
        await expect(wrapped.test!(marked({ host: "db.internal" }) as never, {} as never)).resolves.toEqual({ success: false, message: expect.stringContaining("db.internal is 10.0.0.5") });
    });
});

/** A TCP server on 127.0.0.1 alone, so 127.0.0.2 on the same port refuses. */
let server: net.Server;
let port: number;

beforeAll(async () => {
    server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
});

const loopback = { allowed: toRanges(["127.0.0.0/8"]) };

describe("the connector of SQL Server", () => {
    const signal = () => new AbortController().signal;

    it("is none for a tenant that blocks nothing, so tedious dials as before", () => {
        expect(tdsConnector("sql.example.com", false, null)).toBeUndefined();
    });

    it("refuses a routing redirect that would leave the SSH tunnel", async () => {
        const connect = tdsConnector("127.0.0.1", true, blocking)!;
        await expect(connect({ host: "redirect.internal", port: 1433 }, null, signal())).rejects.toThrow("SQL Server redirected the connection to redirect.internal:1433, which lies outside the SSH tunnel");
        const socket = await connect({ host: "127.0.0.1", port }, null, signal());
        socket.destroy();
    });

    it("checks the dialed host and a redirect target directly, each at connect time", async () => {
        const connect = tdsConnector("sql.example.com", false, blocking)!;
        await expect(connect({ host: "redirect.internal", port: 1433 }, null, signal())).rejects.toThrow("redirect.internal is 10.0.0.9");
        const allowed = tdsConnector("loop.example.com", false, { allowed: toRanges(["127.0.0.0/8"]) })!;
        const socket = await allowed({ host: "loop.example.com", port }, null, signal());
        expect(socket.remoteAddress).toBe("127.0.0.1");
        socket.destroy();
    });
});

describe("the storage and channel clients", () => {
    it("let ssh dial the checked address bare, and rsync's path put an IPv6 address in brackets", async () => {
        await expect(pinRsyncHost(marked({ host: "db.example.com" }))).resolves.toEqual(expect.objectContaining({ dialAddress: "93.184.216.34" }));
        await expect(pinRsyncHost(marked({ host: "v6.example.com" }))).resolves.toEqual(expect.objectContaining({ dialAddress: "2606:4700::1111" }));
        const v6 = { host: "v6.example.com", username: "backup", dialAddress: "2606:4700::1111" } as never;
        expect(sshTarget(v6)).toBe("backup@2606:4700::1111");
        expect(sshTarget(v6, true)).toBe("backup@[2606:4700::1111]");
        const plain = { host: "db.internal" };
        await expect(pinRsyncHost(plain)).resolves.toBe(plain);
        const wrapped = withPinnedRsyncHost({ id: "rsync", test: async () => ({ success: true, message: "ok" }) } as never);
        await expect(wrapped.test!(marked({ host: "db.internal" }) as never)).resolves.toEqual({ success: false, message: expect.stringContaining("db.internal is 10.0.0.5") });
    });

    it("fall back to the next checked address of a name when the first does not answer", async () => {
        await expect(pinRsyncHost(marked({ host: "multi.example.com", port }, loopback))).resolves.toEqual(expect.objectContaining({ dialAddress: "127.0.0.1" }));
        const pinned = await pinDatabaseHost(adapter("postgres"), marked({ host: "multi.example.com", port }, loopback));
        expect(pinned.env).toEqual({ PGHOSTADDR: "127.0.0.1" });
    });

    it("give smbclient and rpcclient the checked address of the server as -I", async () => {
        await expect(smbAddressOptions(marked({ address: "//db.example.com/backups" }))).resolves.toEqual(["-I", "93.184.216.34"]);
        await expect(smbAddressOptions(marked({ address: "//db.internal/backups" }))).rejects.toThrow("db.internal is 10.0.0.5");
        await expect(smbAddressOptions({ address: "//db.internal/backups" })).resolves.toEqual([]);
    });

    it("hand nodemailer a socket to a checked address and keep the name for TLS", async () => {
        await EmailAdapter.send(marked({ host: "multi.example.com", port, secure: "starttls", from: "a@example.com", to: "b@example.com" }, loopback), "hi");
        const options = (createTransport.mock.calls[0] as unknown[])[0] as { host: string; getSocket: (o: unknown, cb: (e: Error | null, s?: { connection: net.Socket }) => void) => void };
        expect(options.host).toBe("multi.example.com");
        const socket = await new Promise<net.Socket>((resolve, reject) => options.getSocket({}, (error, result) => (error ? reject(error) : resolve(result!.connection))));
        expect(socket.remoteAddress).toBe("127.0.0.1");
        socket.destroy();
        await EmailAdapter.send({ host: "smtp.internal", port: 25, secure: "none", from: "a@example.com", to: "b@example.com" }, "hi");
        expect(createTransport).toHaveBeenLastCalledWith(expect.not.objectContaining({ getSocket: expect.anything() }));
    });

    it("connect FTP to the checked address with the name for FTPS, and SFTP over a checked socket", async () => {
        await FTPAdapter.list(marked({ host: "db.example.com", port: 21, username: "u", password: "p", tls: true, pathPrefix: "" }) as never, "");
        expect(ftpAccess).toHaveBeenCalledWith(expect.objectContaining({ host: "93.184.216.34", secureOptions: expect.objectContaining({ servername: "db.example.com", host: "db.example.com" }) }));
        await SFTPAdapter.list(marked({ host: "multi.example.com", port, username: "u", password: "p", pathPrefix: "" }, loopback) as never, "");
        const options = sftpConnect.mock.calls[0][0] as { host: string; sock: net.Socket };
        expect(options.host).toBe("multi.example.com");
        expect(options.sock.remoteAddress).toBe("127.0.0.1");
        options.sock.destroy();
    });
});
