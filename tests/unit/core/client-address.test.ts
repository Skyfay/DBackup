import { describe, expect, it } from "vitest";
import { CLIENT_ADDRESS_HEADER, clientAddress, rateLimitKey } from "@/lib/core/client-address";

describe("the address of a request in the app", () => {
    it("comes from the header the custom server sets", () => {
        expect(clientAddress(new Headers({ [CLIENT_ADDRESS_HEADER]: "203.0.113.7" }))).toBe("203.0.113.7");
    });

    it("never comes from X-Forwarded-For or X-Real-IP, which a client sets as it likes", () => {
        expect(clientAddress(new Headers({ "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.1" }))).toBeNull();
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
