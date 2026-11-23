import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => {
    const child = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { logger: { ...child, child: () => child } };
});

import { HostKeyMismatchError, ValidationError } from "@/lib/logging/errors";
import { hostKeyFingerprint, hostKeyMismatch, hostKeyOf, hostKeyType, markHostKey, seenHostKey, sshHostKeyCheck, type SshHostKeyPolicy } from "@/lib/transport/host-key";
import { resolveTransport } from "@/lib/transport/spec";
import { buildConnectConfig } from "@/lib/transport/ssh-connection";

/** A host key blob as SSH frames it: the length of the type, the type, then made-up key bytes. */
function blob(type: string, body: string): Buffer {
    const name = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(name.length);
    return Buffer.concat([length, name, Buffer.from(body)]);
}

const pinnedKey = blob("ssh-ed25519", "the key the connection pinned");
const otherKey = blob("ssh-ed25519", "the key of another server");
const fingerprintOf = (key: Buffer) => `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
const target = { host: "ssh.example.test", port: 2222 };

const policyWith = (extra: Partial<SshHostKeyPolicy> = {}): SshHostKeyPolicy => ({ ...target, ...extra });
const pinned = { type: "ssh-ed25519", key: pinnedKey.toString("base64") };

describe("the fingerprint and type of a host key", () => {
    it("prints the fingerprint the way ssh-keygen does", () => {
        expect(hostKeyFingerprint(pinnedKey)).toBe(fingerprintOf(pinnedKey));
        expect(hostKeyFingerprint(pinnedKey)).not.toContain("=");
    });

    it("reads the type from the blob and keeps the whole key for the pin", () => {
        expect(hostKeyType(pinnedKey)).toBe("ssh-ed25519");
        expect(seenHostKey(pinnedKey)).toEqual({ type: "ssh-ed25519", key: pinnedKey.toString("base64"), fingerprint: fingerprintOf(pinnedKey) });
        expect(hostKeyType(Buffer.from("xx"))).toBe("");
    });
});

describe("the host key check of an SSH login", () => {
    it("accepts the server that presents the pinned key", async () => {
        const onFirstKey = vi.fn();
        const check = sshHostKeyCheck(policyWith({ pinned, onFirstKey }), target);
        expect(check.verifier(pinnedKey)).toBe(true);
        await check.loggedIn();
        expect(onFirstKey).not.toHaveBeenCalled();
    });

    it("refuses a server that presents another key and names both fingerprints", async () => {
        const onMismatch = vi.fn();
        const check = sshHostKeyCheck(policyWith({ pinned, onMismatch }), target);
        expect(check.verifier(otherKey)).toBe(false);

        const error = check.failure(new Error("Host denied (verification failed)"));
        expect(error).toBeInstanceOf(HostKeyMismatchError);
        expect(error).toBeInstanceOf(ValidationError);
        const mismatch = error as HostKeyMismatchError;
        expect(mismatch.message).toContain("ssh.example.test:2222");
        expect(mismatch.message).toContain(fingerprintOf(pinnedKey));
        expect(mismatch.message).toContain(fingerprintOf(otherKey));
        await vi.waitFor(() => expect(onMismatch).toHaveBeenCalledWith({ ...target, expected: fingerprintOf(pinnedKey), presented: fingerprintOf(otherKey) }));
    });

    it("accepts the key of a server without a pin and reports it only once the login succeeded", async () => {
        const onFirstKey = vi.fn();
        const check = sshHostKeyCheck(policyWith({ onFirstKey }), target);
        expect(check.verifier(otherKey)).toBe(true);
        expect(onFirstKey).not.toHaveBeenCalled();
        await check.loggedIn();
        expect(onFirstKey).toHaveBeenCalledWith(seenHostKey(otherKey));
    });

    it("pins nothing for a server whose login never succeeded", () => {
        const onFirstKey = vi.fn();
        const check = sshHostKeyCheck(policyWith({ onFirstKey }), target);
        check.verifier(otherKey);
        const failure = new Error("All configured authentication methods failed");
        expect(check.failure(failure)).toBe(failure);
        expect(onFirstKey).not.toHaveBeenCalled();
    });

    it("accepts every key for a connection with the check switched off, which carries no policy", async () => {
        const check = sshHostKeyCheck(null, target);
        expect(check.verifier(pinnedKey)).toBe(true);
        expect(check.verifier(otherKey)).toBe(true);
        expect(check.algorithms).toBeUndefined();
        await expect(check.loggedIn()).resolves.toBeUndefined();
    });

    it("fails the login when the first key cannot be pinned, like after another login pinned another one", async () => {
        const conflict = hostKeyMismatch(policyWith({ pinned }), fingerprintOf(otherKey));
        const check = sshHostKeyCheck(policyWith({ onFirstKey: () => Promise.reject(conflict) }), target);
        check.verifier(otherKey);
        await expect(check.loggedIn()).rejects.toBe(conflict);
    });

    it("asks the server for a key of the pinned type first", () => {
        const ed = sshHostKeyCheck(policyWith({ pinned }), target);
        expect(ed.algorithms?.serverHostKey[0]).toBe("ssh-ed25519");
        const rsa = sshHostKeyCheck(policyWith({ pinned: { type: "ssh-rsa", key: blob("ssh-rsa", "rsa").toString("base64") } }), target);
        expect(rsa.algorithms?.serverHostKey.slice(0, 3)).toEqual(["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"]);
        expect(rsa.algorithms?.serverHostKey).toContain("ssh-ed25519");
        expect(sshHostKeyCheck(policyWith(), target).algorithms).toBeUndefined();
    });
});

describe("how the policy of a connection reaches its SSH clients", () => {
    it("travels under a symbol, so no stored config and no form sets it", () => {
        const config = markHostKey({ host: "ssh.example.test" }, policyWith({ pinned }));
        expect(hostKeyOf(config)?.pinned).toEqual(pinned);
        expect(hostKeyOf({ ...config })?.pinned).toEqual(pinned);
        expect(hostKeyOf(JSON.parse(JSON.stringify(config)))).toBeNull();
        expect(hostKeyOf(markHostKey(config, null))).toBeNull();
    });

    it("reaches the SSH transport of an SSH-mode connection through its spec", () => {
        const config = markHostKey({ connectionMode: "ssh", sshHost: "ssh.example.test", sshPort: 2222, sshUsername: "backup" }, policyWith({ pinned }));
        const spec = resolveTransport({ id: "mysql" }, config);
        expect(spec.kind === "ssh" && spec.ssh.hostKey?.pinned).toEqual(pinned);
    });

    it("is the verifier of the ssh2 connect config, which refuses another key", () => {
        const config = buildConnectConfig({ ...target, username: "backup", authType: "password", password: "made-up", hostKey: policyWith({ pinned }) });
        const verifier = config.hostVerifier as (key: Buffer) => boolean;
        expect(verifier(pinnedKey)).toBe(true);
        expect(verifier(otherKey)).toBe(false);
        expect(config.algorithms?.serverHostKey).toBeDefined();
    });

    it("leaves a connection without a policy as it was", () => {
        const config = buildConnectConfig({ ...target, username: "backup", authType: "password", password: "made-up" });
        expect((config.hostVerifier as (key: Buffer) => boolean)(otherKey)).toBe(true);
        expect(config.algorithms).toBeUndefined();
    });
});
