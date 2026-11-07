// @vitest-environment node
import { isIP } from "node:net";
import { describe, expect, it } from "vitest";
import {
    cleanRanges,
    formatAddress,
    isAddressLiteral,
    isBlockedAddress,
    isLocalAddress,
    LOCAL_NETWORK,
    parseAddress,
    parseCidr,
    rangesOfColumn,
    toRanges,
} from "@/lib/network/local-network";

const local = (text: string) => {
    const address = parseAddress(text);
    if (!address) throw new Error(`${text} did not read as an address`);
    return isLocalAddress(address);
};

const rangeText = (text: string) => {
    const parsed = parseCidr(text);
    return parsed.ok ? parsed.text : parsed.error;
};

describe("the local network of the server DBackup runs on", () => {
    it("counts loopback, this network, private, link-local with cloud metadata, the shared space of VPNs, multicast and broadcast", () => {
        for (const address of ["127.0.0.1", "127.255.0.9", "0.0.0.0", "0.1.2.3", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "100.100.30.1", "100.127.255.254", "224.0.0.251", "239.1.2.3", "255.255.255.255"]) {
            expect(local(address), address).toBe(true);
        }
    });

    it("leaves public IPv4 addresses alone, also right beside the private ranges", () => {
        for (const address of ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.167.1.1", "169.253.1.1", "11.0.0.1", "126.255.255.255", "223.255.255.255"]) {
            expect(local(address), address).toBe(false);
        }
    });

    it("counts IPv6 loopback, the unspecified address, unique local, link-local with a zone, and multicast", () => {
        for (const address of ["::1", "::", "fd00::5", "fc12:3456::1", "fe80::1", "fe80::1%eth0", "febf::1", "fec0::1", "ff02::1", "[::1]"]) {
            expect(local(address), address).toBe(true);
        }
    });

    it("leaves public IPv6 addresses alone", () => {
        for (const address of ["2001:4860:4860::8888", "2606:4700::1111", "fe00::1", "fbff::1"]) {
            expect(local(address), address).toBe(false);
        }
    });

    it("checks an IPv4 address inside IPv6, mapped or through NAT64, as its IPv4", () => {
        expect(local("::ffff:10.0.0.1")).toBe(true);
        expect(local("::ffff:a00:1")).toBe(true);
        expect(local("::ffff:127.0.0.1")).toBe(true);
        expect(local("64:ff9b::a00:5")).toBe(true);
        expect(local("::ffff:8.8.8.8")).toBe(false);
        expect(local("64:ff9b::808:808")).toBe(false);
    });

    it("lists only ranges that read, every one of them local", () => {
        for (const { range } of LOCAL_NETWORK) {
            const parsed = parseCidr(range);
            expect(parsed.ok, range).toBe(true);
            if (parsed.ok) expect(isLocalAddress(parsed.range), range).toBe(true);
        }
    });
});

