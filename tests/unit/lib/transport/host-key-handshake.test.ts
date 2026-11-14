// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { Server, utils, type Connection } from "ssh2";

vi.mock("@/lib/logging/logger", () => {
    const child = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { logger: { ...child, child: () => child } };
});

import { HostKeyMismatchError } from "@/lib/logging/errors";
import { markHostKey, type SeenHostKey, type SshHostKeyPolicy } from "@/lib/transport/host-key";
import { openSshClient } from "@/lib/transport/ssh-connection";
import { connectSFTP, endSftpClient } from "@/lib/adapters/storage/sftp";

/**
 * A real SSH handshake against an ssh2 server on the loopback, with made-up host keys and a made-up
 * password. It records every login the server was offered, which is what a changed host key must
 * never get to see.
 */
interface Fixture {
    port: number;
    logins: { method: string; password?: string }[];
    close: () => Promise<void>;
}

const servers: Fixture[] = [];

async function startServer(): Promise<Fixture> {
    const hostKey = utils.generateKeyPairSync("ed25519").private;
    const logins: Fixture["logins"] = [];
    const clients = new Set<Connection>();
    const server = new Server({ hostKeys: [hostKey] }, (client) => {
        clients.add(client);
        client.on("error", () => {});
        client.on("close", () => clients.delete(client));
        client.on("authentication", (ctx) => {
            // The first request asks which methods there are and carries no secret.
            if (ctx.method === "none") return ctx.reject(["password"]);
            logins.push({ method: ctx.method, ...(ctx.method === "password" ? { password: ctx.password } : {}) });
            ctx.accept();
        });
        client.on("ready", () => {
            client.on("session", (accept) => {
                const session = accept();
                session.on("sftp", (acceptSftp) => { acceptSftp(); });
            });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const fixture: Fixture = {
        port: (server.address() as { port: number }).port,
        logins,
        close: () => new Promise<void>((resolve) => {
            for (const client of clients) client.end();
            server.close(() => resolve());
        }),
    };
    servers.push(fixture);
    return fixture;
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
});

const login = (port: number) => ({ host: "127.0.0.1", port, username: "backup", authType: "password" as const, password: "made-up-password" });

/** Logs in once without a pin and answers the key the server presented, like a first connect does. */
async function firstKeyOf(port: number): Promise<SeenHostKey> {
    let seen: SeenHostKey | null = null;
    const client = await openSshClient({ ...login(port), hostKey: { host: "127.0.0.1", port, onFirstKey: (key) => { seen = key; } } });
    client.end();
    expect(seen).not.toBeNull();
    return seen as unknown as SeenHostKey;
}

describe("a server that presents another host key than the pinned one", () => {
    it("pins the key of the first successful login of the ssh2 transport", async () => {
        const server = await startServer();
        const seen = await firstKeyOf(server.port);
        expect(seen.type).toBe("ssh-ed25519");
        expect(seen.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
        expect(server.logins).toEqual([{ method: "password", password: "made-up-password" }]);
    });

    it("lets the ssh2 transport log in to the server that presents the pinned key", async () => {
        const server = await startServer();
        const seen = await firstKeyOf(server.port);
        const onFirstKey = vi.fn();
        const client = await openSshClient({ ...login(server.port), hostKey: { host: "127.0.0.1", port: server.port, pinned: seen, onFirstKey } });
        client.end();
        expect(onFirstKey).not.toHaveBeenCalled();
        expect(server.logins).toHaveLength(2);
    });

    it("is refused by the ssh2 transport before any password is sent", async () => {
        const trusted = await firstKeyOf((await startServer()).port);
        const impostor = await startServer();
        const onMismatch = vi.fn();
        const policy: SshHostKeyPolicy = { host: "db.example.test", port: 22, pinned: trusted, onMismatch };

        const failure = await openSshClient({ ...login(impostor.port), hostKey: policy }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(HostKeyMismatchError);
        expect((failure as HostKeyMismatchError).expected).toBe(trusted.fingerprint);
        expect((failure as HostKeyMismatchError).presented).toMatch(/^SHA256:/);
        expect((failure as HostKeyMismatchError).presented).not.toBe(trusted.fingerprint);
        expect((failure as Error).message).toContain("db.example.test:22");
        expect(impostor.logins).toEqual([]);
        await vi.waitFor(() => expect(onMismatch).toHaveBeenCalledTimes(1));
    });

    it("is refused by the SFTP adapter before any password is sent", async () => {
        const trusted = await firstKeyOf((await startServer()).port);
        const impostor = await startServer();
        const config = markHostKey(
            { host: "127.0.0.1", port: impostor.port, username: "backup", password: "made-up-password", authType: "password" as const, pathPrefix: "" },
            { host: "127.0.0.1", port: impostor.port, pinned: trusted },
        );

        const failure = await connectSFTP(config as never).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(HostKeyMismatchError);
        expect((failure as Error).message).toContain(trusted.fingerprint);
        expect(impostor.logins).toEqual([]);
    });

    it("lets the SFTP adapter log in and reports the key of a server without a pin", async () => {
        const server = await startServer();
        const onFirstKey = vi.fn();
        const config = markHostKey(
            { host: "127.0.0.1", port: server.port, username: "backup", password: "made-up-password", authType: "password" as const, pathPrefix: "" },
            { host: "127.0.0.1", port: server.port, onFirstKey },
        );

        const sftp = await connectSFTP(config as never);
        await endSftpClient(sftp);

        expect(onFirstKey).toHaveBeenCalledTimes(1);
        expect(server.logins).toEqual([{ method: "password", password: "made-up-password" }]);
    });

    it("still receives the password while the check of the connection is switched off", async () => {
        const server = await startServer();
        const client = await openSshClient(login(server.port));
        client.end();
        expect(server.logins).toEqual([{ method: "password", password: "made-up-password" }]);
    });
});
