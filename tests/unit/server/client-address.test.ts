// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CLIENT_ADDRESS_HEADER as SERVER_HEADER, clientAddressOf, normalizeAddress, trustedProxiesFrom } from "../../../server/client-address";
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

    it("takes X-Real-IP from a trusted proxy that sets only that one", () => {
        expect(clientAddressOf("127.0.0.1", undefined, "203.0.113.7", defaults)).toBe("203.0.113.7");
        expect(clientAddressOf("127.0.0.1", undefined, "203.0.113.7, 198.51.100.1", defaults)).toBe("127.0.0.1");
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

    it("refuses an entry of TRUSTED_PROXIES that is no address or range", () => {
        expect(() => trustedProxiesFrom("10.0.0.0/8, nginx")).toThrow(/"nginx" is no IP address or CIDR range/);
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
});
