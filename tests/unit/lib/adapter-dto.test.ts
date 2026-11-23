import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const VALID_KEY = "a".repeat(64);

// Loading `@/lib/adapters/dto` means loading every adapter behind `registerAdapters` - ssh2, the
// AWS and Google SDKs, the database drivers. That is seconds of work on its own, and the default
// five-second budget is measured while the rest of the suite competes for the same cores, so the
// first test here paid a cost that has nothing to do with what it asserts.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Mirrors the reported PoC (read-only user retrieving decrypted adapter secrets):
 * a stored adapter whose secrets are encrypted must, once mapped through the
 * list DTO, expose NO decrypted secret value or secret key to the client.
 */
describe("toAdapterListItem (adapter list DTO)", () => {
    beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", VALID_KEY));
    afterEach(() => vi.unstubAllEnvs());

    // Loaded once for the file, not once per test. `@/lib/adapters/dto` pulls in
    // `registerAdapters`, and with it every adapter - ssh2, the AWS and Google SDKs, the database
    // drivers. Resetting the module registry before each test made the suite re-evaluate that
    // whole graph six times, which is fine on its own and intermittently overran the five-second
    // timeout once the rest of the suite was competing for the same cores. Every test here stubs
    // the same key, so one load serves them all.
    let modules: ReturnType<typeof loadModules> | null = null;

    async function loadModules() {
        const crypto = await import("@/lib/crypto");
        const dto = await import("@/lib/adapters/dto");
        return { ...crypto, ...dto };
    }

    function getModules() {
        if (!modules) {
            vi.resetModules();
            modules = loadModules();
        }
        return modules;
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

    it("keeps the extra headers of a Generic Webhook, which carry API keys, encrypted and out of the DTO", async () => {
        const { encryptConfig, mergeSecrets, toAdapterListItem } = await getModules();
        const headers = "X-Api-Key: SECRET_KEY:with:colons";
        const encrypted = encryptConfig({ webhookUrl: "https://hooks.example.com/in", method: "POST", customHeaders: headers });
        expect(encrypted.customHeaders).not.toBe(headers);

        const dto = toAdapterListItem({ ...baseRow(JSON.stringify(encrypted)), type: "notification", adapterId: "generic-webhook" });
        expect(JSON.stringify(dto)).not.toContain("SECRET_KEY");
        const cfg = JSON.parse(dto.config);
        expect("customHeaders" in cfg).toBe(false);
        expect(cfg.method).toBe("POST");
        expect(dto.secretStatus.customHeaders).toBe(true);

        // An edit that leaves the field blank keeps the saved headers.
        expect(mergeSecrets({ ...cfg, customHeaders: "" }, { customHeaders: headers }).customHeaders).toBe(headers);
    });

    it("returns an empty config for unparseable stored config (no raw leak)", async () => {
        const { toAdapterListItem } = await getModules();
        const dto = toAdapterListItem(baseRow("not-json"));
        expect(dto.config).toBe("{}");
        expect(dto.secretStatus).toEqual({});
    });

    it("says why a connection reaches the server DBackup runs on, so the form opens it read-only for anyone but a platform admin", async () => {
        const { encryptConfig, toAdapterListItem } = await getModules();
        const row = (adapterId: string, config: Record<string, unknown>) => ({ ...baseRow(JSON.stringify(encryptConfig(config))), adapterId });

        expect(toAdapterListItem(row("local-filesystem", { basePath: "/srv" })).hostLocal).toBe("Local Filesystem reaches the server DBackup runs on, which only a platform admin adds.");
        expect(toAdapterListItem({ ...row("sqlite", { mode: "local", path: "/srv/app.db" }), type: "database" }).hostLocal).toContain("SQLite in local mode");
        expect(toAdapterListItem(row("google-drive", { folderId: "root" })).hostLocal).toBeNull();
    });
});
