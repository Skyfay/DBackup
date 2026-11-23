import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ADDRESS_HEADER, clientAddress, rateLimitKey, withoutClientAddress } from "@/lib/core/client-address";

describe("the address of a request in the app", () => {
    beforeEach(() => vi.stubEnv("DBACKUP_CUSTOM_SERVER", "1"));
    afterEach(() => vi.unstubAllEnvs());

    it("comes from the header the custom server sets", () => {
        expect(clientAddress(new Headers({ [CLIENT_ADDRESS_HEADER]: "203.0.113.7" }))).toBe("203.0.113.7");
        expect(withoutClientAddress(new Headers({ [CLIENT_ADDRESS_HEADER]: "203.0.113.7" }))).toBeNull();
    });

    it("never comes from X-Forwarded-For or X-Real-IP, which a client sets as it likes", () => {
        expect(clientAddress(new Headers({ "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.1" }))).toBeNull();
    });

    // Under `next start` or `pnpm dev` nothing replaces the header, so its value is the client's own.
    it("is unknown without the custom server, and the header never reaches the app", () => {
        vi.stubEnv("DBACKUP_CUSTOM_SERVER", "");
        const sent = new Headers({ [CLIENT_ADDRESS_HEADER]: "198.51.100.1", "user-agent": "curl" });
        expect(clientAddress(sent)).toBeNull();
        const kept = withoutClientAddress(sent);
        expect(kept?.has(CLIENT_ADDRESS_HEADER)).toBe(false);
        expect(kept?.get("user-agent")).toBe("curl");
        expect(withoutClientAddress(new Headers({ "user-agent": "curl" }))).toBeNull();
    });
});

describe("the key of an address for the rate limits", () => {
    it("is an IPv4 address itself", () => {
        expect(rateLimitKey("203.0.113.7")).toBe("203.0.113.7");
    });

    it("is the /64 network of an IPv6 address, so a client cannot take a new address for every request", () => {
        expect(rateLimitKey("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3:8d3::/64");
        expect(rateLimitKey("2001:db8:85a3:8d3::1")).toBe(rateLimitKey("2001:db8:85a3:8d3:ffff::2"));
        expect(rateLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
        expect(rateLimitKey("::1")).toBe("0:0:0:0::/64");
    });
});
