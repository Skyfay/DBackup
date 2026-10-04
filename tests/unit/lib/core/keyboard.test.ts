// @vitest-environment node
import { describe, expect, it } from "vitest";
import { usesAppleKeys } from "@/lib/core/keyboard";

const request = (entries: Record<string, string>) => new Headers(entries);

describe("which keys the search shows", () => {
    it("trusts the platform a Chromium browser names", () => {
        expect(usesAppleKeys(request({ "sec-ch-ua-platform": '"macOS"', "user-agent": "Windows NT 10.0" }))).toBe(true);
        expect(usesAppleKeys(request({ "sec-ch-ua-platform": '"iOS"' }))).toBe(true);
        expect(usesAppleKeys(request({ "sec-ch-ua-platform": '"Windows"', "user-agent": "Macintosh" }))).toBe(false);
        expect(usesAppleKeys(request({ "sec-ch-ua-platform": '"Linux"' }))).toBe(false);
    });

    it("reads the user agent of Safari and Firefox, which name no platform", () => {
        expect(usesAppleKeys(request({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15" }))).toBe(true);
        expect(usesAppleKeys(request({ "user-agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" }))).toBe(true);
        expect(usesAppleKeys(request({ "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0" }))).toBe(false);
        expect(usesAppleKeys(request({}))).toBe(false);
    });
});
