import { describe, expect, it } from "vitest";
import { holdsOf, shortFingerprint, sshKeyType } from "@/lib/core/credential-holds";

describe("holdsOf", () => {
    it("names the user of a login and of an SMTP account", () => {
        expect(holdsOf("USERNAME_PASSWORD", { username: "admin", password: "secret" })).toEqual({ holds: "user admin", attention: null });
        expect(holdsOf("SMTP", { user: "backup@example.com", password: "secret" }).holds).toBe("user backup@example.com");
    });

    it("tells an SSH key by its kind and fingerprint, and the other ways in by the user", () => {
        const payload = { username: "backup", authType: "privateKey", privateKey: "-----BEGIN", publicKey: "ssh-ed25519 AAAAC3Nza backup@nas" };
        expect(holdsOf("SSH_KEY", payload, "SHA256:3Lk2x9Vf0aQm8Rt1uWz49dQw").holds).toBe("ed25519 · SHA256:3Lk2…9dQw");
        expect(holdsOf("SSH_KEY", { username: "backup", authType: "password", password: "x" }).holds).toBe("user backup, password");
        expect(holdsOf("SSH_KEY", { username: "backup", authType: "agent" }).holds).toBe("user backup, SSH agent");
    });

    it("never shows an access key ID, a token or the path of a webhook", () => {
        expect(holdsOf("ACCESS_KEY", { accessKeyId: "AKIA123", secretAccessKey: "s" }).holds).toBe("key ID and secret");
        expect(holdsOf("TOKEN", { token: "t" }).holds).toBe("token");
        expect(holdsOf("WEBHOOK", { url: "https://discord.com/api/webhooks/1/abc", authHeader: "Bearer x" }).holds).toBe("discord.com, auth header");
    });

    it("asks for a look at an OAuth app that was never authorized", () => {
        expect(holdsOf("OAUTH", { clientId: "id", clientSecret: "s", refreshToken: "r" })).toEqual({ holds: "authorized", attention: null });
        expect(holdsOf("OAUTH", { clientId: "id", clientSecret: "s" }).attention).toMatch(/never authorized/);
    });
});

describe("key helpers", () => {
    it("names the kind of a public key and cuts a fingerprint", () => {
        expect(sshKeyType("ecdsa-sha2-nistp256 AAAA")).toBe("ECDSA P-256");
        expect(sshKeyType(undefined)).toBeNull();
        expect(shortFingerprint("SHA256:abcd")).toBe("SHA256:abcd");
    });
});
