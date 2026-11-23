import net from "node:net";
import type { Client, ClientChannel } from "ssh2";

import type { PortForward } from "./types";

/**
 * Local TCP listener that proxies every connection through an SSH channel.
 *
 * This is what lets a native driver reach a database that only listens on the
 * target machine's loopback. The driver dials 127.0.0.1 on a kernel-assigned
 * port and never learns that SSH is involved.
 *
 * Port 0 is deliberate: the kernel picks a free port, so there is no port-range
 * setting to configure and no race between choosing a port and binding it.
 *
 * The listener sits on the loopback of the one process that serves every tenant, so it carries
 * only the connections its owner opens: `dial()` of the forward connects and admits the local
 * port of its own socket, and a peer nobody admitted is closed without a byte reaching the SSH
 * channel. A connection of another tenant, or of any other local process, that finds the port
 * so reaches nothing behind it.
 */

/** How long an accepted peer may wait for `dial()` to admit it, the two events race in one process. */
const ADMIT_TIMEOUT_MS = 2_000;

export async function createPortForward(
    client: Client,
    remoteHost: string,
    remotePort: number,
): Promise<PortForward> {
    /**
     * Both halves of every live connection.
     *
     * The channel has to be tracked alongside the socket: destroying only the
     * socket leaves its SSH channel open, which holds a session slot on the
     * server until the whole connection goes away.
     */
    interface Pair {
        socket: net.Socket;
        channel: ClientChannel | null;
    }

    const live = new Set<Pair>();
    let lastError: Error | null = null;
    let closing = false;

    const teardown = (pair: Pair) => {
        pair.channel?.destroy();
        pair.socket.destroy();
        live.delete(pair);
    };

    /** Local ports of sockets `dial()` connected whose peer the listener has not accepted yet. */
    const admitted = new Set<number>();
    /** Accepted peers by their port that `dial()` has not admitted yet, with what forwards them. */
    const waiting = new Map<number, () => void>();

    const server = net.createServer((socket) => {
        const peer = socket.remotePort;
        // `dial()` connects from 127.0.0.1, so a peer of another loopback address with the same port is none of its own.
        if (closing || peer === undefined || socket.remoteAddress !== "127.0.0.1") {
            socket.destroy();
            return;
        }
        const pair: Pair = { socket, channel: null };
        live.add(pair);
        socket.on("error", () => teardown(pair));
        socket.once("close", () => {
            pair.channel?.end();
            live.delete(pair);
            if (waiting.get(peer) === forward) waiting.delete(peer);
        });

        const forward = () => openChannel(pair);
        if (admitted.delete(peer)) {
            forward();
            return;
        }
        // Not admitted yet: `dial()` may still be about to, anyone else never is.
        waiting.set(peer, forward);
        const timer = setTimeout(() => {
            if (waiting.get(peer) !== forward) return;
            waiting.delete(peer);
            teardown(pair);
        }, ADMIT_TIMEOUT_MS);
        timer.unref();
        socket.once("close", () => clearTimeout(timer));
    });

    const openChannel = (pair: Pair) => {
        const { socket } = pair;
        // A forwarding failure is reported per connection and the driver only
        // sees a reset peer, so keep the cause for the error message.
        socket.on("error", (err) => {
            lastError ??= err;
            teardown(pair);
        });

        client.forwardOut(
            "127.0.0.1",
            socket.remotePort ?? 0,
            remoteHost,
            remotePort,
            (err: Error | undefined, channel: ClientChannel) => {
                if (err) {
                    lastError ??= err;
                    teardown(pair);
                    return;
                }
                pair.channel = channel;
                if (closing) {
                    teardown(pair);
                    return;
                }
                channel.on("error", (channelErr: Error) => {
                    lastError ??= channelErr;
                    teardown(pair);
                });
                socket.pipe(channel).pipe(socket);
                channel.once("close", () => socket.end());
            },
        );
    };

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", reject);
            resolve();
        });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        server.close();
        throw new Error("Failed to determine the local address of the SSH port forward.");
    }

    return {
        host: "127.0.0.1",
        port: address.port,
        forwarded: true,
        get lastError() {
            return lastError;
        },
        dial(signal?: AbortSignal) {
            return new Promise<net.Socket>((resolve, reject) => {
                if (closing) return reject(new Error("The SSH port forward is closed."));
                if (signal?.aborted) return reject(signal.reason);
                const socket = net.connect({ host: "127.0.0.1", port: address.port, localAddress: "127.0.0.1" });
                const onAbort = () => {
                    socket.destroy();
                    reject(signal!.reason);
                };
                signal?.addEventListener("abort", onAbort, { once: true });
                socket.once("error", (error) => {
                    signal?.removeEventListener("abort", onAbort);
                    reject(error);
                });
                socket.once("connect", () => {
                    signal?.removeEventListener("abort", onAbort);
                    const local = socket.localPort;
                    if (local === undefined) {
                        socket.destroy();
                        return reject(new Error("Failed to determine the local port of a connection to the SSH port forward."));
                    }
                    const forward = waiting.get(local);
                    if (forward) {
                        waiting.delete(local);
                        forward();
                    } else {
                        admitted.add(local);
                        socket.once("close", () => admitted.delete(local));
                    }
                    resolve(socket);
                });
            });
        },
        async close() {
            if (closing) return;
            closing = true;
            waiting.clear();
            admitted.clear();
            for (const pair of [...live]) teardown(pair);
            live.clear();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}
