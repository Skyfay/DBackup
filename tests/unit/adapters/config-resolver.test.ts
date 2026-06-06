import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveAdapterConfig, overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { registry } from "@/lib/core/registry";
import { ConfigurationError, NotFoundError } from "@/lib/logging/errors";

vi.mock("@/services/auth/credential-service", () => ({
    getDecryptedCredentialData: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
    decryptConfig: vi.fn((c: unknown) => c),
}));

import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import { registerAdapters } from "@/lib/adapters";

registerAdapters();

function buildRow(overrides: Partial<{
    adapterId: string;
    config: object;
    primaryCredentialId: string | null;
    sshCredentialId: string | null;
}> = {}) {
    return {
        id: "ac-1",
        adapterId: overrides.adapterId ?? "mysql",
        config: JSON.stringify(overrides.config ?? { host: "db.local", port: 3306 }),
        primaryCredentialId: overrides.primaryCredentialId ?? null,
        sshCredentialId: overrides.sshCredentialId ?? null,
    };
}

describe("resolveAdapterConfig", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("throws NotFoundError when adapter is unknown", async () => {
        await expect(
            resolveAdapterConfig(buildRow({ adapterId: "no-such-adapter" }))
        ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns structural config unchanged for adapters without credential requirements", async () => {
        const result = (await resolveAdapterConfig(
            buildRow({ adapterId: "local-filesystem", config: { path: "/tmp" } })
        )) as Record<string, unknown>;

        expect(result).toEqual({ path: "/tmp" });
        expect(getDecryptedCredentialData).not.toHaveBeenCalled();
    });

    it("throws ConfigurationError when primary credential is required but missing", async () => {
        await expect(
            resolveAdapterConfig(
                buildRow({ adapterId: "mysql", primaryCredentialId: null })
            )
        ).rejects.toBeInstanceOf(ConfigurationError);
    });

    it("overlays USERNAME_PASSWORD onto both `user` and `username` fields", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            username: "admin",
            password: "secret",
        });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "mysql",
                primaryCredentialId: "cred-1",
                config: { host: "db.local", port: 3306 },
            })
        )) as Record<string, unknown>;

        expect(result.user).toBe("admin");
        expect(result.username).toBe("admin");
        expect(result.password).toBe("secret");
        expect(result.host).toBe("db.local");
    });

    it("overlays SSH slot with `ssh*` prefix when adapter has primary slot", async () => {
        // primary
        (getDecryptedCredentialData as any).mockResolvedValueOnce({
            username: "admin",
            password: "pw",
        });
        // ssh
        (getDecryptedCredentialData as any).mockResolvedValueOnce({
            username: "tunnel",
            authType: "privateKey",
            privateKey: "-----KEY-----",
            passphrase: "ph",
        });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "mysql",
                primaryCredentialId: "cred-primary",
                sshCredentialId: "cred-ssh",
            })
        )) as Record<string, unknown>;

        expect(result.user).toBe("admin");
        expect(result.sshUsername).toBe("tunnel");
        expect(result.sshAuthType).toBe("privateKey");
        expect(result.sshPrivateKey).toBe("-----KEY-----");
        expect(result.sshPassphrase).toBe("ph");
        // Must not clobber primary user with the ssh username
        expect(result.username).toBe("admin");
    });

    it("overlays SSH slot WITHOUT prefix when adapter has no primary slot (SQLite)", async () => {
        (getDecryptedCredentialData as any).mockResolvedValueOnce({
            username: "remoteUser",
            authType: "password",
            password: "remotePw",
        });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "sqlite",
                primaryCredentialId: null,
                sshCredentialId: "cred-ssh",
                config: { mode: "ssh", path: "/db.sqlite", host: "host" },
            })
        )) as Record<string, unknown>;

        expect(result.username).toBe("remoteUser");
        expect(result.password).toBe("remotePw");
        expect(result.authType).toBe("password");
        expect(result.sshUsername).toBeUndefined();
    });

    it("overlays SSH_KEY in primary slot for SFTP-style adapters (no prefix)", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            username: "deploy",
            authType: "privateKey",
            privateKey: "KEY",
        });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "sftp",
                primaryCredentialId: "cred-1",
                config: { host: "files.local", port: 22 },
            })
        )) as Record<string, unknown>;

        expect(result.username).toBe("deploy");
        expect(result.authType).toBe("privateKey");
        expect(result.privateKey).toBe("KEY");
    });

    it("overlays ACCESS_KEY for S3-family adapters", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            accessKeyId: "AKIA",
            secretAccessKey: "sek",
        });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "s3-aws",
                primaryCredentialId: "cred-1",
                config: { bucket: "b", region: "us-east-1" },
            })
        )) as Record<string, unknown>;

        expect(result.accessKeyId).toBe("AKIA");
        expect(result.secretAccessKey).toBe("sek");
    });

    it("overlays TOKEN for token-based notification adapters", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({ token: "T0KEN" });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "gotify",
                primaryCredentialId: "cred-1",
                config: { url: "https://gotify" },
            })
        )) as Record<string, unknown>;

        expect(result.token).toBe("T0KEN");
    });

    it("overlays SMTP onto `user`/`password` for the email adapter", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            user: "noreply",
            password: "smtp-pw",
        });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "email",
                primaryCredentialId: "cred-1",
                config: { host: "smtp.local", port: 587 },
            })
        )) as Record<string, unknown>;

        expect(result.user).toBe("noreply");
        expect(result.password).toBe("smtp-pw");
    });

    it("overlays WEBHOOK onto `webhookUrl`/`url`/`authHeader` for webhook adapters", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            url: "https://hooks.example.com/abc",
            authHeader: "Bearer xyz",
        });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "discord",
                primaryCredentialId: "cred-1",
                config: { username: "Backup Bot" },
            })
        )) as Record<string, unknown>;

        expect(result.webhookUrl).toBe("https://hooks.example.com/abc");
        expect(result.url).toBe("https://hooks.example.com/abc");
        expect(result.authHeader).toBe("Bearer xyz");
    });

    it("overlays TOKEN onto `authToken` for Twilio", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({ token: "tw-secret" });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "twilio-sms",
                primaryCredentialId: "cred-1",
                config: { accountSid: "AC123", from: "+1", to: "+2" },
            })
        )) as Record<string, unknown>;

        expect(result.authToken).toBe("tw-secret");
        expect(result.accountSid).toBe("AC123"); // structural field preserved
    });

    it("overlays OAUTH clientId/clientSecret/refreshToken for cloud storage", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            clientId: "oauth-client-id",
            clientSecret: "oauth-client-secret",
            refreshToken: "oauth-refresh",
        });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "google-drive",
                primaryCredentialId: "cred-1",
                config: { folderId: "root" },
            })
        )) as Record<string, unknown>;

        expect(result.clientId).toBe("oauth-client-id");
        expect(result.clientSecret).toBe("oauth-client-secret");
        expect(result.refreshToken).toBe("oauth-refresh");
        expect(result.folderId).toBe("root");
    });

    it("throws ConfigurationError when config JSON is malformed", async () => {
        await expect(
            resolveAdapterConfig({
                id: "ac-1",
                adapterId: "mysql",
                config: "{ invalid json }",
                primaryCredentialId: "cred-1",
                sshCredentialId: null,
            })
        ).rejects.toBeInstanceOf(ConfigurationError);
    });

    it("throws ConfigurationError when loadAndValidate fails to fetch credential", async () => {
        (getDecryptedCredentialData as any).mockRejectedValueOnce(new Error("Credential not found in vault"));

        await expect(
            resolveAdapterConfig(
                buildRow({ adapterId: "mysql", primaryCredentialId: "cred-missing" })
            )
        ).rejects.toBeInstanceOf(ConfigurationError);
    });

    it("ignores ssh credential when adapter does not declare an ssh slot", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            accessKeyId: "AKIA",
            secretAccessKey: "sek",
        });

        const result = (await resolveAdapterConfig(
            buildRow({
                adapterId: "s3-aws",
                primaryCredentialId: "cred-primary",
                sshCredentialId: "cred-ssh-ignored",
                config: { bucket: "b" },
            })
        )) as Record<string, unknown>;

        // Only the primary credential was loaded
        expect(getDecryptedCredentialData).toHaveBeenCalledTimes(1);
        expect(result.accessKeyId).toBe("AKIA");
    });
});

