import net from "node:net";

import type { CidrRange } from "./local-network";
import { assertLiteralReachable, checkedAddresses, checkedLookup } from "./reach-check";

/**
 * Connections to checked addresses that still fall back the way a client does on its own: a name
 * with several addresses, dual stack or round robin, is tried address by address until one answers.
 * `checkedSocket` hands a connected socket to a client that takes one, like ssh2, nodemailer and
 * the direct transport. `reachableAddress` names the address for a client that only takes an
 * address, like the command line tools, by trying them in order before the client dials.
 */

/** How long a connection may take before it fails, the ready timeout of the SSH clients. */
export const CONNECT_TIMEOUT_MS = 20_000;

/**
 * A TCP socket to `host`, connected to the first of its checked addresses that answers, see
 * `checkedAddresses`. `net` tries every address the lookup hands it, in order, with
 * `autoSelectFamily`. A literal is checked as it is.
 *
 * @throws BlockedAddressError, UnresolvedHostError or the error of the last address tried.
 */
export function checkedSocket(host: string, port: number, allowed: readonly CidrRange[], timeoutMs = CONNECT_TIMEOUT_MS): Promise<net.Socket> {
    const bare = host.trim().replace(/^\[|\]$/g, "");
    try {
        assertLiteralReachable(bare, allowed);
    } catch (error: unknown) {
        return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: bare, port, lookup: checkedLookup(allowed), autoSelectFamily: true });
        const timer = setTimeout(() => socket.destroy(new Error(`Connecting to ${bare}:${port} took longer than ${timeoutMs / 1000} seconds.`)), timeoutMs);
        socket.once("connect", () => {
            clearTimeout(timer);
            socket.removeListener("error", onError);
            resolve(socket);
        });
        const onError = (error: Error) => {
            clearTimeout(timer);
            reject(error);
        };
        socket.once("error", onError);
    });
}

/**
 * The checked address of `host` a client should dial on `port`: the only one, or of several the
 * first that accepts a connection, which is closed again right away. When none answers, the first
 * checked address, so the client fails with its own message.
 *
 * @throws BlockedAddressError or UnresolvedHostError, see `checkedAddresses`.
 */
export async function reachableAddress(host: string, port: number, allowed: readonly CidrRange[]): Promise<string> {
    const addresses = await checkedAddresses(host, allowed);
    if (addresses.length === 1) return addresses[0].address;
    for (const { address } of addresses) {
        try {
            const socket = await checkedSocket(address, port, allowed, CONNECT_TIMEOUT_MS / addresses.length);
            socket.destroy();
            return address;
        } catch {
            // The next address is tried, as the client would.
        }
    }
    return addresses[0].address;
}
