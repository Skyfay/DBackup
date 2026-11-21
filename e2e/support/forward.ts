/**
 * The tests reach DBackup at localhost, see `BASE_URL`. With the Docker host of the lab on another
 * machine, this forwards the port of localhost to it for as long as the run lasts, on IPv4 and IPv6,
 * since the browser and Node may each resolve localhost to either.
 */

import net from "net";

/** The loopback addresses localhost resolves to. ::1 may be missing on a machine without IPv6. */
const LOOPBACKS = ["127.0.0.1", "::1"];

function listen(server: net.Server, host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const failed = (error: Error) => reject(error);
        server.once("error", failed);
        server.listen({ host, port, exclusive: true }, () => {
            server.off("error", failed);
            resolve();
        });
    });
}

/**
 * Forwards `port` of localhost to the same port of `address` and answers the function that stops
 * it. Fails when something on this machine listens on the port already.
 */
export async function forwardToLab(address: string, port: number): Promise<() => Promise<void>> {
    const sockets = new Set<net.Socket>();
    const track = (socket: net.Socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
    };
    const servers: net.Server[] = [];
    const stop = async () => {
        for (const socket of sockets) socket.destroy();
        await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    };

    for (const host of LOOPBACKS) {
        const server = net.createServer((client) => {
            const upstream = net.connect({ host: address, port });
            track(client);
            track(upstream);
            client.on("error", () => upstream.destroy());
            upstream.on("error", () => client.destroy());
            client.pipe(upstream).pipe(client);
        });
        try {
            await listen(server, host, port);
            servers.push(server);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            // A machine without IPv6 has no ::1, localhost is 127.0.0.1 alone there.
            if (host === "::1" && (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT")) continue;
            await stop();
            if (code === "EADDRINUSE") {
                throw new Error(`Port ${port} of this machine is taken (${host}), so the tests cannot reach DBackup on ${address} through localhost. Stop what listens there, or pick another port with E2E_PORT.`);
            }
            throw error;
        }
    }
    return stop;
}
