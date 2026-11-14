// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defaultTrustNotice, proxyHeaderFrom, trustedProxiesFrom } from "../../../server/client-address";

/**
 * With TRUSTED_PROXIES unset a device of a private network that reaches DBackup directly names its
 * own address in X-Forwarded-For. The server cannot tell it from a reverse proxy, so it says once
 * which setting pins the proxy and which one reads no forwarded header.
 */
describe("the line about a forwarded header that counts by the default alone", () => {
    const noticeFor = (setting: string | undefined, header?: string) => defaultTrustNotice(setting, trustedProxiesFrom(setting), proxyHeaderFrom(header));

    it("names the private peer and both settings the first time, and stays quiet afterwards", () => {
        const notice = noticeFor(undefined);
        const line = notice("::ffff:192.168.1.50", "1.2.3.4", undefined);
        expect(line).toContain("X-Forwarded-For of 192.168.1.50");
        expect(line).toContain("TRUSTED_PROXIES=192.168.1.50");
        expect(line).toContain("TRUSTED_PROXIES=none");
        expect(notice("192.168.1.50", "5.6.7.8", undefined)).toBeNull();
        expect(notice("10.0.0.9", "5.6.7.8", undefined)).toBeNull();
    });

    it("waits for a request whose header really counts", () => {
        const notice = noticeFor("  ");
        // No header, a peer on the internet whose header is ignored, and the header the setting does not read.
        expect(notice("192.168.1.50", undefined, undefined)).toBeNull();
        expect(notice("203.0.113.9", "1.2.3.4", undefined)).toBeNull();
        expect(notice("192.168.1.50", undefined, "1.2.3.4")).toBeNull();
        expect(notice("172.17.0.1", ["1.2.3.4"], undefined)).toContain("172.17.0.1");
    });

    it("names X-Real-IP when that is the header of the proxy", () => {
        const notice = noticeFor(undefined, "x-real-ip");
        expect(notice("127.0.0.1", "1.2.3.4", undefined)).toBeNull();
        expect(notice("127.0.0.1", undefined, "1.2.3.4")).toContain("X-Real-IP of 127.0.0.1");
    });

    it.each(["none", "private", "10.0.0.5", "private,cloudflare"])("says nothing once TRUSTED_PROXIES is set to %s", (setting) => {
        const notice = noticeFor(setting);
        expect(notice("10.0.0.5", "1.2.3.4", undefined)).toBeNull();
        expect(notice("192.168.1.50", "1.2.3.4", undefined)).toBeNull();
    });
});
