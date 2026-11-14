/**
 * The address a request comes from, worked out by the custom server, the only place that sees the
 * socket of the connection. The app reads it from one header the server sets on every request and
 * overwrites when a client sends it, see src/lib/core/client-address.ts.
 *
 * X-Forwarded-For counts only on a connection from a trusted proxy, and its entries are walked from
 * the right, the end the proxies append to, up to the first address that is no trusted proxy. A
 * client can put anything at the left end, so the first entry is never taken on trust. This is what
 * `trust proxy` does in Express.
 *
 * Which header the proxy writes is a setting, TRUSTED_PROXY_HEADER, never a guess from the request.
 * A proxy passes on whatever the client sent in the header it does not write, so X-Forwarded-For
 * behind a proxy that sets only X-Real-IP is the client's own, and so is X-Real-IP behind one that
 * appends to X-Forwarded-For. Only the header of the setting is read, the other one never.
 *
 * Compiled with custom-server.ts by tsconfig.server.json, so it imports nothing of the app.
 */

import { BlockList, isIP } from "node:net";

/** The header the custom server sets on every request. Read by src/lib/core/client-address.ts. */
export const CLIENT_ADDRESS_HEADER = "x-dbackup-client-address";

/**
 * The variable the custom server sets to "1" before Next.js loads, so the app trusts the header
 * above, see `addressHeaderSet` in src/lib/core/client-address.ts, which keeps the same name.
 */
export const CUSTOM_SERVER_MARK = "DBACKUP_CUSTOM_SERVER";

/** The headers a trusted proxy writes the address of the client into, the values of TRUSTED_PROXY_HEADER. */
export const PROXY_HEADERS = ["x-forwarded-for", "x-real-ip"] as const;
export type ProxyHeader = (typeof PROXY_HEADERS)[number];

/**
 * The header the proxies write, from the value of TRUSTED_PROXY_HEADER: unset for X-Forwarded-For.
 * Throws on any other value, so a typo does not silently read the wrong header.
 */
export function proxyHeaderFrom(value: string | undefined): ProxyHeader {
    const setting = value?.trim().toLowerCase() || "x-forwarded-for";
    const header = PROXY_HEADERS.find((name) => name === setting);
    if (!header) throw new Error(`TRUSTED_PROXY_HEADER: "${value}" is none of ${PROXY_HEADERS.join(", ")}`);
    return header;
}

/**
 * The networks a reverse proxy in front of DBackup usually sits in: loopback, the private ranges of
 * a Docker network or a LAN, and link-local. The default of TRUSTED_PROXIES, and its keyword `private`.
 */
export const DEFAULT_TRUSTED_PROXIES = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "::1/128", "fc00::/7", "fe80::/10"];

/**
 * The ranges the edge servers of Cloudflare connect from, the keyword `cloudflare` of
 * TRUSTED_PROXIES. As https://api.cloudflare.com/client/v4/ips listed them on 2026-10-12, the same
 * list as https://www.cloudflare.com/ips/. Cloudflare changes them rarely.
 */
export const CLOUDFLARE_RANGES = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
    "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
    "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
    "2a06:98c0::/29", "2c0f:f248::/32",
];

/** The names TRUSTED_PROXIES takes in place of addresses, each for a list of ranges. */
export const PROXY_KEYWORDS = new Map<string, readonly string[]>([
    ["private", DEFAULT_TRUSTED_PROXIES],
    ["cloudflare", CLOUDFLARE_RANGES],
]);

/** "::ffff:172.18.0.3", how Node shows an IPv4 peer on a dual stack socket, as "172.18.0.3". */
export function normalizeAddress(address: string): string {
    const trimmed = address.trim();
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
    return (mapped ? mapped[1] : trimmed).toLowerCase();
}

/**
 * The proxies to trust, from the value of TRUSTED_PROXIES: unset for the private ranges, `none` to
 * never read a forwarded header, or a comma list of addresses, CIDR ranges and the keywords of
 * PROXY_KEYWORDS. A list replaces the default, so a proxy in a private network behind Cloudflare
 * needs `private,cloudflare`. Throws on an entry that is none of them, so a typo does not silently
 * trust nothing or everything.
 */