describe("Adapter credential declarations", () => {
    it("declares correct primary types for representative adapters", () => {
        expect(registry.get("mysql")?.credentials).toEqual({
            primary: "USERNAME_PASSWORD",
            ssh: "SSH_KEY",
        });
        expect(registry.get("s3-aws")?.credentials).toEqual({ primary: "ACCESS_KEY" });
        expect(registry.get("sftp")?.credentials).toEqual({ primary: "SSH_KEY" });
        expect(registry.get("gotify")?.credentials).toEqual({ primary: "TOKEN" });
        expect(registry.get("email")?.credentials).toEqual({ primary: "SMTP", primaryOptional: true });
        expect(registry.get("sqlite")?.credentials).toEqual({ ssh: "SSH_KEY" });
        expect(registry.get("local-filesystem")?.credentials).toBeUndefined();
        expect(registry.get("discord")?.credentials).toEqual({ primary: "WEBHOOK" });
        expect(registry.get("generic-webhook")?.credentials).toEqual({ primary: "WEBHOOK" });
        expect(registry.get("twilio-sms")?.credentials).toEqual({ primary: "TOKEN" });
        expect(registry.get("google-drive")?.credentials).toEqual({ primary: "OAUTH" });
    });
});

describe("overlayCredentialsOnConfig", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("throws NotFoundError for unknown adapter", async () => {
        await expect(
            overlayCredentialsOnConfig("no-such-adapter", {}, null, null)
        ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns config unchanged when adapter has no credential requirements", async () => {
        const config = { path: "/tmp" };
        const result = await overlayCredentialsOnConfig("local-filesystem", config, null, null);
        expect(result).toEqual({ path: "/tmp" });
        expect(getDecryptedCredentialData).not.toHaveBeenCalled();
    });

    it("does NOT throw when primary credential is missing (unlike resolveAdapterConfig)", async () => {
        const config = { host: "db.local" };
        await expect(
            overlayCredentialsOnConfig("mysql", config, null, null)
        ).resolves.not.toThrow();
        expect(getDecryptedCredentialData).not.toHaveBeenCalled();
    });

    it("overlays primary credential when provided", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            username: "alice",
            password: "pw",
        });

        const config: Record<string, unknown> = { host: "db.local" };
        const result = await overlayCredentialsOnConfig("mysql", config, "cred-1", null);

        expect(result.user).toBe("alice");
        expect(result.username).toBe("alice");
        expect(result.password).toBe("pw");
        expect(result.host).toBe("db.local");
    });

    it("overlays SSH credential with ssh* prefix when adapter also has primary slot", async () => {
        (getDecryptedCredentialData as any)
            .mockResolvedValueOnce({ username: "dbuser", password: "dbpw" })
            .mockResolvedValueOnce({
                username: "tunneluser",
                authType: "privateKey",
                privateKey: "KEY",
            });

        const config: Record<string, unknown> = { host: "db.local" };
        const result = await overlayCredentialsOnConfig("mysql", config, "cred-1", "cred-ssh");

        expect(result.user).toBe("dbuser");
        expect(result.sshUsername).toBe("tunneluser");
        expect(result.sshAuthType).toBe("privateKey");
        expect(result.sshPrivateKey).toBe("KEY");
        // Primary must not be clobbered by SSH
        expect(result.username).toBe("dbuser");
    });

    it("mutates and returns the same config object reference", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            username: "u",
            password: "p",
        });

        const config: Record<string, unknown> = { host: "db.local" };
        const result = await overlayCredentialsOnConfig("mysql", config, "cred-1", null);
        expect(result).toBe(config);
    });

    // ── SSH Credential Profile overlay (test-ssh route scenario) ─────────────
    // These tests mirror the exact call made by /api/adapters/test-ssh:
    //   overlayCredentialsOnConfig(adapterId, config, null, sshCredentialId)
    // i.e. only the SSH slot is resolved - no primary credential.

    it("SSH privateKey profile: overlays sshUsername, sshAuthType, sshPrivateKey, sshPassphrase onto DB adapter config", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            username: "root",
            authType: "privateKey",
            privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nKEY\n-----END OPENSSH PRIVATE KEY-----",
            passphrase: "hunter2",
        });

        const config: Record<string, unknown> = { host: "192.168.1.10", port: 5432 };
        const result = await overlayCredentialsOnConfig("postgres", config, null, "ssh-cred-1");

        // ssh* prefix because postgres declares a primary slot
        expect(result.sshUsername).toBe("root");
        expect(result.sshAuthType).toBe("privateKey");
        expect(result.sshPrivateKey).toBe("-----BEGIN OPENSSH PRIVATE KEY-----\nKEY\n-----END OPENSSH PRIVATE KEY-----");
        expect(result.sshPassphrase).toBe("hunter2");
        // Must not write unprefixed fields
        expect(result.username).toBeUndefined();
        expect(result.authType).toBeUndefined();
        // Original fields untouched
        expect(result.host).toBe("192.168.1.10");
        expect(result.port).toBe(5432);
    });

    it("SSH password profile: overlays sshUsername, sshAuthType, sshPassword onto DB adapter config", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            username: "deploy",
            authType: "password",
            password: "s3cr3t",
        });

        const config: Record<string, unknown> = { host: "10.0.0.5", port: 3306 };
        const result = await overlayCredentialsOnConfig("mysql", config, null, "ssh-cred-pw");

        expect(result.sshUsername).toBe("deploy");
        expect(result.sshAuthType).toBe("password");
        expect(result.sshPassword).toBe("s3cr3t");
        // privateKey/passphrase must not be written when absent in profile
        expect(result.sshPrivateKey).toBeUndefined();
        expect(result.sshPassphrase).toBeUndefined();
        // Primary DB credentials must not be touched
        expect(result.user).toBeUndefined();
        expect(result.password).toBeUndefined();
    });

    it("SSH profile without passphrase: does not write sshPassphrase to config", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            username: "ci",
            authType: "privateKey",
            privateKey: "KEY",
            // passphrase intentionally absent
        });

        const config: Record<string, unknown> = { host: "db.local" };
        const result = await overlayCredentialsOnConfig("mongodb", config, null, "ssh-cred-nopass");

        expect(result.sshUsername).toBe("ci");
        expect(result.sshPrivateKey).toBe("KEY");
        expect(result.sshPassphrase).toBeUndefined();
    });

    it("SSH profile on SQLite (no primary slot): overlays unprefixed username/authType/privateKey", async () => {
        (getDecryptedCredentialData as any).mockResolvedValue({
            username: "admin",
            authType: "privateKey",
            privateKey: "KEY",
        });

        const config: Record<string, unknown> = { mode: "ssh", host: "server.local", path: "/db.sqlite" };
        const result = await overlayCredentialsOnConfig("sqlite", config, null, "ssh-cred-sqlite");

        // sqlite has no primary slot -> no ssh* prefix
        expect(result.username).toBe("admin");
        expect(result.authType).toBe("privateKey");
        expect(result.privateKey).toBe("KEY");
        expect(result.sshUsername).toBeUndefined();
    });

    it("SSH profile is skipped when sshCredentialId is null", async () => {
        const config: Record<string, unknown> = { host: "db.local" };
        await overlayCredentialsOnConfig("postgres", config, null, null);

        expect(getDecryptedCredentialData).not.toHaveBeenCalled();
        expect(config.sshUsername).toBeUndefined();
    });
});
