import dns from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { isAddressLiteral, isBlockedAddress, type CidrRange } from "./local-network";

/**
 * Resolves the hosts of a connection and finds an address in the local network outside the ranges
 * a tenant is allowed, see `local-network.ts`. Server only, it asks the resolver of the server.
 *
 * Two places ask it. The check of a config, before a save, a test or a run, resolves every host the
 * connection dials. The connection itself then dials an address this module checked once more, at
 * connect time, through `checkedLookup` or `checked-socket.ts`, so a name that answers otherwise the
 * second time, a DNS rebinding, reaches no address of the local network either. Only a tenant that
 * blocks the local network asks, and for it both fail closed: a host that does not resolve, or not
 * in time, is refused, since nothing says where it leads.
 */

/** How long a lookup may take before the check gives up on it and refuses the host. */
const LOOKUP_TIMEOUT_MS = 5_000;

/** A host of a connection and the address of the local network it stands for. */
export interface LocalHit {
    host: string;
    address: string;
}

/** A resolved address with its family, as `dns.lookup` answers with `all`. */
export interface ResolvedAddress {
    address: string;
    family: 4 | 6;
}

/** A host the check could not resolve, or not in time, so it cannot say where the host leads. */
export class UnresolvedHostError extends Error {
    readonly code = "ENOTFOUND";

    constructor(readonly host: string, reason: string) {
        super(`${host} does not resolve (${reason}), so DBackup cannot check that it lies outside the local network.`);
        this.name = "UnresolvedHostError";
    }
}

/** An address of the local network a connection was about to dial, refused at connect time. */
export class BlockedAddressError extends Error {
    readonly code = "EACCES";

    constructor(readonly hit: LocalHit) {
        const what = hit.host === hit.address ? hit.address : `${hit.host} is ${hit.address}, which`;
        super(`${what} lies in the local network this tenant does not reach. The platform allows ranges for it under Platform, Tenants.`);
        this.name = "BlockedAddressError";
    }
}

const bareHost = (host: string) => host.trim().replace(/^\[|\]$/g, "");

const familyOf = (address: string): 4 | 6 => (isIP(address.split("%")[0]) === 6 ? 6 : 4);

async function resolvedAddresses(host: string): Promise<ResolvedAddress[]> {
    const bare = bareHost(host);
    // A link-local address with its zone, fe80::1%eth0, is a literal too.
    if (isIP(bare) !== 0 || isAddressLiteral(bare)) return [{ address: bare, family: familyOf(bare) }];
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
    });
    let answers: dns.LookupAddress[] | null;
    try {
        answers = await Promise.race([dns.promises.lookup(bare, { all: true, verbatim: true }), timeout]);
    } catch (error: unknown) {
        const code = (error as { code?: unknown } | null)?.code;
        throw new UnresolvedHostError(bare, typeof code === "string" ? code : "lookup failed");
    } finally {
        clearTimeout(timer);
    }
    if (answers === null) throw new UnresolvedHostError(bare, `no answer within ${LOOKUP_TIMEOUT_MS / 1000} seconds`);
    if (!Array.isArray(answers) || answers.length === 0) throw new UnresolvedHostError(bare, "no address");
    return answers.map((answer) => ({ address: answer.address, family: answer.family === 6 ? 6 : 4 }));
}

/**
 * The addresses a host stands for: an IP literal as it is, a name as the resolver answers.
 *
 * @throws UnresolvedHostError when the name does not resolve, not in time, or to nothing.
 */
export async function addressesOf(host: string): Promise<string[]> {
    return (await resolvedAddresses(host)).map((entry) => entry.address);
}

/**
 * The first host whose addresses include one of the local network that no allowed range covers, null when there is none.
 *
 * @throws UnresolvedHostError for a host that does not resolve, see the top of this module.
 */
export async function firstBlockedAddress(hosts: readonly string[], allowed: readonly CidrRange[]): Promise<LocalHit | null> {
    const unique = [...new Set(hosts.map((host) => host.trim()).filter(Boolean))];
    const resolved = await Promise.all(unique.map(async (host) => ({ host, addresses: await addressesOf(host) })));
    for (const { host, addresses } of resolved) {
        const address = addresses.find((entry) => isBlockedAddress(entry, allowed));
        if (address) return { host, address };
    }
    return null;
}

/**
 * The addresses of a host once each of them lies outside the blocked local network, for a
 * connection to dial right away.
 *
 * @throws BlockedAddressError when one of them lies in it, a name with one public and one local
 *   address included, the way the check of a config refuses it.
 * @throws UnresolvedHostError when the host does not resolve.
 */
export async function checkedAddresses(host: string, allowed: readonly CidrRange[]): Promise<ResolvedAddress[]> {
    const answers = await resolvedAddresses(host);
    const blocked = answers.find((entry) => isBlockedAddress(entry.address, allowed));
    if (blocked) throw new BlockedAddressError({ host: bareHost(host), address: blocked.address });
    return answers;
}

/** The family a lookup of `net` or `tls` asks for, 0 for either. */
function askedFamily(options: unknown): 0 | 4 | 6 {
    const family = typeof options === "number" ? options : (options as { family?: unknown } | null)?.family;
    if (family === 4 || family === "IPv4") return 4;
    if (family === 6 || family === "IPv6") return 6;
    return 0;
}

/**
 * A `lookup` for `net.connect`, `tls.connect`, the agents of `node:http` and the drivers that pass
 * it on, which answers only with checked addresses, see `checkedAddresses`. `net` skips the lookup
 * for an address literal, so a caller checks a literal host itself with `assertLiteralReachable`.
 */
export function checkedLookup(allowed: readonly CidrRange[]): LookupFunction {
    return ((hostname: string, options: unknown, callback?: (...args: unknown[]) => void) => {
        const done = (typeof options === "function" ? options : callback) as (...args: unknown[]) => void;
        const all = typeof options === "object" && options !== null && (options as { all?: unknown }).all === true;
        const family = askedFamily(options);
        checkedAddresses(hostname, allowed).then(
            (answers) => {
                const fitting = family === 0 ? answers : answers.filter((entry) => entry.family === family);
                if (fitting.length === 0) {
                    done(Object.assign(new Error(`${hostname} has no IPv${family} address.`), { code: "ENOTFOUND" }));
                } else if (all) {
                    done(null, fitting);
                } else {
                    done(null, fitting[0].address, fitting[0].family);
                }
            },
            (error: unknown) => done(error),
        );
    }) as LookupFunction;
}

/**
 * Checks an address literal a connection dials, which `checkedLookup` never sees. A name passes
 * here, the lookup checks it.
 *
 * @throws BlockedAddressError for a literal of the blocked local network.
 */
export function assertLiteralReachable(host: string, allowed: readonly CidrRange[]): void {
    const bare = bareHost(host);
    if (isAddressLiteral(bare) && isBlockedAddress(bare, allowed)) throw new BlockedAddressError({ host: bare, address: bare });
}
