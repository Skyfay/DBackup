// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_ADDRESS_HEADER as SERVER_HEADER, CLOUDFLARE_RANGES, CUSTOM_SERVER_MARK, clientAddressOf, normalizeAddress, proxyHeaderFrom, trustedProxiesFrom } from "../../../server/client-address";
import { CLIENT_ADDRESS_HEADER as APP_HEADER } from "@/lib/core/client-address";

const defaults = trustedProxiesFrom(undefined);

describe("the address of a client", () => {
    it("is the peer of the socket when nothing stands in front of DBackup", () => {
        expect(clientAddressOf("203.0.113.7", undefined, undefined, defaults)).toBe("203.0.113.7");
    });

    it("ignores X-Forwarded-For and X-Real-IP from a peer that is no trusted proxy", () => {
        // The attack: a client on the internet names another address on every request.
        expect(clientAddressOf("203.0.113.7", "198.51.100.1", undefined, defaults)).toBe("203.0.113.7");
        expect(clientAddressOf("203.0.113.7", undefined, "198.51.100.1", defaults)).toBe("203.0.113.7");
    });

    it("is the entry a proxy in a private network appended, not the one a client put in front", () => {
        expect(clientAddressOf("172.18.0.2", "203.0.113.7", undefined, defaults)).toBe("203.0.113.7");
        // The client sent "198.51.100.1" itself, the proxy appended the address it saw.
        expect(clientAddressOf("172.18.0.2", "198.51.100.1, 203.0.113.7", undefined, defaults)).toBe("203.0.113.7");
        expect(clientAddressOf("::ffff:172.18.0.2", ["198.51.100.1", "203.0.113.7"], undefined, defaults)).toBe("203.0.113.7");
    });

    it("walks past every trusted proxy of a chain", () => {
        expect(clientAddressOf("172.18.0.2", "203.0.113.7, 10.0.0.5", undefined, defaults)).toBe("203.0.113.7");
    });

    it("is the client in the LAN when every hop is a private network", () => {
        expect(clientAddressOf("172.18.0.2", "192.168.1.50", undefined, defaults)).toBe("192.168.1.50");
    });

    it("takes X-Real-IP from a trusted proxy that sets only that one, with TRUSTED_PROXY_HEADER=x-real-ip", () => {
        const realIp = proxyHeaderFrom("x-real-ip");
        expect(clientAddressOf("127.0.0.1", undefined, "203.0.113.7", defaults, realIp)).toBe("203.0.113.7");
        expect(clientAddressOf("127.0.0.1", undefined, "203.0.113.7, 198.51.100.1", defaults, realIp)).toBe("127.0.0.1");
        expect(clientAddressOf("127.0.0.1", undefined, undefined, defaults, realIp)).toBe("127.0.0.1");
    });

    it("ignores an X-Forwarded-For a client sent through a proxy that sets only X-Real-IP", () => {
        // The attack: the proxy passes the client's own X-Forwarded-For on, which names another address on every request.
        expect(clientAddressOf("172.18.0.2", "198.51.100.1", "203.0.113.7", defaults, "x-real-ip")).toBe("203.0.113.7");
        expect(clientAddressOf("172.18.0.2", "198.51.100.2", undefined, defaults, "x-real-ip")).toBe("172.18.0.2");
    });

    it("ignores an X-Real-IP a client sent through a proxy that appends to X-Forwarded-For", () => {
        expect(clientAddressOf("172.18.0.2", "198.51.100.1, 203.0.113.7", "198.51.100.9", defaults)).toBe("203.0.113.7");
        // Without the header of the setting the address is the proxy's, never the other header.
        expect(clientAddressOf("172.18.0.2", undefined, "198.51.100.9", defaults)).toBe("172.18.0.2");
    });

    it("reads X-Forwarded-For unless TRUSTED_PROXY_HEADER names X-Real-IP, and refuses any other value", () => {
        expect(proxyHeaderFrom(undefined)).toBe("x-forwarded-for");
        expect(proxyHeaderFrom(" ")).toBe("x-forwarded-for");
        expect(proxyHeaderFrom("X-Real-IP")).toBe("x-real-ip");
        expect(() => proxyHeaderFrom("forwarded")).toThrow(/"forwarded" is none of x-forwarded-for, x-real-ip/);
    });

    it("stops at an entry that is no address, which no proxy wrote", () => {
        expect(clientAddressOf("172.18.0.2", "not-an-address", undefined, defaults)).toBe("172.18.0.2");
        expect(clientAddressOf("172.18.0.2", "203.0.113.7, unknown, 10.0.0.5", undefined, defaults)).toBe("10.0.0.5");
    });

    it("trusts only the proxies TRUSTED_PROXIES names", () => {
        const only = trustedProxiesFrom("10.0.0.5, 2001:db8::/32");
        expect(clientAddressOf("172.18.0.2", "203.0.113.7", undefined, only)).toBe("172.18.0.2");
        expect(clientAddressOf("10.0.0.5", "203.0.113.7", undefined, only)).toBe("203.0.113.7");
        expect(clientAddressOf("2001:db8::1", "2001:db8:1::9, 2a00:1450::1", undefined, only)).toBe("2a00:1450::1");
    });

    it("reads no forwarded header at all with TRUSTED_PROXIES=none", () => {
        expect(clientAddressOf("127.0.0.1", "203.0.113.7", "203.0.113.7", trustedProxiesFrom("none"))).toBe("127.0.0.1");
    });

    it("trusts the edge servers of Cloudflare with TRUSTED_PROXIES=cloudflare", () => {
        const cloudflare = trustedProxiesFrom("cloudflare");
        expect(clientAddressOf("104.16.1.1", "203.0.113.7", undefined, cloudflare)).toBe("203.0.113.7");
        expect(clientAddressOf("2606:4700::1", "2a00:1450::1", undefined, cloudflare)).toBe("2a00:1450::1");
        // A client that connects past Cloudflare cannot pose as it.
        expect(clientAddressOf("198.51.100.1", "203.0.113.7", undefined, cloudflare)).toBe("198.51.100.1");
        // The keyword alone leaves out the private networks, as any list does.
        expect(clientAddressOf("172.18.0.2", "203.0.113.7", undefined, cloudflare)).toBe("172.18.0.2");
    });

    it("finds the client behind Cloudflare and a proxy in a private network with private,cloudflare", () => {
        // Cloudflare sends the address of the client, the proxy appends the edge server it saw.
        const chain = "203.0.113.7, 162.158.1.1";
        expect(clientAddressOf("172.18.0.2", chain, undefined, trustedProxiesFrom("private,cloudflare"))).toBe("203.0.113.7");
        expect(clientAddressOf("172.18.0.2", chain, undefined, defaults)).toBe("162.158.1.1");
    });

    it("takes the keywords in any case and beside addresses", () => {
        const mixed = trustedProxiesFrom(" Private , CLOUDFLARE, 198.51.100.9");
        expect(clientAddressOf("172.18.0.2", "203.0.113.7, 104.16.1.1", undefined, mixed)).toBe("203.0.113.7");
        expect(clientAddressOf("198.51.100.9", "203.0.113.7", undefined, mixed)).toBe("203.0.113.7");
    });

    it("knows every range of Cloudflare as a valid IPv4 or IPv6 range", () => {
        expect(CLOUDFLARE_RANGES.filter((range) => !/^[\d.]+\/\d+$|^[\da-f:]+\/\d+$/.test(range))).toEqual([]);
        expect(() => trustedProxiesFrom("cloudflare")).not.toThrow();
    });

    it("refuses an entry of TRUSTED_PROXIES that is no address, range or keyword", () => {
        expect(() => trustedProxiesFrom("10.0.0.0/8, nginx")).toThrow(/"nginx" is no IP address, CIDR range or one of private, cloudflare/);
        expect(() => trustedProxiesFrom("constructor")).toThrow(/"constructor"/);
        expect(() => trustedProxiesFrom("10.0.0.0/33")).toThrow(/10\.0\.0\.0\/33/);
        expect(() => trustedProxiesFrom("10.0.0.0/x")).toThrow(/10\.0\.0\.0\/x/);
    });

    it("writes an IPv4 peer of a dual stack socket as IPv4", () => {
        expect(normalizeAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
        expect(normalizeAddress(" 2001:DB8::1 ")).toBe("2001:db8::1");
    });

    it("travels in the header the app reads", () => {
        expect(SERVER_HEADER).toBe(APP_HEADER);
    });

    it("is marked by the variable the app checks before it trusts the header", () => {
        expect(CUSTOM_SERVER_MARK).toBe("DBACKUP_CUSTOM_SERVER");
        expect(fs.readFileSync(path.resolve(__dirname, "../../../src/lib/core/client-address.ts"), "utf8")).toContain(`process.env.${CUSTOM_SERVER_MARK} === "1"`);
    });
});
