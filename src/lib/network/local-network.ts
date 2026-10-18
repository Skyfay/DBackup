/**
 * The local network of the server DBackup runs on, as plain data and pure functions: which
 * addresses count as local, and the ranges the platform allows a tenant anyway. No Node.js module
 * here, so the Edit dialog of a tenant checks a range as you type with the same parser the server
 * checks it with. The server side, which resolves the hosts of a connection, is `reach-check.ts`.
 *
 * The parser follows `isIP` of `node:net`, which the tests compare it with: dotted IPv4 without
 * leading zeros and IPv6 with `::` and an IPv4 tail. Shorthands like `127.1` are no literals here,
 * the resolver turns them into the address they stand for.
 */

export type IpVersion = 4 | 6;

/** An address as its bytes, 4 for IPv4 and 16 for IPv6. */
export interface IpAddress {
    version: IpVersion;
    bytes: number[];
}

/** A range of addresses: the bytes of its first address and how many leading bits it fixes. */
export interface CidrRange extends IpAddress {
    prefix: number;
}

/** How many ranges a tenant may be allowed, more is a sign of a list that should be a wider range. */
export const MAX_ALLOWED_RANGES = 50;

/** The longest range a person types, `ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255/128` and some room. */
export const MAX_RANGE_LENGTH = 64;

/**
 * What counts as the local network: the addresses that lead into the network of the server
 * DBackup runs on, or to the server itself, rather than out to the internet. The shared address
 * space holds the overlays of VPNs like NetBird and Tailscale, link-local holds the metadata
 * services of the clouds. An IPv4 address inside IPv6, mapped or through NAT64, counts as its IPv4.
 */
export const LOCAL_NETWORK: readonly { range: string; name: string }[] = [
    { range: "0.0.0.0/8", name: "This network" },
    { range: "10.0.0.0/8", name: "Private" },
    { range: "100.64.0.0/10", name: "Shared address space, VPN overlays" },
    { range: "127.0.0.0/8", name: "Loopback" },
    { range: "169.254.0.0/16", name: "Link-local, cloud metadata" },
    { range: "172.16.0.0/12", name: "Private" },
    { range: "192.168.0.0/16", name: "Private" },
    { range: "224.0.0.0/4", name: "Multicast" },
    { range: "240.0.0.0/4", name: "Reserved and broadcast" },
    { range: "::/128", name: "Unspecified" },
    { range: "::1/128", name: "Loopback" },
    { range: "fc00::/7", name: "Unique local" },
    { range: "fe80::/10", name: "Link-local" },
    { range: "fec0::/10", name: "Site-local, deprecated" },
    { range: "ff00::/8", name: "Multicast" },
];

const IPV4_PART = /^(?:0|[1-9][0-9]{0,2})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

function parseIPv4(text: string): number[] | null {
    const parts = text.split(".");
    if (parts.length !== 4 || !parts.every((part) => IPV4_PART.test(part))) return null;
    const bytes = parts.map(Number);
    return bytes.every((byte) => byte <= 255) ? bytes : null;
}

function parseIPv6(text: string): number[] | null {
    let hex = text;
    // An IPv4 tail, like ::ffff:10.0.0.1, becomes the two groups it stands for.
    if (hex.includes(".")) {
        const lastColon = hex.lastIndexOf(":");
        const tail = lastColon < 0 ? null : parseIPv4(hex.slice(lastColon + 1));
        if (!tail) return null;
        hex = `${hex.slice(0, lastColon + 1)}${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`;
    }
    const halves = hex.split("::");
    if (halves.length > 2) return null;
    const groupsOf = (part: string) => (part === "" ? [] : part.split(":"));
    let groups: string[];
    if (halves.length === 2) {
        const left = groupsOf(halves[0]);
        const right = groupsOf(halves[1]);
        // The two colons stand for one group at least.
        if (left.length + right.length > 7) return null;
        groups = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
    } else {
        groups = groupsOf(hex);
        if (groups.length !== 8) return null;
    }
    if (!groups.every((group) => HEX_GROUP.test(group))) return null;
    return groups.flatMap((group) => {
        const value = parseInt(group, 16);
        return [value >> 8, value & 255];
    });
}

/** An address literal without brackets and without a zone, null for anything else. */
function parseLiteral(text: string): IpAddress | null {
    const v4 = parseIPv4(text);
    if (v4) return { version: 4, bytes: v4 };
    const v6 = parseIPv6(text);
    return v6 ? { version: 6, bytes: v6 } : null;
}

/**
 * An IP address as a host names it, or null for a name. Takes the brackets of a URL, `[::1]`, and
 * the zone of a link-local IPv6 address, `fe80::1%eth0`, which still leads into the local network.
 */
export function parseAddress(text: string): IpAddress | null {
    let value = text.trim();
    if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
    const zone = value.indexOf("%");
    if (zone > 0 && value.includes(":")) value = value.slice(0, zone);
    return parseLiteral(value);
}

/** Whether a text is an IP address literal, like `isIP` of `node:net` without the zone. */
export function isAddressLiteral(text: string): boolean {
    return parseAddress(text) !== null;
}

/** An address in its short form: dotted IPv4, IPv6 with the longest run of zero groups as `::`. */
export function formatAddress(address: IpAddress): string {
    if (address.version === 4) return address.bytes.join(".");
    const groups = Array.from({ length: 8 }, (_, index) => (address.bytes[index * 2] << 8) | address.bytes[index * 2 + 1]);
    let best = { start: -1, length: 0 };
    for (let start = 0; start < 8; start++) {
        let length = 0;
        while (start + length < 8 && groups[start + length] === 0) length++;
        if (length > best.length) best = { start, length };
    }
    const hex = (from: number, to: number) => groups.slice(from, to).map((group) => group.toString(16)).join(":");
    if (best.length < 2) return hex(0, 8);
    return `${hex(0, best.start)}::${hex(best.start + best.length, 8)}`;
}

