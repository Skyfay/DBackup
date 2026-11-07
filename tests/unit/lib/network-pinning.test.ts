// @vitest-environment node
/**
 * A connection of a tenant that blocks the local network dials an address checked at connect time,
 * not only a name the check of its config resolved before: the lookup of `reach-check.ts`, the
 * agents and `pinnedFetch` of `pinned-http.ts`, and the transport, which carries the policy of the
 * resolved config to its SSH and direct hosts.
 */
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns")>();
    const promises = { ...actual.promises, lookup };
    return { ...actual, default: { ...actual, promises }, promises };
});

const sshConnects = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("ssh2", () => ({
    Client: class {
        private handlers: Record<string, () => void> = {};
        once(event: string, handler: () => void) {
            this.handlers[event] = handler;
            return this;
        }
        removeListener() {
            return this;
        }
        connect(config: Record<string, unknown>) {
            sshConnects.push(config);
            queueMicrotask(() => this.handlers.ready?.());
        }
    },
    utils: {},
}));

const { BlockedAddressError, UnresolvedHostError, checkedAddresses, checkedLookup, firstBlockedAddress } = await import("@/lib/network/reach-check");
const { guardAgent, pinnedFetch } = await import("@/lib/network/pinned-http");
const { checkedSocket, reachableAddress } = await import("@/lib/network/checked-socket");
const { markReach, reachOf } = await import("@/lib/network/reach-policy");
const { toRanges } = await import("@/lib/network/local-network");
const { webhookFetch } = await import("@/lib/adapters/notification/http");
const { openSshClient } = await import("@/lib/transport/ssh-connection");
const { resolveTransport, standardTransport } = await import("@/lib/transport/spec");
const { DirectHost } = await import("@/lib/transport/direct-host");
const { markLocalNetwork, blocksLocalNetwork } = await import("@/lib/adapters/network-fact");

/** What the resolver answers per name, a name it does not know does not resolve. */
let dns: Record<string, string[]>;

const blocking = { allowed: [] };
const loopbackAllowed = { allowed: toRanges(["127.0.0.0/8"]) };

beforeEach(() => {
    dns = {
        "public.example.com": ["93.184.216.34"],
        "db.internal": ["10.0.0.5"],
        "dual.example.com": ["93.184.216.34", "fd00::7"],
        "hook.example.com": ["127.0.0.1"],
        "multi.example.com": ["127.0.0.2", "127.0.0.1"],
    };
    lookup.mockReset();
    lookup.mockImplementation(async (host: string) => {
        const addresses = dns[host];
        if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
        return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    });
    sshConnects.length = 0;
});

describe("the check at connect time", () => {
    it("answers with every address of a name once each lies outside the blocked local network", async () => {
        await expect(checkedAddresses("public.example.com", [])).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
        await expect(checkedAddresses("db.internal", toRanges(["10.0.0.0/24"]))).resolves.toEqual([{ address: "10.0.0.5", family: 4 }]);
    });

    it("refuses a name with any address of the local network, and a literal of it", async () => {
        await expect(checkedAddresses("db.internal", [])).rejects.toBeInstanceOf(BlockedAddressError);
        await expect(checkedAddresses("dual.example.com", [])).rejects.toThrow("dual.example.com is fd00::7, which lies in the local network this tenant does not reach.");
        await expect(checkedAddresses("[::1]", [])).rejects.toThrow("::1 lies in the local network");
        expect(lookup).toHaveBeenCalledTimes(2);
    });

    it("fails closed on a name that does not resolve, the check of a config too", async () => {
        await expect(checkedAddresses("nowhere.invalid", [])).rejects.toBeInstanceOf(UnresolvedHostError);
        await expect(firstBlockedAddress(["public.example.com", "nowhere.invalid"], [])).rejects.toThrow("nowhere.invalid does not resolve (ENOTFOUND)");
        lookup.mockResolvedValueOnce([]);
        await expect(checkedAddresses("empty.example.com", [])).rejects.toThrow("does not resolve (no address)");
    });

    it("gives net and tls a lookup that answers one or all checked addresses, by the family they ask", async () => {
        const answer = (host: string, options: object) => new Promise<unknown[]>((resolve) => {
            (checkedLookup([]) as unknown as (h: string, o: object, cb: (...args: unknown[]) => void) => void)(host, options, (...args) => resolve(args));
        });
        await expect(answer("public.example.com", {})).resolves.toEqual([null, "93.184.216.34", 4]);
        await expect(answer("public.example.com", { all: true })).resolves.toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
        const [noV6] = await answer("public.example.com", { family: 6 });
        expect((noV6 as Error).message).toContain("has no IPv6 address");
        const [refused] = await answer("db.internal", { all: true });
        expect(refused).toBeInstanceOf(BlockedAddressError);
    });
});