describe("an address literal", () => {
    it("reads the same as isIP of node:net, which the connections use", () => {
        const samples = [
            "127.0.0.1", "255.255.255.255", "256.0.0.1", "01.2.3.4", "1.2.3", "1.2.3.4.5", "1..2.3", " 1.2.3.4", "a.b.c.d", "-1.2.3.4",
            "::", "::1", "1::", "1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7::", "::2:3:4:5:6:7:8", "1::2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1::2::3", ":1:2:3:4:5:6:7",
            "1:2:3:4:5:6:1.2.3.4", "::ffff:1.2.3.4", "::1.2.3.4", "1:2:3:4:5:6:7:1.2.3.4", "fffff::1", "g::1", "FE80::ABCD", "::ffff:256.1.1.1", "", "localhost", "db.example.com",
        ];
        for (const sample of samples) {
            // Both sides trim, like a host field of a config.
            expect(isAddressLiteral(sample), JSON.stringify(sample)).toBe(isIP(sample.trim()) !== 0);
        }
    });

    it("writes IPv6 short, the longest run of zero groups as two colons", () => {
        const short = (text: string) => formatAddress(parseAddress(text)!);
        expect(short("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
        expect(short("0:0:0:0:0:0:0:0")).toBe("::");
        expect(short("1:0:0:2:0:0:0:3")).toBe("1:0:0:2::3");
        expect(short("1:2:3:4:5:6:7:0")).toBe("1:2:3:4:5:6:7:0");
        expect(short("10.0.0.1")).toBe("10.0.0.1");
    });
});

describe("a range the platform allows", () => {
    it("reads IPv4 and IPv6 ranges and gives their short form", () => {
        expect(rangeText("10.10.10.0/24")).toBe("10.10.10.0/24");
        expect(rangeText(" 10.0.0.0/8 ")).toBe("10.0.0.0/8");
        expect(rangeText("fd00:1:0::/64")).toBe("fd00:1::/64");
        expect(rangeText("FD00:0001::/48")).toBe("fd00:1::/48");
        expect(rangeText("0.0.0.0/0")).toBe("0.0.0.0/0");
    });

    it("reads a single address as the range of itself", () => {
        expect(rangeText("10.0.0.5")).toBe("10.0.0.5/32");
        expect(rangeText("10.0.0.5/32")).toBe("10.0.0.5/32");
        expect(rangeText("fd00::5")).toBe("fd00::5/128");
    });

    it("reads a mapped IPv4 range as its IPv4", () => {
        expect(rangeText("::ffff:10.0.0.0/104")).toBe("10.0.0.0/8");
        expect(rangeText("::ffff:10.0.0.5/128")).toBe("10.0.0.5/32");
    });

    it("refuses anything malformed and says why", () => {
        expect(rangeText("")).toBe("Enter a range like 10.10.10.0/24.");
        expect(rangeText("10.0.0.0/33")).toBe("The prefix of 10.0.0.0/33 is no number from 0 to 32.");
        expect(rangeText("fd00::/129")).toBe("The prefix of fd00::/129 is no number from 0 to 128.");
        expect(rangeText("10.0.0.0/")).toContain("is no number");
        expect(rangeText("10.0.0.0/08")).toContain("is no number");
        expect(rangeText("10.0.0.0/-1")).toContain("is no number");
        expect(rangeText("10.0.0.0/24/8")).toContain("is no range");
        expect(rangeText("10.0.0/24")).toBe("10.0.0 is no IPv4 or IPv6 address.");
        expect(rangeText("db.internal/24")).toContain("is no IPv4 or IPv6 address");
        expect(rangeText("[fd00::]/64")).toContain("is no IPv4 or IPv6 address");
        expect(rangeText("fe80::%eth0/64")).toContain("is no IPv4 or IPv6 address");
        expect(rangeText("/24")).toContain("is no IPv4 or IPv6 address");
    });

    it("refuses bits set after the prefix and names the start of the network", () => {
        expect(rangeText("10.10.10.5/24")).toBe("10.10.10.5/24 has bits set after its prefix. Did you mean 10.10.10.0/24?");
        expect(rangeText("fd00::1/64")).toBe("fd00::1/64 has bits set after its prefix. Did you mean fd00::/64?");
        expect(rangeText("10.10.11.0/23")).toContain("Did you mean 10.10.10.0/23?");
        expect(rangeText("10.10.10.0/23")).toBe("10.10.10.0/23");
    });

    it("lets an address of the local network through only inside an allowed range", () => {
        const allowed = toRanges(["10.10.10.0/24", "fd00:1::/64", "127.0.0.1/32"]);
        expect(isBlockedAddress("10.10.10.7", allowed)).toBe(false);
        expect(isBlockedAddress("10.10.11.7", allowed)).toBe(true);
        expect(isBlockedAddress("::ffff:10.10.10.7", allowed)).toBe(false);
        expect(isBlockedAddress("fd00:1::9", allowed)).toBe(false);
        expect(isBlockedAddress("fd00:2::9", allowed)).toBe(true);
        expect(isBlockedAddress("127.0.0.1", allowed)).toBe(false);
        expect(isBlockedAddress("127.0.0.2", allowed)).toBe(true);
        // A public address is never blocked, a name is no address.
        expect(isBlockedAddress("8.8.8.8", [])).toBe(false);
        expect(isBlockedAddress("db.internal", [])).toBe(false);
    });

    it("keeps the column of a tenant to the ranges that read, each once", () => {
        expect(cleanRanges(["10.0.0.0/8", "10.0.0.0/8", " 10.0.0.0/8", "nonsense", 5, "fd00::/8"])).toEqual(["10.0.0.0/8", "fd00::/8"]);
        expect(rangesOfColumn('["10.10.10.0/24"]')).toEqual(["10.10.10.0/24"]);
        expect(rangesOfColumn("not json")).toEqual([]);
        expect(rangesOfColumn('{"a":1}')).toEqual([]);
        expect(rangesOfColumn(null)).toEqual([]);
    });
});