const MAPPED_PREFIX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];
const NAT64_PREFIX = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];

const startsWith = (bytes: number[], prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);

/** The IPv4 address an IPv6 address carries, mapped (`::ffff:10.0.0.1`) or through NAT64 (`64:ff9b::a00:1`), else null. */
export function embeddedIPv4(address: IpAddress): IpAddress | null {
    if (address.version !== 6) return null;
    if (!startsWith(address.bytes, MAPPED_PREFIX) && !startsWith(address.bytes, NAT64_PREFIX)) return null;
    return { version: 4, bytes: address.bytes.slice(12) };
}

/** Whether an address lies in a range of its own version. */
export function inRange(address: IpAddress, range: CidrRange): boolean {
    if (address.version !== range.version) return false;
    const whole = Math.floor(range.prefix / 8);
    for (let index = 0; index < whole; index++) {
        if (address.bytes[index] !== range.bytes[index]) return false;
    }
    const rest = range.prefix % 8;
    if (rest === 0) return true;
    const mask = (0xff << (8 - rest)) & 0xff;
    return (address.bytes[whole] & mask) === (range.bytes[whole] & mask);
}

/** Whether an address lies in one of the ranges, an IPv4 inside IPv6 also by its IPv4. */
export function inAnyRange(address: IpAddress, ranges: readonly CidrRange[]): boolean {
    const v4 = embeddedIPv4(address);
    return ranges.some((range) => inRange(address, range) || (v4 !== null && inRange(v4, range)));
}

export type CidrResult = { ok: true; range: CidrRange; text: string } | { ok: false; error: string };

/**
 * Reads a range like `10.10.10.0/24` or `fd00:1::/64`. A single address is the range of itself,
 * `10.0.0.5` reads as `10.0.0.5/32`. Refused: anything but an address with a prefix in its bounds,
 * a zone or brackets, and an address with bits set after its prefix, which is usually a typo for a
 * single address or for the start of its network. A range inside `::ffff:0:0/96` is its IPv4.
 */
export function parseCidr(input: string): CidrResult {
    const text = input.trim();
    if (!text) return { ok: false, error: "Enter a range like 10.10.10.0/24." };
    const parts = text.split("/");
    if (parts.length > 2) return { ok: false, error: `${text} is no range. Write it like 10.10.10.0/24.` };
    const literal = parseLiteral(parts[0]);
    if (!literal) return { ok: false, error: `${parts[0] || text} is no IPv4 or IPv6 address.` };
    const bits = literal.version === 4 ? 32 : 128;
    let prefix = bits;
    if (parts.length === 2) {
        if (!/^(?:0|[1-9][0-9]{0,2})$/.test(parts[1]) || Number(parts[1]) > bits) {
            return { ok: false, error: `The prefix of ${text} is no number from 0 to ${bits}.` };
        }
        prefix = Number(parts[1]);
    }
    let range: CidrRange = { ...literal, prefix };
    const start = networkStart(range);
    if (start.bytes.some((byte, index) => byte !== range.bytes[index])) {
        return { ok: false, error: `${text} has bits set after its prefix. Did you mean ${formatAddress(start)}/${prefix}?` };
    }
    const v4 = embeddedIPv4(range);
    if (v4 && startsWith(range.bytes, MAPPED_PREFIX) && prefix >= 96) range = { ...v4, prefix: prefix - 96 };
    return { ok: true, range, text: `${formatAddress(range)}/${range.prefix}` };
}

/** The first address of a range, every bit after its prefix cleared. */
function networkStart(range: CidrRange): IpAddress {
    const bytes = range.bytes.map((byte, index) => {
        const kept = Math.min(8, Math.max(0, range.prefix - index * 8));
        return byte & ((0xff << (8 - kept)) & 0xff);
    });
    return { version: range.version, bytes };
}

const LOCAL_RANGES: readonly CidrRange[] = LOCAL_NETWORK.map(({ range }) => {
    const parsed = parseCidr(range);
    if (!parsed.ok) throw new Error(`The local network names a broken range: ${range}`);
    return parsed.range;
});

/** Whether an address leads into the local network, see `LOCAL_NETWORK`. */
export function isLocalAddress(address: IpAddress): boolean {
    return inAnyRange(address, LOCAL_RANGES);
}

/** Whether a tenant that blocks the local network may not reach an address: a local one outside every allowed range. */
export function isBlockedAddress(text: string, allowed: readonly CidrRange[]): boolean {
    const address = parseAddress(text);
    return address !== null && isLocalAddress(address) && !inAnyRange(address, allowed);
}

/** The ranges of a list in their short form, each once, leaving out what does not read as a range. */
export function cleanRanges(values: readonly unknown[]): string[] {
    const texts = values.flatMap((value) => {
        if (typeof value !== "string") return [];
        const parsed = parseCidr(value);
        return parsed.ok ? [parsed.text] : [];
    });
    return [...new Set(texts)];
}

/** The allowed ranges of a tenant as the column keeps them, a JSON array, none when it does not read. */
export function rangesOfColumn(json: string | null | undefined): string[] {
    try {
        const value: unknown = JSON.parse(json ?? "[]");
        return Array.isArray(value) ? cleanRanges(value) : [];
    } catch {
        return [];
    }
}

/** The ranges of a list for the check, the ones that do not read left out. */
export function toRanges(texts: readonly string[]): CidrRange[] {
    return texts.flatMap((text) => {
        const parsed = parseCidr(text);
        return parsed.ok ? [parsed.range] : [];
    });
}
