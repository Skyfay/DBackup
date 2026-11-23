import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import net from "node:net";
import type { Client } from "ssh2";

import { createPortForward } from "@/lib/transport/port-forward";
import type { PortForward } from "@/lib/transport/types";

/**
 * The forward is tested against a real TCP target with a fake SSH client.
 *
 * `forwardOut` hands back a Duplex, and a net.Socket is one, so the fake simply
 * dials the target directly. That exercises the real piping, the real listener,
 * and the real teardown while leaving out only the SSH transport itself.
 */
function fakeClient(target: { port: number } | { fail: Error }): Client {
    return {
        forwardOut(
            _srcIp: string,
            _srcPort: number,
            _dstHost: string,
            _dstPort: number,
            callback: (err: Error | undefined, channel: unknown) => void,
        ) {
            if ("fail" in target) {
                setImmediate(() => callback(target.fail, undefined));
                return;
            }
            const socket = net.createConnection({ host: "127.0.0.1", port: target.port });
            socket.once("connect", () => callback(undefined, socket));
            socket.once("error", (err) => callback(err, undefined));
        },
    } as unknown as Client;
}

/** Send one line and read the reply over a socket. */
function exchange(socket: net.Socket, payload: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let received = "";
        socket.on("data", (chunk) => {
            received += chunk.toString();
            socket.end();
        });
        socket.on("close", () => resolve(received));
        socket.on("error", reject);
        socket.write(payload);
    });
}

/** The round trip of the owner of a forward, through the socket its `dial` opens. */
async function roundTrip(forward: PortForward, payload: string): Promise<string> {
    return exchange(await forward.dial!(), payload);
}

/** The round trip of anyone else who finds the port of the listener, like a connection of another tenant. */
function strangerRoundTrip(port: number, payload: string): Promise<string> {
    return exchange(net.createConnection({ host: "127.0.0.1", port }), payload);
}

describe("createPortForward", () => {
    let echoServer: net.Server;
    let echoPort: number;

    beforeEach(async () => {
        echoServer = net.createServer((socket) => socket.pipe(socket));
        await new Promise<void>((resolve) => echoServer.listen(0, "127.0.0.1", () => resolve()));
        echoPort = (echoServer.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => echoServer.close(() => resolve()));
    });

    it("listens on a kernel-assigned loopback port", async () => {
        const forward = await createPortForward(fakeClient({ port: echoPort }), "db.internal", 1433);
        try {
            expect(forward.host).toBe("127.0.0.1");
            expect(forward.port).toBeGreaterThan(0);
            expect(forward.forwarded).toBe(true);
            expect(forward.lastError).toBeNull();
        } finally {
            await forward.close();
        }
    });

    it("carries bytes in both directions", async () => {
        const forward = await createPortForward(fakeClient({ port: echoPort }), "db.internal", 1433);
        try {
            expect(await roundTrip(forward, "SELECT 1")).toBe("SELECT 1");
        } finally {
            await forward.close();
        }
    });

    it("handles several sequential connections", async () => {
        const forward = await createPortForward(fakeClient({ port: echoPort }), "db.internal", 1433);
        try {
            expect(await roundTrip(forward, "one")).toBe("one");
            expect(await roundTrip(forward, "two")).toBe("two");
        } finally {
            await forward.close();
        }
    });

    it("records a forwarding failure instead of losing it", async () => {
        // With AllowTcpForwarding disabled the driver only ever sees a reset
        // peer, so the real cause has to be kept somewhere readable.
        const denied = new Error("Channel open failure: administratively prohibited");
        const forward = await createPortForward(fakeClient({ fail: denied }), "db.internal", 1433);
        try {
            await roundTrip(forward, "SELECT 1").catch(() => undefined);
            expect(forward.lastError?.message).toContain("administratively prohibited");
        } finally {
            await forward.close();
        }
    });

    it("carries no byte of a peer that finds the port, so the tunnel of one tenant is no path for another", async () => {
        const forwardOut = vi.fn();
        const forward = await createPortForward({ forwardOut } as unknown as Client, "tenant-a-db.internal", 1433);
        try {
            // Closed without an answer, and nothing was opened through the SSH login of the owner.
            expect(await strangerRoundTrip(forward.port, "SELECT 1")).toBe("");
            expect(forwardOut).not.toHaveBeenCalled();
            expect(forward.lastError).toBeNull();
        } finally {
            await forward.close();
        }
    });

    it("keeps carrying the owner while a stranger knocks", async () => {
        const forward = await createPortForward(fakeClient({ port: echoPort }), "db.internal", 1433);
        try {
            const stranger = strangerRoundTrip(forward.port, "intruder");
            expect(await roundTrip(forward, "SELECT 1")).toBe("SELECT 1");
            expect(await stranger).toBe("");
        } finally {
            await forward.close();
        }
    });

    it("stops accepting connections after close", async () => {
        const forward = await createPortForward(fakeClient({ port: echoPort }), "db.internal", 1433);
        const { port } = forward;
        await forward.close();

        await expect(strangerRoundTrip(port, "SELECT 1")).rejects.toMatchObject({ code: "ECONNREFUSED" });
        await expect(forward.dial!()).rejects.toThrow("closed");
    });

    it("is safe to close twice", async () => {
        const forward = await createPortForward(fakeClient({ port: echoPort }), "db.internal", 1433);
        await forward.close();
        await expect(forward.close()).resolves.toBeUndefined();
    });

    it("destroys connections that are still open when it closes", async () => {
        const forward = await createPortForward(fakeClient({ port: echoPort }), "db.internal", 1433);

        const socket = net.createConnection({ host: "127.0.0.1", port: forward.port });
        await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
        const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));

        await forward.close();
        // Without the explicit destroy this would hang until the peer timed out.
        await expect(closed).resolves.toBeUndefined();
    });
});
