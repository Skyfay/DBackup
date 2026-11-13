// @vitest-environment node
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let tempRoot = "";
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => tempRoot }));

import type { StorageAdapter } from "@/lib/core/interfaces";
import { HostKeyMismatchError } from "@/lib/logging/errors";
import { withRsyncHostKey, type KnownHosts } from "@/lib/adapters/storage/rsync-host-key";
import { HOST_KEY_ALIAS, opensshHostKeyOptions } from "@/lib/transport/host-key-openssh";
import { hostKeyFingerprint, markHostKey, type SshHostKeyPolicy } from "@/lib/transport/host-key";

const key = Buffer.from("made-up host key blob").toString("base64");
const pinned = { type: "ssh-ed25519", key };
const presented = "SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/AbCdE";
const server = { host: "backup.example.test", port: 22 };

type Config = Record<string, unknown> & KnownHosts;

/** What the ssh of a call would be given, and what its `known_hosts` file held when the call ran. */
interface Seen {
    options: string[];
    file: string | undefined;
    content: string | null;
}

/** An adapter in the place of rsync: each method notes the check it runs under, then does what the test says. */
function adapterThat(run: (config: Config, seen: Seen) => Promise<unknown> | unknown) {
    const calls: Seen[] = [];
    const method = async (config: Config) => {
        const seen: Seen = {
            options: opensshHostKeyOptions(config.knownHostsFile ? { file: config.knownHostsFile, pinned: config.strictHostKey === true } : undefined),
            file: config.knownHostsFile,
            content: config.knownHostsFile ? await fs.readFile(config.knownHostsFile, "utf8") : null,
        };
        calls.push(seen);
        return run(config, seen);
    };
    const adapter = withRsyncHostKey({ id: "rsync", upload: method, test: method, ping: method, openSession: method } as unknown as StorageAdapter) as unknown as Record<string, (config: object) => Promise<unknown>>;
    return { adapter, calls };
}

const configWith = (policy: SshHostKeyPolicy | null) => markHostKey({ host: server.host, port: 22, username: "backup" }, policy);

beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rsync-host-key-test-"));
});
afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
});
beforeEach(() => vi.clearAllMocks());

describe("the host key check of an rsync connection", () => {
    it("runs ssh against a file with the pinned key and removes the file afterwards", async () => {
        const { adapter, calls } = adapterThat(() => true);

        await expect(adapter.upload(configWith({ ...server, pinned }))).resolves.toBe(true);

        expect(calls[0].options).toContain("StrictHostKeyChecking=yes");
        expect(calls[0].content).toBe(`${HOST_KEY_ALIAS} ssh-ed25519 ${key}\n`);
        await expect(fs.stat(path.dirname(calls[0].file!))).rejects.toThrow();
    });

    it("accepts every key as before for a connection with the check switched off", async () => {
        const { adapter, calls } = adapterThat(() => true);

        await adapter.upload(configWith(null));

        expect(calls[0].options).toEqual(["StrictHostKeyChecking=no", "UserKnownHostsFile=/dev/null", "LogLevel=ERROR"]);
        expect(calls[0].file).toBeUndefined();
    });

    it("pins the key ssh wrote into the empty file once the first login succeeded", async () => {
        const onFirstKey = vi.fn();
        const { adapter, calls } = adapterThat(async (config) => {
            // What ssh does with accept-new: it adds the key of the server it logged in to.
            await fs.appendFile(config.knownHostsFile!, `${HOST_KEY_ALIAS} ssh-ed25519 ${key}\n`);
            return { success: true, message: "ok" };
        });

        await adapter.test(configWith({ ...server, onFirstKey }));

        expect(calls[0].options).toContain("StrictHostKeyChecking=accept-new");
        expect(calls[0].content).toBe("");
        expect(onFirstKey).toHaveBeenCalledWith({ type: "ssh-ed25519", key, fingerprint: hostKeyFingerprint(Buffer.from(key, "base64")) });
    });

    it("pins nothing when the first login failed, although ssh already wrote the key", async () => {
        const onFirstKey = vi.fn();
        const { adapter } = adapterThat(async (config) => {
            await fs.appendFile(config.knownHostsFile!, `${HOST_KEY_ALIAS} ssh-ed25519 ${key}\n`);
            return { success: false, message: "Permission denied (password)." };
        });

        await adapter.test(configWith({ ...server, onFirstKey }));

        expect(onFirstKey).not.toHaveBeenCalled();
    });

    it("fails a test with the sentence of the mismatch when ssh refused the key", async () => {
        const onMismatch = vi.fn();
        const { adapter } = adapterThat((config) => {
            config.onHostKeyRefused?.(presented);
            return { success: false, message: "Rsync connection failed: Host key verification failed." };
        });

        const result = await adapter.test(configWith({ ...server, pinned, onMismatch })) as { success: boolean; message: string };

        expect(result.success).toBe(false);
        expect(result.message).toContain("backup.example.test:22");
        expect(result.message).toContain(presented);
        expect(result.message).toContain(hostKeyFingerprint(Buffer.from(key, "base64")));
        await vi.waitFor(() => expect(onMismatch).toHaveBeenCalled());
    });

    it("throws the mismatch from an upload that only logged the output of ssh and answered false", async () => {
        const { adapter, calls } = adapterThat((config) => {
            config.onHostKeyRefused?.(null);
            return false;
        });

        await expect(adapter.upload(configWith({ ...server, pinned }))).rejects.toBeInstanceOf(HostKeyMismatchError);
        await expect(fs.stat(path.dirname(calls[0].file!))).rejects.toThrow();
    });

    it("reads a refusal out of the error of a command too", async () => {
        const { adapter } = adapterThat(() => {
            throw new Error(`The fingerprint for the ED25519 key sent by the remote host is ${presented}. Host key verification failed.`);
        });

        const failure = await adapter.upload(configWith({ ...server, pinned })).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(HostKeyMismatchError);
        expect((failure as HostKeyMismatchError).presented).toBe(presented);
    });

    it("keeps the file of a session until the session closes, and fails a transfer whose ssh refused the key", async () => {
        let refuse: ((presented: string | null) => void) | undefined;
        const close = vi.fn(async () => {});
        const { adapter, calls } = adapterThat((config) => {
            refuse = config.onHostKeyRefused;
            return { upload: async () => { if (calls.length > 1) refuse?.(presented); return true; }, close };
        });

        const session = await adapter.openSession(configWith({ ...server, pinned })) as { upload: () => Promise<boolean>; close: () => Promise<void> };
        await expect(fs.readFile(calls[0].file!, "utf8")).resolves.toContain(key);
        await expect(session.upload()).resolves.toBe(true);

        calls.push(calls[0]);
        await expect(session.upload()).rejects.toBeInstanceOf(HostKeyMismatchError);

        await session.close();
        expect(close).toHaveBeenCalled();
        await expect(fs.stat(path.dirname(calls[0].file!))).rejects.toThrow();
    });
});