export function trustedProxiesFrom(value: string | undefined): BlockList {
    const list = new BlockList();
    const setting = value?.trim();
    if (setting?.toLowerCase() === "none") return list;
    const entries = setting ? setting.split(",").map((entry) => entry.trim()).filter(Boolean) : ["private"];
    for (const entry of entries.flatMap((entry) => PROXY_KEYWORDS.get(entry.toLowerCase()) ?? [entry])) {
        const [address, prefix, ...rest] = entry.split("/");
        const family = isIP(address);
        const bits = prefix === undefined ? (family === 6 ? 128 : 32) : Number(prefix);
        if (!family || rest.length > 0 || !/^\d+$/.test(prefix ?? String(bits)) || bits > (family === 6 ? 128 : 32)) {
            throw new Error(`TRUSTED_PROXIES: "${entry}" is no IP address, CIDR range or one of ${[...PROXY_KEYWORDS.keys()].join(", ")}`);
        }
        list.addSubnet(address, bits, family === 6 ? "ipv6" : "ipv4");
    }
    return list;
}

function isTrusted(address: string, trusted: BlockList): boolean {
    const family = isIP(address);
    return family !== 0 && trusted.check(address, family === 6 ? "ipv6" : "ipv4");
}

/** A header Node gives as a string, or as a list when it came more than once. */
type HeaderValue = string | string[] | undefined;
const joined = (value: HeaderValue) => (Array.isArray(value) ? value.join(",") : value ?? "");

/**
 * The address of the client of a request.
 *
 * @param peer       The remote address of the socket.
 * @param forwarded  X-Forwarded-For as it arrived.
 * @param realIp     X-Real-IP as it arrived.
 * @param header     The header the trusted proxies write, from `proxyHeaderFrom`. The other one is ignored.
 */
export function clientAddressOf(peer: string | undefined, forwarded: HeaderValue, realIp: HeaderValue, trusted: BlockList, header: ProxyHeader = "x-forwarded-for"): string {
    const remote = peer ? normalizeAddress(peer) : "unknown";
    if (!isTrusted(remote, trusted)) return remote;

    if (header === "x-real-ip") {
        const real = joined(realIp).split(",").map(normalizeAddress).filter(Boolean);
        // A trusted proxy that sets X-Real-IP sets one address, anything else is not its doing.
        return real.length === 1 && isIP(real[0]) ? real[0] : remote;
    }
    const chain = joined(forwarded).split(",").map(normalizeAddress).filter(Boolean);
    if (chain.length === 0) return remote;
    for (let index = chain.length - 1; index >= 0; index--) {
        const hop = chain[index];
        // An entry that is no address was not written by a proxy, so nothing left of it counts.
        if (!isIP(hop)) return index === chain.length - 1 ? remote : chain[index + 1];
        if (!isTrusted(hop, trusted)) return hop;
    }
    // Every hop is a trusted network, like a client in the LAN behind a proxy in Docker.
    return chain[0];
}

/**
 * What the server logs the first time a forwarded header counts by the default alone, null any
 * other time. With TRUSTED_PROXIES unset every peer of a private network counts as a reverse proxy,
 * and the server cannot tell a proxy from a device of that network that connects directly and names
 * its own address in the header. So the first such request names the peer and the setting that
 * pins it. A value someone set, also `private`, is a decision and gets no line.
 *
 * @param setting  TRUSTED_PROXIES as it is set.
 * @returns A function for every request, which answers the line once and null from then on.
 */
export function defaultTrustNotice(setting: string | undefined, trusted: BlockList, header: ProxyHeader = "x-forwarded-for"): (peer: string | undefined, forwarded: HeaderValue, realIp: HeaderValue) => string | null {
    let pending = !setting?.trim();
    return (peer, forwarded, realIp) => {
        if (!pending || !peer) return null;
        if (!joined(header === "x-real-ip" ? realIp : forwarded).trim()) return null;
        const remote = normalizeAddress(peer);
        if (!isTrusted(remote, trusted)) return null;
        pending = false;
        const name = header === "x-real-ip" ? "X-Real-IP" : "X-Forwarded-For";
        return `${name} of ${remote} counts as the address of the client, because TRUSTED_PROXIES is unset and every private network is trusted. `
            + `If ${remote} is your reverse proxy, set TRUSTED_PROXIES=${remote} to trust it alone. `
            + "If DBackup is reached without a reverse proxy, set TRUSTED_PROXIES=none. "
            + "Until then any device of a private network that connects directly names its own address for the rate limits and the audit log.";
    };
}
