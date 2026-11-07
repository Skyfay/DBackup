// @vitest-environment node
/**
 * The destination, the saved logins of that destination and the key the configuration backup goes
 * through. The file holds every secret of the instance, so whoever may change the destination or
 * its login sends the next file where they like, and whoever reveals the key opens it. Only a
 * platform admin with a session changes, deletes, reveals or exports them, a member of the home
 * tenant with the rights of a destination, a login or the Vault does not, and neither does an API key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CONFIG_BACKUP_DESTINATION_LOCKED, CONFIG_BACKUP_KEY_LOCKED, CONFIG_BACKUP_LOGIN_LOCKED } from "@/lib/core/config-backup-locks";
import { CONFIG_BACKUP_ADMIN_ONLY } from "@/lib/server/config-backup-guard";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" | "apikey" };

const MEMBER: Ctx = { userId: "mia", tenantId: "default", allTenants: false, isPlatformAdmin: false, permissions: [], authMethod: "session" };
const ADMIN: Ctx = { ...MEMBER, userId: "ada", isPlatformAdmin: true };
const ADMIN_KEY: Ctx = { ...ADMIN, authMethod: "apikey" };

const mocks = vi.hoisted(() => ({
    ctx: null as unknown as Ctx,
    targets: { storageId: "nas" as string | null, profileId: "config-key" as string | null, credentialIds: ["nas-login"] },
    updateAdapter: vi.fn(),
    deleteAdapter: vi.fn(),
    deleteAdapters: vi.fn(),
    updateAdapterFlags: vi.fn(),
    updateCredential: vi.fn(),
    deleteCredential: vi.fn(),
    deleteCredentials: vi.fn(),
    getCredential: vi.fn(),
    decryptCredential: vi.fn(),
    getProfile: vi.fn(),
    decryptKey: vi.fn(),
    deleteProfile: vi.fn(),
    deleteProfiles: vi.fn(),
    updateProfile: vi.fn(),
    recoverKey: vi.fn(),
    isConfigBackupFile: vi.fn(),
    consumeState: vi.fn(),
    logFor: vi.fn(),
    log: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/server/request-headers", () => ({ requestHeaders: async () => new Headers() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => mocks.ctx,
    checkPermissionWithContext: vi.fn(),
    checkAnyPermissionWithContext: vi.fn(),
    hasPermissionWithContext: () => true,
    tenantOf: (ctx: Ctx) => ctx.tenantId,
    tenantRefusal: () => null,
    checkPermission: async () => ({ id: mocks.ctx.userId, isPlatformAdmin: mocks.ctx.isPlatformAdmin, tenantId: mocks.ctx.tenantId }),
    checkPlatformAdmin: vi.fn(),
    hasPermission: async () => true,
}));
vi.mock("@/services/config/config-backup-targets", () => ({ getConfigBackupTargets: async () => mocks.targets }));
vi.mock("@/services/adapters/adapter-list", () => ({ getAdapterType: async () => "storage" }));
vi.mock("@/services/adapters/adapter-update", () => ({ updateAdapter: mocks.updateAdapter, UnsupportedSettingError: class extends Error {} }));
vi.mock("@/services/adapters/adapter-service", () => ({
    deleteAdapter: mocks.deleteAdapter,
    deleteAdapters: mocks.deleteAdapters,
    updateAdapterFlags: mocks.updateAdapterFlags,
    getAdapterTypes: async () => ["storage"],
}));
vi.mock("@/services/auth/credential-service", () => ({
    updateCredentialProfile: mocks.updateCredential,
    deleteCredentialProfile: mocks.deleteCredential,
    deleteCredentialProfiles: mocks.deleteCredentials,
    getCredentialProfile: mocks.getCredential,
    getDecryptedCredentialData: mocks.decryptCredential,
}));
vi.mock("@/services/auth/credential-audit", () => ({
    credentialSnapshot: async () => null,
    credentialChanges: () => [],
    credentialName: async () => "NAS login",
}));
vi.mock("@/services/backup/encryption-service", () => ({
    getEncryptionProfile: mocks.getProfile,
    getDecryptedMasterKey: mocks.decryptKey,
    deleteEncryptionProfile: mocks.deleteProfile,
    deleteEncryptionProfiles: mocks.deleteProfiles,
    updateEncryptionProfile: mocks.updateProfile,
    getEncryptionProfiles: async () => [],
    markRecoveryKit: vi.fn(),
}));
vi.mock("@/services/backup/recovery-kit", () => ({ buildRecoveryKit: async () => Buffer.from("zip") }));
vi.mock("@/services/backup/key-recovery", () => ({ recoverEncryptionKey: mocks.recoverKey }));
vi.mock("@/services/backup/archive-index-service", () => ({ archiveIndexService: { clear: vi.fn() } }));
vi.mock("@/services/storage/config-backup-access", () => ({ isConfigBackupFile: mocks.isConfigBackupFile }));
vi.mock("@/lib/auth/oauth-state", () => ({ consumeOAuthState: mocks.consumeState, createOAuthState: () => "state" }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor, logForStrict: mocks.logFor, log: mocks.log } }));

const { configBackupTargetRefusal } = await import("@/lib/server/config-backup-target-guard");
const adapterRoute = await import("@/app/api/adapters/[id]/route");
const { POST: bulkAdapters } = await import("@/app/api/adapters/bulk/route");
const credentialRoute = await import("@/app/api/credentials/[id]/route");
const { GET: revealCredential } = await import("@/app/api/credentials/[id]/reveal/route");
const { POST: bulkCredentials } = await import("@/app/api/credentials/bulk/route");
const { POST: recoveryKit } = await import("@/app/api/vault/recovery-kit/route");
const { POST: dropboxAuth } = await import("@/app/api/adapters/dropbox/auth/route");
const { oauthCallbackCaller } = await import("@/lib/server/oauth-callback");
const encryption = await import("@/app/actions/backup/encryption");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body: unknown) => new NextRequest(url, { method, body: JSON.stringify(body) });
const errorOf = async (response: Response) => ((await response.json()) as { error?: string }).error;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.ctx = MEMBER;
    mocks.targets = { storageId: "nas", profileId: "config-key", credentialIds: ["nas-login"] };
    mocks.updateAdapter.mockResolvedValue({ adapter: { id: "nas", name: "NAS", type: "storage", adapterId: "local", config: "{}", createdAt: new Date(), updatedAt: new Date() }, previousName: "NAS", changes: [] });
    mocks.deleteAdapter.mockResolvedValue({ name: "NAS" });
    mocks.getCredential.mockResolvedValue({ id: "nas-login", name: "NAS login", type: "USERNAME_PASSWORD" });
    mocks.decryptCredential.mockResolvedValue({ username: "backup", password: "secret" });
    mocks.getProfile.mockImplementation(async (id: string) => ({ id, name: id }));
    mocks.decryptKey.mockResolvedValue("00".repeat(32));
    mocks.deleteProfile.mockResolvedValue({ name: "Config key" });
    mocks.isConfigBackupFile.mockResolvedValue(true);
    mocks.recoverKey.mockResolvedValue({ status: "existing" });
    mocks.updateProfile.mockImplementation(async (id: string, input: { name: string }) => ({ profile: { id, name: input.name, description: null }, previousName: id, previousDescription: null }));
});

describe("who changes what the configuration backup goes through", () => {
    it("is a platform admin with a session, never a member or an API key of a platform admin", async () => {
        const query = { connectionIds: ["nas"], credentialIds: ["nas-login"], profileIds: ["config-key"] };

        expect(await configBackupTargetRefusal(ADMIN, query)).toBeNull();
        expect(await configBackupTargetRefusal(MEMBER, query)).toBe(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(await configBackupTargetRefusal(ADMIN_KEY, { credentialIds: ["nas-login"] })).toBe(CONFIG_BACKUP_LOGIN_LOCKED);
        expect(await configBackupTargetRefusal(MEMBER, { profileIds: ["config-key"] })).toBe(CONFIG_BACKUP_KEY_LOCKED);
    });

    it("leaves every other destination, login and key to the rights of the caller", async () => {
        expect(await configBackupTargetRefusal(MEMBER, { connectionIds: ["s3"], credentialIds: ["s3-login"], profileIds: ["job-key"] })).toBeNull();
        mocks.targets = { storageId: null, profileId: null, credentialIds: [] };
        expect(await configBackupTargetRefusal(MEMBER, { connectionIds: ["nas"], profileIds: ["config-key"] })).toBeNull();
    });
});

describe("the destination of the configuration backup", () => {
    it("is not pointed elsewhere or given another login by a member", async () => {
        const response = await adapterRoute.PUT(json("http://localhost/api/adapters/nas", "PUT", { name: "NAS", config: { basePath: "/mnt/mine" }, primaryCredentialId: "my-login" }), params("nas"));

        expect(response.status).toBe(403);
        expect(await errorOf(response)).toBe(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(mocks.updateAdapter).not.toHaveBeenCalled();
    });

    it("is not deleted by a member, one or in a selection", async () => {
        const one = await adapterRoute.DELETE(new NextRequest("http://localhost/api/adapters/nas", { method: "DELETE" }), params("nas"));
        const many = await bulkAdapters(json("http://localhost/api/adapters/bulk", "POST", { action: "delete", ids: ["s3", "nas"] }));
        const flags = await bulkAdapters(json("http://localhost/api/adapters/bulk", "POST", { action: "mark-air-gapped", ids: ["nas"] }));

        expect([one.status, many.status, flags.status]).toEqual([403, 403, 403]);
        expect(mocks.deleteAdapter).not.toHaveBeenCalled();
        expect(mocks.deleteAdapters).not.toHaveBeenCalled();
        expect(mocks.updateAdapterFlags).not.toHaveBeenCalled();
    });

    it("is changed by a platform admin", async () => {
        mocks.ctx = ADMIN;

        const response = await adapterRoute.PUT(json("http://localhost/api/adapters/nas", "PUT", { name: "NAS" }), params("nas"));

        expect(response.status).toBe(200);
        expect(mocks.updateAdapter).toHaveBeenCalledOnce();
    });
});

describe("the saved login of the destination of the configuration backup", () => {
    it("is not revealed to a member, and nothing is decrypted", async () => {
        const response = await revealCredential(new NextRequest("http://localhost/api/credentials/nas-login/reveal"), params("nas-login"));

        expect(response.status).toBe(403);
        expect(await errorOf(response)).toBe(CONFIG_BACKUP_LOGIN_LOCKED);
        expect(mocks.decryptCredential).not.toHaveBeenCalled();
        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("is not revealed through an API key of a platform admin", async () => {
        mocks.ctx = ADMIN_KEY;

        const response = await revealCredential(new NextRequest("http://localhost/api/credentials/nas-login/reveal"), params("nas-login"));

        expect(response.status).toBe(403);
    });

    it("is not changed or deleted by a member", async () => {
        const changed = await credentialRoute.PUT(json("http://localhost/api/credentials/nas-login", "PUT", { data: { username: "me", password: "mine" } }), params("nas-login"));
        const deleted = await credentialRoute.DELETE(new NextRequest("http://localhost/api/credentials/nas-login", { method: "DELETE" }), params("nas-login"));
        const bulk = await bulkCredentials(json("http://localhost/api/credentials/bulk", "POST", { action: "delete", ids: ["nas-login"] }));

        expect([changed.status, deleted.status, bulk.status]).toEqual([403, 403, 403]);
        expect(mocks.updateCredential).not.toHaveBeenCalled();
        expect(mocks.deleteCredential).not.toHaveBeenCalled();
        expect(mocks.deleteCredentials).not.toHaveBeenCalled();
    });

    it("gets no new OAuth token of another account from a member", async () => {
        mocks.ctx = { ...MEMBER, permissions: ["credentials:write"] };
        mocks.consumeState.mockReturnValue({ credentialId: "nas-login" });

        const started = await dropboxAuth(json("http://localhost/api/adapters/dropbox/auth", "POST", { credentialId: "nas-login" }));
        const caller = await oauthCallbackCaller("dropbox", "state");

        expect(started.status).toBe(403);
        expect(caller).toEqual({ ok: false, code: "locked", message: CONFIG_BACKUP_LOGIN_LOCKED });
        expect(mocks.decryptCredential).not.toHaveBeenCalled();
    });

    it("is revealed to a platform admin", async () => {
        mocks.ctx = ADMIN;

        const response = await revealCredential(new NextRequest("http://localhost/api/credentials/nas-login/reveal"), params("nas-login"));

        expect(response.status).toBe(200);
    });
});

describe("the key of the configuration backup", () => {
    it("is not revealed, deleted or put into a recovery kit by a member", async () => {
        const revealed = await encryption.revealMasterKey("config-key");
        const deleted = await encryption.deleteEncryptionProfile("config-key");
        const bulk = await encryption.bulkDeleteEncryptionProfiles(["job-key", "config-key"]);
        const kit = await recoveryKit(new NextRequest("http://localhost/api/vault/recovery-kit", { method: "POST", body: JSON.stringify({ ids: ["job-key", "config-key"] }) }));

        expect(revealed).toEqual({ success: false, error: CONFIG_BACKUP_KEY_LOCKED });
        expect(deleted).toEqual({ success: false, error: CONFIG_BACKUP_KEY_LOCKED });
        expect(bulk).toEqual({ success: false, error: CONFIG_BACKUP_KEY_LOCKED });
        expect(kit.status).toBe(403);
        expect(await kit.text()).toBe(CONFIG_BACKUP_KEY_LOCKED);
        expect(mocks.decryptKey).not.toHaveBeenCalled();
        expect(mocks.deleteProfile).not.toHaveBeenCalled();
        expect(mocks.deleteProfiles).not.toHaveBeenCalled();
    });

    it("is revealed and put into a kit by a platform admin", async () => {
        mocks.ctx = ADMIN;

        expect(await encryption.revealMasterKey("config-key")).toEqual({ success: true, data: "00".repeat(32) });
        expect((await recoveryKit(new NextRequest("http://localhost/api/vault/recovery-kit", { method: "POST", body: JSON.stringify({ ids: ["config-key"] }) }))).status).toBe(200);
    });

    it("leaves the other keys to the rights of the Vault", async () => {
        expect(await encryption.revealMasterKey("job-key")).toEqual({ success: true, data: "00".repeat(32) });
    });
});

describe("a key tried on a configuration backup file", () => {
    it("is refused to a member before the file is read", async () => {
        const result = await encryption.recoverEncryptionKeyAction("nas", "config-backups/config_backup_1.db.gz.enc", "ab".repeat(32));

        expect(result).toEqual({ success: false, error: CONFIG_BACKUP_ADMIN_ONLY });
        expect(mocks.isConfigBackupFile).toHaveBeenCalledWith("nas", "config-backups/config_backup_1.db.gz.enc", "default");
        expect(mocks.recoverKey).not.toHaveBeenCalled();
    });

    it("goes on for a backup of a job", async () => {
        mocks.isConfigBackupFile.mockResolvedValue(false);

        const result = await encryption.recoverEncryptionKeyAction("nas", "nightly/shop.tar", "ab".repeat(32));

        expect(result.success).toBe(true);
        expect(mocks.recoverKey).toHaveBeenCalledOnce();
    });

    it("logs a key of the Vault that now opens the backups of another profile id too, and only the try when it changed nothing", async () => {
        mocks.isConfigBackupFile.mockResolvedValue(false);
        mocks.recoverKey.mockResolvedValueOnce({ status: "existing", profileId: "k1", profileName: "Nightly key", notedFor: "gone-key" });

        expect((await encryption.recoverEncryptionKeyAction("nas", "nightly/shop.tar", "ab".repeat(32))).success).toBe(true);
        expect(mocks.log).toHaveBeenCalledWith(MEMBER.userId, "UPDATE", "VAULT", { type: "EncryptionProfile", name: "Nightly key", method: "Recovery", standsFor: "gone-key" }, "k1");

        mocks.log.mockClear();
        mocks.recoverKey.mockResolvedValueOnce({ status: "existing", profileId: "k1", profileName: "Nightly key" });
        expect((await encryption.recoverEncryptionKeyAction("nas", "nightly/shop.tar", "ab".repeat(32))).success).toBe(true);
        expect(mocks.log).toHaveBeenCalledOnce();
        expect(mocks.log).toHaveBeenCalledWith(MEMBER.userId, "EXECUTE", "VAULT", expect.objectContaining({ action: "key_check", success: true }), "k1");
    });
});

describe("the key of the configuration backup in the Vault", () => {
    it("is renamed only by a platform admin with a session", async () => {
        expect(await encryption.updateEncryptionProfile("config-key", { name: "Renamed" })).toEqual({ success: false, error: CONFIG_BACKUP_KEY_LOCKED });
        expect(mocks.updateProfile).not.toHaveBeenCalled();

        mocks.ctx = ADMIN;
        expect((await encryption.updateEncryptionProfile("config-key", { name: "Renamed" })).success).toBe(true);
        expect(mocks.updateProfile).toHaveBeenCalledOnce();
    });

    it("leaves the other keys to the rights of the Vault", async () => {
        expect((await encryption.updateEncryptionProfile("job-key", { name: "Renamed" })).success).toBe(true);
    });

    it("notes no other backups it opens for a member who recovers it on a backup of a job", async () => {
        mocks.isConfigBackupFile.mockResolvedValue(false);
        // Like the service: it asks before a key the Vault holds notes the profile id of the backup.
        mocks.recoverKey.mockImplementation(async (_storage: string, _file: string, _key: string, _name: string | undefined, options?: { beforeNote?: (id: string) => Promise<void> }) => {
            await options?.beforeNote?.("config-key");
            return { status: "existing", profileId: "config-key", profileName: "Config key", notedFor: "gone-key" };
        });

        expect(await encryption.recoverEncryptionKeyAction("nas", "nightly/shop.tar", "ab".repeat(32))).toEqual({ success: false, error: CONFIG_BACKUP_KEY_LOCKED });
        expect(mocks.log).not.toHaveBeenCalled();

        mocks.ctx = ADMIN;
        expect((await encryption.recoverEncryptionKeyAction("nas", "nightly/shop.tar", "ab".repeat(32))).success).toBe(true);
    });
});
