import { describe, expect, it } from "vitest";

import { firstKnownHostKey, HOST_KEY_ALIAS, isHostKey, knownHostsLine, opensshHostKeyOptions, opensshRefusal } from "@/lib/transport/host-key-openssh";
import { hostKeyFingerprint } from "@/lib/transport/host-key";

const key = Buffer.from("made-up host key blob").toString("base64");

describe("the options rsync gives the OpenSSH client for the host key", () => {
    it("accepts every key and remembers none for a connection with the check switched off", () => {
        expect(opensshHostKeyOptions()).toEqual(["StrictHostKeyChecking=no", "UserKnownHostsFile=/dev/null", "LogLevel=ERROR"]);
    });

    it("refuses any key but the pinned one of the file of the call", () => {
        const options = opensshHostKeyOptions({ file: "/tmp/rsync-hosts-abc/known_hosts", pinned: true });
        expect(options).toContain("StrictHostKeyChecking=yes");
        expect(options).toContain("UserKnownHostsFile=/tmp/rsync-hosts-abc/known_hosts");
        expect(options).toContain("GlobalKnownHostsFile=/dev/null");
        expect(options).toContain("UpdateHostKeys=no");
    });

    it("takes the first key into an empty file for a connection without a pin", () => {
        const options = opensshHostKeyOptions({ file: "/tmp/rsync-hosts-abc/known_hosts", pinned: false });
        expect(options).toContain("StrictHostKeyChecking=accept-new");
        expect(options).not.toContain("StrictHostKeyChecking=yes");
        expect(options).toContain("UserKnownHostsFile=/tmp/rsync-hosts-abc/known_hosts");
    });

    it("looks the key up under an alias, so dialing a checked address instead of the name finds the same pin", () => {
        for (const pinned of [true, false]) {
            expect(opensshHostKeyOptions({ file: "/tmp/x/known_hosts", pinned })).toContain(`HostKeyAlias=${HOST_KEY_ALIAS}`);
        }
        expect(knownHostsLine({ type: "ssh-ed25519", key })).toBe(`${HOST_KEY_ALIAS} ssh-ed25519 ${key}`);
    });
});

describe("the known_hosts file of a call", () => {
    it("refuses a pin that would write a line or an option of its own", () => {
        expect(() => knownHostsLine({ type: "ssh-ed25519\nother-host ssh-rsa", key })).toThrow();
        expect(() => knownHostsLine({ type: "ssh-ed25519", key: `${key} extra` })).toThrow();
        expect(isHostKey("ssh-ed25519", key)).toBe(true);
        expect(isHostKey("ssh-ed25519", 5)).toBe(false);
    });

    it("reads the key ssh wrote on a first login, whatever name the line carries", () => {
        const seen = firstKnownHostKey(`# comment\n|1|hashed|name ssh-ed25519 ${key}\n`);
        expect(seen).toEqual({ type: "ssh-ed25519", key, fingerprint: hostKeyFingerprint(Buffer.from(key, "base64")) });
        expect(firstKnownHostKey("")).toBeNull();
    });
});

describe("the output of ssh about a refused host key", () => {
    const presented = "SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/AbCdE";

    it("recognizes a changed key and the fingerprint ssh printed for it", () => {
        const output = [
            "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @",
            "The fingerprint for the ED25519 key sent by the remote host is",
            `${presented}.`,
            "Host key verification failed.",
        ].join("\n");
        expect(opensshRefusal(output)).toEqual({ presented });
    });

    it("recognizes a server that only offers a key of another type", () => {
        expect(opensshRefusal("No ED25519 host key is known for dbackup-pinned-host and you have requested strict checking.\nHost key verification failed.")).toEqual({ presented: null });
    });

    it("leaves a refused login or an unreachable host alone", () => {
        expect(opensshRefusal("Permission denied (publickey,password).")).toBeNull();
        expect(opensshRefusal("ssh: connect to host 192.0.2.1 port 22: Connection refused")).toBeNull();
    });
});