describe("HTTP with checked addresses", () => {
    let server: http.Server;
    let port: number;
    const seen: { host?: string; body: string; headers?: http.IncomingHttpHeaders }[] = [];

    beforeAll(async () => {
        server = http.createServer((request, response) => {
            let body = "";
            request.on("data", (chunk) => (body += chunk));
            request.on("end", () => {
                if (request.url === "/odd") {
                    request.socket.end("HTTP/1.1 999 Odd\r\ncontent-length: 0\r\n\r\n");
                    return;
                }
                if (request.url === "/slow") return;
                if (request.url === "/stall") {
                    response.writeHead(200);
                    response.write("part");
                    return;
                }
                seen.push({ host: request.headers.host, body, headers: request.headers });
                response.writeHead(request.url === "/moved" ? 302 : 200, { "content-type": "application/json", ...(request.url === "/moved" ? { location: "http://elsewhere.example.com/" } : {}) });
                response.end(JSON.stringify({ ok: true }));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    it("sends the request to the checked address and keeps the name for the Host header", async () => {
        seen.length = 0;
        const response = await pinnedFetch(`http://hook.example.com:${port}/hook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"text":"hi"}' }, loopbackAllowed);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
        expect(seen).toEqual([expect.objectContaining({ host: `hook.example.com:${port}`, body: '{"text":"hi"}' })]);
    });

    it("sends the defaults of fetch where the caller sets none", async () => {
        seen.length = 0;
        await (await pinnedFetch(`http://hook.example.com:${port}/hook`, { method: "POST", body: "plain" }, loopbackAllowed)).text();
        expect(seen[0].headers).toEqual(expect.objectContaining({ accept: "*/*", "user-agent": "node", "content-type": "text/plain;charset=UTF-8", "content-length": "5" }));
        seen.length = 0;
        await (await pinnedFetch(`http://hook.example.com:${port}/hook`, { headers: { Accept: "application/json", "User-Agent": "DBackup" } }, loopbackAllowed)).text();
        expect(seen[0].headers).toEqual(expect.objectContaining({ accept: "application/json", "user-agent": "DBackup" }));
    });

    it("fails a request whose status no Response holds instead of throwing past it", async () => {
        await expect(pinnedFetch(`http://hook.example.com:${port}/odd`, {}, loopbackAllowed)).rejects.toThrow("answered with status 999");
    });

    it("times out an answer that never comes and a body that stalls, like fetch", async () => {
        const timeouts = { connectMs: 1_000, headersMs: 50, bodyMs: 50 };
        await expect(pinnedFetch(`http://hook.example.com:${port}/slow`, {}, loopbackAllowed, timeouts)).rejects.toThrow("sent no answer within 0.05 seconds");
        const stalled = await pinnedFetch(`http://hook.example.com:${port}/stall`, {}, loopbackAllowed, timeouts);
        await expect(stalled.text()).rejects.toThrow();
    });

    it("honours an AbortSignal, before the send and while it waits", async () => {
        await expect(pinnedFetch(`http://hook.example.com:${port}/hook`, { signal: AbortSignal.abort() }, loopbackAllowed)).rejects.toThrow();
        const controller = new AbortController();
        const waiting = pinnedFetch(`http://hook.example.com:${port}/slow`, { signal: controller.signal }, loopbackAllowed);
        setTimeout(() => controller.abort(), 20);
        await expect(waiting).rejects.toThrow();
    });

    it("refuses a name that resolves into the local network at connect time, and a literal of it", async () => {
        await expect(pinnedFetch(`http://hook.example.com:${port}/hook`, {}, blocking)).rejects.toThrow("hook.example.com is 127.0.0.1");
        await expect(pinnedFetch(`http://127.0.0.1:${port}/hook`, {}, blocking)).rejects.toThrow("127.0.0.1 lies in the local network");
    });

    it("hands a redirect back as it is, which webhookFetch then refuses for another host", async () => {
        const response = await webhookFetch(`http://hook.example.com:${port}/moved`, { method: "POST", body: "x" }, loopbackAllowed);
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("http://elsewhere.example.com/");
    });

    it("leaves a channel of a tenant that blocks nothing on fetch as before", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
        try {
            await webhookFetch("https://hooks.example.com/x", { method: "POST" }, null);
            expect(fetchMock).toHaveBeenCalledWith("https://hooks.example.com/x", { method: "POST", redirect: "manual" });
        } finally {
            fetchMock.mockRestore();
        }
    });

    it("guards an agent of node:http the same way, for the webdav client and the S3 SDK", async () => {
        const agent = guardAgent(new http.Agent(), blocking);
        const failed = await new Promise<Error>((resolve) => {
            http.get({ host: "db.internal", port, agent }, () => resolve(new Error("answered"))).once("error", resolve);
        });
        expect(failed.message).toContain("db.internal is 10.0.0.5");
    });
});

describe("the policy on a resolved config", () => {
    it("is carried only for a tenant that blocks, under a symbol a spread keeps and JSON drops", () => {
        const config = markLocalNetwork({ host: "db.example.com" }, true, blocking);
        expect(reachOf(config)).toEqual(blocking);
        expect(reachOf({ ...config })).toEqual(blocking);
        expect(reachOf(JSON.parse(JSON.stringify(config)))).toBeNull();
        // The fact of `network-fact.ts` stays fail closed, the policy only ever adds a check.
        expect(blocksLocalNetwork({})).toBe(true);
        expect(reachOf({})).toBeNull();
        expect(reachOf(markLocalNetwork({}, false, null))).toBeNull();
    });

    it("goes into every host of the transport, and nowhere for a config without it", () => {
        const ssh = { connectionMode: "ssh", sshHost: "jump.example.com", sshUsername: "backup" };
        const direct = resolveTransport({ id: "postgres" }, markReach({ host: "db.example.com" }, blocking));
        expect(direct).toEqual({ kind: "direct", reach: blocking });
        const tunnel = resolveTransport({ id: "postgres" }, markReach({ ...ssh }, blocking));
        expect(tunnel.kind === "ssh" && tunnel.ssh.reach).toEqual(blocking);
        const composite = resolveTransport({ id: "mssql", transport: () => ({ kind: "composite", exec: { kind: "direct" }, files: standardTransport(ssh) }) }, markReach({}, blocking));
        expect(composite).toEqual({ kind: "composite", exec: { kind: "direct", reach: blocking }, files: { kind: "ssh", ssh: expect.objectContaining({ host: "jump.example.com", reach: blocking }) } });
        expect(resolveTransport({ id: "postgres" }, { host: "db.example.com" })).toEqual({ kind: "direct" });
    });

    it("hands ssh2 a socket to a checked address, the next one where the first refuses, and none in the local network", async () => {
        const server = net.createServer((socket) => socket.end());
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as AddressInfo).port;
        try {
            await openSshClient({ host: "multi.example.com", port, username: "backup", authType: "password", password: "pw", reach: loopbackAllowed });
            const sock = sshConnects[0].sock as net.Socket;
            expect(sshConnects[0].host).toBe("multi.example.com");
            expect(sock.remoteAddress).toBe("127.0.0.1");
            sock.destroy();
            const direct = await checkedSocket("multi.example.com", port, loopbackAllowed.allowed);
            expect(direct.remoteAddress).toBe("127.0.0.1");
            direct.destroy();
            await expect(reachableAddress("multi.example.com", port, loopbackAllowed.allowed)).resolves.toBe("127.0.0.1");
            await expect(checkedSocket("127.0.0.1", port, [])).rejects.toBeInstanceOf(BlockedAddressError);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
        await expect(openSshClient({ host: "db.internal", username: "backup", authType: "password", reach: blocking })).rejects.toThrow("db.internal is 10.0.0.5");
        expect(sshConnects).toHaveLength(1);
        // The home tenant and a tenant without the block dial the name as before.
        await openSshClient({ host: "db.internal", username: "backup", authType: "password" });
        expect(sshConnects[1]).toEqual(expect.objectContaining({ host: "db.internal" }));
        expect(sshConnects[1].sock).toBeUndefined();
    });

    it("lets a direct host connect only to a checked address", async () => {
        await expect(new DirectHost(blocking).connect("db.internal", 3050)).rejects.toThrow("db.internal is 10.0.0.5");
        await expect(new DirectHost(blocking).connect("127.0.0.1", 3050)).rejects.toBeInstanceOf(BlockedAddressError);
    });
});
