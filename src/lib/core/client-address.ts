/**
 * The address a request came from. The custom server works it out from the socket and from
 * X-Forwarded-For of a trusted proxy, and sets it on every request in a header of its own,
 * replacing whatever a client sent there, see server/client-address.ts. The app reads that header
 * only, never X-Forwarded-For itself, whose first entry a client can set to anything.
 *
 * Without the custom server, under `pnpm dev`, the header is missing and the address is unknown.
 */

/** Set by server/client-address.ts, which keeps the same name. */
export const CLIENT_ADDRESS_HEADER = "x-dbackup-client-address";

export function clientAddress(headers: Pick<Headers, "get">): string | null {
    return headers.get(CLIENT_ADDRESS_HEADER)?.trim() || null;
}

/**
 * The key of an address for the rate limits. An IPv6 address counts by its /64 network, since a
 * single connection usually holds a whole one and could take a new address for every request.
 */
export function rateLimitKey(address: string): string {
    if (!address.includes(":")) return address;
    const [head, tail = ""] = address.toLowerCase().split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = address.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
    return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
