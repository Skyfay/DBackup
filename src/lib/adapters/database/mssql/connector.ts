import net from "node:net";

import { sqlServerHost } from "@/lib/adapters/dialed-hosts";
import { checkedAddresses } from "@/lib/network/reach-check";
import type { ReachPolicy } from "@/lib/network/reach-policy";

/**
 * The socket factory tedious dials through for a connection of a tenant that blocks the local
 * network, `options.connector` of its config, shared by SQL Server and Azure SQL.
 *
 * tedious calls it for the first connection and again for the server a routing redirect (the
 * ENVCHANGE of a login) names, with that server as `host`. So it sees every host tedious dials:
 * - Through the SSH tunnel the dialed host is the local end of the forward, and a redirect to any
 *   other host would leave the tunnel and dial from the server DBackup runs on. It is refused.
 * - Directly every host, the redirect target included, is dialed at an address checked at connect
 *   time, see `reach-check.ts`, so neither a second answer of the resolver nor a redirect reaches
 *   the local network. The TLS server name stays the name, tedious sets it from its config.
 *
 * Not covered: the lookup of a named instance (`host\INSTANCE` without a port), which tedious sends
 * as a UDP datagram to port 1434 of the name it resolves itself, before the connector runs.
 * Any other tenant gets no connector, so tedious dials as before.
 */

type Connector = (options: { host: string; port: number; localAddress?: string }, lookup: unknown, signal: AbortSignal) => Promise<net.Socket>;

const plain = (host: string) => (sqlServerHost(host) ?? host).toLowerCase();

/** Connects to one address, or fails with the error of the socket or the abort of tedious. */
function dial(address: string, port: number, localAddress: string | undefined, signal: AbortSignal): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const socket = net.connect({ host: address, port, localAddress });
        const onAbort = () => {
            socket.destroy();
            reject(signal.reason);
        };
        socket.once("connect", () => {
            signal.removeEventListener("abort", onAbort);
            socket.removeAllListeners("error");
            resolve(socket);
        });
        socket.once("error", (error) => {
            signal.removeEventListener("abort", onAbort);
            reject(error);
        });
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * The connector for a pool that dials `dialed`, or undefined for a tenant that blocks nothing.
 * `tunnelled` says that `dialed` is the local end of an SSH forward.
 */
export function tdsConnector(dialed: string, tunnelled: boolean, reach: ReachPolicy | null): Connector | undefined {
    if (!reach) return undefined;
    return async ({ host, port, localAddress }, _lookup, signal) => {
        const redirected = plain(host) !== plain(dialed);
        if (tunnelled) {
            if (redirected) {
                throw new Error(`SQL Server redirected the connection to ${host}:${port}, which lies outside the SSH tunnel, so DBackup does not follow it. Connect to the server the redirect names instead.`);
            }
            return dial(host, port, localAddress, signal);
        }
        const addresses = await checkedAddresses(host, reach.allowed);
        let last: unknown;
        for (const { address } of addresses) {
            try {
                return await dial(address, port, localAddress, signal);
            } catch (error: unknown) {
                signal.throwIfAborted();
                last = error;
            }
        }
        throw last;
    };
}
