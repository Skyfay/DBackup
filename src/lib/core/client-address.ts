/**
 * The address a request came from. The custom server works it out from the socket and from the
 * header of a trusted proxy, and sets it on every request in a header of its own, replacing
 * whatever a client sent there, see server/client-address.ts. The app reads that header only,
 * never X-Forwarded-For itself, whose first entry a client can set to anything.
 *
 * Only the custom server replaces the header. Without it, under `pnpm dev` or `next start`, a value
 * there came from the client, so the address is unknown and the middleware drops the header before
 * the app and better-auth see it. The custom server says it runs in `DBACKUP_CUSTOM_SERVER`, which
 * it sets before it creates the app, so the Edge sandbox of the middleware copies it as well.
 */

/** Set by server/client-address.ts, which keeps the same name. */
export const CLIENT_ADDRESS_HEADER = "x-dbackup-client-address";

/** Whether the custom server set the header of the address, see `CUSTOM_SERVER_MARK` in server/client-address.ts. */
export function addressHeaderSet(): boolean {
    return process.env.DBACKUP_CUSTOM_SERVER === "1";
}

export function clientAddress(headers: Pick<Headers, "get">): string | null {
    if (!addressHeaderSet()) return null;
    return headers.get(CLIENT_ADDRESS_HEADER)?.trim() || null;
}

/**
 * The headers of a request without the header of the address, null when nothing is to drop. For
 * the middleware, so a value the client sent never reaches the app while no custom server set it.
 */
export function withoutClientAddress(headers: Headers): Headers | null {
    if (addressHeaderSet() || !headers.has(CLIENT_ADDRESS_HEADER)) return null;
    const kept = new Headers(headers);
    kept.delete(CLIENT_ADDRESS_HEADER);
    return kept;
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
