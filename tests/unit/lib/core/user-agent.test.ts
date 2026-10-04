import { describe, expect, it } from "vitest";
import { describeAgent, formatIpAddress, parseUserAgent } from "@/lib/core/user-agent";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0";
const WINDOWS_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";

describe("reading where a sign-in came from", () => {
    it("names an iPhone as iOS, though its agent mentions Mac OS X", () => {
        expect(parseUserAgent(IPHONE)).toEqual({ browser: "Safari", os: "iOS", device: "mobile" });
    });

    it("tells Edge from the Chrome it is built on", () => {
        expect(parseUserAgent(WINDOWS_EDGE)).toEqual({ browser: "Edge", os: "Windows", device: "desktop" });
    });

    it("says the browser and the system in a few words, or what of it is known", () => {
        expect(describeAgent(parseUserAgent(MAC_FIREFOX))).toBe("Firefox on macOS");
        expect(describeAgent(parseUserAgent("curl/8.7.1"))).toBeNull();
        expect(describeAgent(parseUserAgent(null))).toBeNull();
    });

    it("shows the loopback addresses as localhost and shortens IPv6", () => {
        expect(formatIpAddress("0000:0000:0000:0000:0000:0000:0000:0001")).toBe("localhost");
        expect(formatIpAddress("2001:0db8:0000:0000:0000:0000:0000:0042")).toBe("2001:db8::42");
        expect(formatIpAddress("10.0.4.21")).toBe("10.0.4.21");
        expect(formatIpAddress(null)).toBe("");
    });
});
