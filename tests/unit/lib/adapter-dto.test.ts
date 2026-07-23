import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const VALID_KEY = "a".repeat(64);

/**
 * Mirrors the reported PoC (read-only user retrieving decrypted adapter secrets):
 * a stored adapter whose secrets are encrypted must, once mapped through the
 * list DTO, expose NO decrypted secret value or secret key to the client.
 */
describe("toAdapterListItem (adapter list DTO)", () => {
    beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", VALID_KEY));
    afterEach(() => vi.unstubAllEnvs());

    async function getModules() {
        vi.resetModules();
        const crypto = await import("@/lib/crypto");
        const dto = await import("@/lib/adapters/dto");
        return { ...crypto, ...dto };
    }

    function baseRow(config: string) {
        return {
            id: "a1",
            name: "Prod",
            type: "storage",
            adapterId: "google-drive",
            config,
            metadata: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            primaryCredentialId: null,
            sshCredentialId: null,
            defaultRetentionPolicyId: null,
            lastHealthCheck: null,
            lastStatus: "ONLINE",
            lastError: null,
            consecutiveFailures: 0,
            storageRole: 'DESTINATION',
        };
    }

    it("never leaks decrypted secret values for an OAuth storage adapter", async () => {
        const { encryptConfig, toAdapterListItem } = await getModules();
        const stored = JSON.stringify(
            encryptConfig({
                clientId: "poc-client-id",
                clientSecret: "POC_CLIENT_SECRET_SHOULD_NOT_LEAK",
                refreshToken: "POC_REFRESH_TOKEN_SHOULD_NOT_LEAK",
                folderId: "root",
            })
        );

        const dto = toAdapterListItem(baseRow(stored));
        const serialized = JSON.stringify(dto);

        expect(serialized).not.toContain("POC_CLIENT_SECRET_SHOULD_NOT_LEAK");
        expect(serialized).not.toContain("POC_REFRESH_TOKEN_SHOULD_NOT_LEAK");

        const cfg = JSON.parse(dto.config);
        expect(cfg.clientId).toBe("poc-client-id"); // non-secret preserved
        expect(cfg.folderId).toBe("root");
        expect("clientSecret" in cfg).toBe(false); // secret key removed entirely
        expect("refreshToken" in cfg).toBe(false);

        // secretStatus reports presence without the value
        expect(dto.secretStatus.clientSecret).toBe(true);
        expect(dto.secretStatus.refreshToken).toBe(true);
    });

    it("reports secretStatus=false for an absent/empty secret", async () => {
        const { encryptConfig, toAdapterListItem } = await getModules();
        const stored = JSON.stringify(encryptConfig({ clientId: "id", clientSecret: "set" }));
        const dto = toAdapterListItem(baseRow(stored));
        expect(dto.secretStatus.clientSecret).toBe(true);
        expect(dto.secretStatus.refreshToken).toBeUndefined();
    });

    it("redacts a database password without dropping structural fields", async () => {
        const { encryptConfig, toAdapterListItem } = await getModules();
        const stored = JSON.stringify(
            encryptConfig({ host: "db.prod", port: 5432, username: "u", password: "TOPSECRET" })
        );
        const dto = toAdapterListItem({ ...baseRow(stored), type: "database", adapterId: "postgres" });
        expect(JSON.stringify(dto)).not.toContain("TOPSECRET");
        const cfg = JSON.parse(dto.config);
        expect(cfg).toEqual({ host: "db.prod", port: 5432, username: "u" });
    });

    it("never leaks a token-type notification secret (Telegram botToken)", async () => {
        const { encryptConfig, toAdapterListItem } = await getModules();
        const stored = JSON.stringify(
            encryptConfig({ botToken: "SECRET_BOT_TOKEN_SHOULD_NOT_LEAK", chatId: "99999" })
        );
        const dto = toAdapterListItem({ ...baseRow(stored), type: "notification", adapterId: "telegram" });
        const serialized = JSON.stringify(dto);

        expect(serialized).not.toContain("SECRET_BOT_TOKEN_SHOULD_NOT_LEAK");
        const cfg = JSON.parse(dto.config);
        expect("botToken" in cfg).toBe(false); // secret key removed entirely
        expect(cfg.chatId).toBe("99999"); // non-secret preserved
        expect(dto.secretStatus.botToken).toBe(true);
    });

    it("never leaks a webhook-type notification secret (Discord webhookUrl)", async () => {
        const { encryptConfig, toAdapterListItem } = await getModules();
        const stored = JSON.stringify(
            encryptConfig({ webhookUrl: "https://discord.com/api/webhooks/SECRET_HOOK", username: "Backup Bot" })
        );
        const dto = toAdapterListItem({ ...baseRow(stored), type: "notification", adapterId: "discord" });
        const serialized = JSON.stringify(dto);

        expect(serialized).not.toContain("https://discord.com/api/webhooks/SECRET_HOOK");
        const cfg = JSON.parse(dto.config);
        expect("webhookUrl" in cfg).toBe(false); // secret key removed entirely
        expect(cfg.username).toBe("Backup Bot"); // non-secret preserved
        expect(dto.secretStatus.webhookUrl).toBe(true);
    });

    it("returns an empty config for unparseable stored config (no raw leak)", async () => {
        const { toAdapterListItem } = await getModules();
        const dto = toAdapterListItem(baseRow("not-json"));
        expect(dto.config).toBe("{}");
        expect(dto.secretStatus).toEqual({});
    });
});
