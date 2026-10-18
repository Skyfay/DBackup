import dns from "node:dns";
import { isIP } from "node:net";
import { isAddressLiteral, isBlockedAddress, type CidrRange } from "./local-network";

/**
 * Resolves the hosts of a connection and finds an address in the local network outside the ranges
 * a tenant is allowed, see `local-network.ts`. Server only, it asks the resolver of the server.
 *
 * The check guards against mistakes and plain misuse, not against a hostile DNS server: the answer
 * may change between this lookup and the one of the connection itself. A host that does not
 * resolve, or not in time, passes here, since its connection fails on its own.
 */

/** How long a lookup may take before the check gives up on it and lets the connection try. */
const LOOKUP_TIMEOUT_MS = 5_000;

/** A host of a connection and the address of the local network it stands for. */
export interface LocalHit {
    host: string;
    address: string;
}

/** The addresses a host stands for: an IP literal as it is, a name as the resolver answers, none when it does not. */
export async function addressesOf(host: string): Promise<string[]> {
    // A link-local address with its zone, fe80::1%eth0, is a literal too.
    if (isIP(host) !== 0 || isAddressLiteral(host)) return [host];
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
    });
    try {
        const answers = await Promise.race([dns.promises.lookup(host, { all: true, verbatim: true }), timeout]);
        return answers ? answers.map((answer) => answer.address) : [];
    } catch {
        return [];
    } finally {
        clearTimeout(timer);
    }
}

/** The first host whose addresses include one of the local network that no allowed range covers, null when there is none. */
export async function firstBlockedAddress(hosts: readonly string[], allowed: readonly CidrRange[]): Promise<LocalHit | null> {
    const unique = [...new Set(hosts.map((host) => host.trim()).filter(Boolean))];
    const resolved = await Promise.all(unique.map(async (host) => ({ host, addresses: await addressesOf(host) })));
    for (const { host, addresses } of resolved) {
        const address = addresses.find((entry) => isBlockedAddress(entry, allowed));
        if (address) return { host, address };
    }
    return null;
}
