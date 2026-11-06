// @vitest-environment node
/**
 * The destination of the configuration backup and its files, through the routes besides changing
 * and deleting the connection itself. Whoever fills its stored secrets into a config of a form with
 * a host of their own, or copies it, sends its password where they like. Whoever deletes or locks a
 * configuration backup, writes files into its destination or shares it with customers changes what
 * the platform keeps. Only a platform admin with a session does any of that.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CONFIG_BACKUP_DESTINATION_LOCKED, CONFIG_BACKUP_LOGIN_APPLY_LOCKED } from "@/lib/core/config-backup-locks";
import { CONFIG_BACKUP_ADMIN_ONLY } from "@/lib/server/config-backup-guard";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" | "apikey" };

const MEMBER: Ctx = { userId: "mia", tenantId: "default", allTenants: false, isPlatformAdmin: false, permissions: [], authMethod: "session" };
const ADMIN: Ctx = { ...MEMBER, userId: "ada", isPlatformAdmin: true };
const ADMIN_KEY: Ctx = { ...ADMIN, authMethod: "apikey" };

const mocks = vi.hoisted(() => ({
    ctx: null as unknown as Ctx,
    testConnection: vi.fn(),
    browseLocation: vi.fn(),
    applyStoredSecrets: vi.fn(),
    getDatabases: vi.fn(),
    cloneAdapter: vi.fn(),
    deleteFile: vi.fn(),
    toggleLock: vi.fn(),
    deleteBackupsBulk: vi.fn(),
    setBackupsLocked: vi.fn(),
    restoreFilesToStorage: vi.fn(),
    planFileRestore: vi.fn(),
    shareSave: vi.fn(),
    createAdapter: vi.fn(),
    updateAdapter: vi.fn(),
    listRemote: vi.fn(),
    logFor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
}));
// The configuration backup writes to "nas", its files lie under config-backups/.
vi.mock("@/services/config/config-backup-targets", () => ({ getConfigBackupTargets: async () => ({ storageId: "nas", profileId: "config-key", credentialIds: ["nas-login"] }) }));
vi.mock("@/services/storage/config-backup-access", () => ({ isConfigBackupFile: async (_storageId: string, file: string) => file.startsWith("config-backups/") }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: () => ({ getDatabases: mocks.getDatabases }) } }));
vi.mock("@/lib/transport", () => ({ withHost: (_adapter: unknown, config: unknown, fn: (host: unknown) => unknown) => fn(config) }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    applyStoredSecrets: mocks.applyStoredSecrets,
    overlayCredentialsOnConfig: async (_adapterId: string, config: unknown) => config,
    assertConfigOffHost: async () => undefined,
    withoutBinaryPaths: (config: unknown) => config,
}));
vi.mock("@/services/adapters/connection-test", () => ({ testConnection: mocks.testConnection }));
vi.mock("@/services/adapters/location-browse-service", () => ({ browseLocation: mocks.browseLocation }));
vi.mock("@/services/adapters/adapter-clone", () => ({ cloneAdapter: mocks.cloneAdapter }));
vi.mock("@/services/adapters/adapter-list", () => ({
    getAdapterType: async () => "storage",
    getConnectionLoginIds: async (id: string) => (id === "twin" ? ["nas-login"] : []),
    listAdapters: vi.fn(),
}));
vi.mock("@/services/adapters/adapter-create", () => ({ createAdapter: mocks.createAdapter }));
vi.mock("@/services/adapters/adapter-update", () => ({ updateAdapter: mocks.updateAdapter, UnsupportedSettingError: class extends Error {} }));
vi.mock("@/services/adapters/adapter-service", () => ({ deleteAdapter: vi.fn() }));
vi.mock("@/services/system/filesystem-service", () => ({ listRemoteDirectory: mocks.listRemote }));
vi.mock("@/lib/adapters/dto", () => ({ toAdapterListItem: (row: unknown) => row }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { deleteFile: mocks.deleteFile, toggleLock: mocks.toggleLock } }));
vi.mock("@/services/storage/bulk-delete", () => ({ deleteBackupsBulk: mocks.deleteBackupsBulk, setBackupsLocked: mocks.setBackupsLocked }));
vi.mock("@/services/storage/backup-audit", () => ({
    backupAuditDetails: async (_id: string, file: string) => ({ file }),
    destinationAuditName: async () => "NAS",
    fileRestoreTarget: async () => ({}),
}));
vi.mock("@/services/dashboard-service", () => ({ refreshStorageStatsCache: async () => undefined }));
vi.mock("@/services/restore/file-restore", () => ({ planFileRestore: mocks.planFileRestore, restoreFilesToStorage: mocks.restoreFilesToStorage }));
vi.mock("@/services/restore/archive-download", () => ({ planArchiveDownload: vi.fn(), openArchiveDownload: vi.fn() }));
vi.mock("@/lib/auth/download-tokens", () => ({ generateSelectionDownloadToken: vi.fn(), consumeSelectionDownloadToken: vi.fn() }));
vi.mock("@/services/sharing/connection-shares", () => ({
    connectionShareService: { save: mocks.shareSave, view: async () => ({ kind: "storage", uses: [] }), losing: async () => [] },
    ShareChangeError: class extends Error {},
    UNCONFIRMED_LOSS: { storage: "Confirm it first.", notification: "Confirm it first." },
}));
vi.mock("@/services/sharing/share-audit", () => ({ logShareChange: vi.fn() }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { reachOf: async () => null } }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor, log: vi.fn() } }));

const { POST: testConnectionRoute } = await import("@/app/api/adapters/test-connection/route");
const { POST: browseLocationRoute } = await import("@/app/api/adapters/browse-location/route");
const { POST: accessCheckRoute } = await import("@/app/api/adapters/access-check/route");
const { POST: cloneRoute } = await import("@/app/api/adapters/[id]/clone/route");
const { DELETE: deleteFileRoute } = await import("@/app/api/storage/[id]/files/route");
const { POST: bulkFilesRoute } = await import("@/app/api/storage/[id]/files/bulk/route");
const { POST: restoreFilesRoute } = await import("@/app/api/storage/[id]/restore-files/route");
const { PUT: shareRoute } = await import("@/app/api/adapters/[id]/share/route");
const { POST: checkSnapshotRoute } = await import("@/app/api/adapters/check-snapshot/route");
const { POST: testSshRoute } = await import("@/app/api/adapters/test-ssh/route");
const { POST: remoteBrowseRoute } = await import("@/app/api/system/filesystem/remote/route");
const { POST: createRoute } = await import("@/app/api/adapters/route");
const { PUT: updateRoute } = await import("@/app/api/adapters/[id]/route");
const { lockBackup } = await import("@/app/actions/storage/lock");
const { saveConnectionShare } = await import("@/app/actions/tenant/connection-share");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body: unknown) => new NextRequest(url, { method, body: JSON.stringify(body) });
const bodyOf = async (response: Response) => (await response.json()) as { error?: string; data?: { succeeded: string[]; failed: { id: string; error: string }[] } };

/** A config of the form with a host of the caller's, beside the id of the saved destination. */
const ELSEWHERE = { adapterId: "sftp", config: { host: "attacker.example", username: "backup" }, configId: "nas" };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.ctx = MEMBER;
    mocks.testConnection.mockResolvedValue({ ok: true, result: { success: true, message: "Connected" } });
    mocks.browseLocation.mockResolvedValue([]);
    mocks.applyStoredSecrets.mockImplementation(async (_adapterId: string, _id: string, config: unknown) => config);
    mocks.getDatabases.mockResolvedValue(["shop"]);
    mocks.cloneAdapter.mockResolvedValue({ clone: { id: "copy", name: "NAS (Copy)" }, original: { id: "nas", name: "NAS" } });
    mocks.deleteFile.mockResolvedValue(true);
    mocks.toggleLock.mockResolvedValue(true);
    mocks.deleteBackupsBulk.mockImplementation(async (_id: string, paths: string[]) => ({ succeeded: paths, failed: [] }));
    mocks.setBackupsLocked.mockImplementation(async (_id: string, paths: string[]) => ({ succeeded: paths, failed: [] }));
    mocks.restoreFilesToStorage.mockResolvedValue({ restored: 1, failed: [], totalBytes: 1 });
    mocks.shareSave.mockResolvedValue({ gained: [], losses: [] });
    mocks.createAdapter.mockResolvedValue({ id: "new", name: "Mine", type: "storage", adapterId: "sftp", config: "{}", createdAt: new Date(), updatedAt: new Date() });
    mocks.updateAdapter.mockResolvedValue({ adapter: { id: "s3", name: "S3", type: "storage", adapterId: "sftp", config: "{}", createdAt: new Date(), updatedAt: new Date() }, previousName: "S3", changes: [] });
    mocks.listRemote.mockResolvedValue({ path: "/", entries: [] });
});

describe("the stored secrets of the destination of the configuration backup", () => {
    it("never go to a host of a form through a connection test, a folder browse or an access check", async () => {
        const tested = await testConnectionRoute(json("http://localhost/api/adapters/test-connection", "POST", ELSEWHERE));
        const browsed = await browseLocationRoute(json("http://localhost/api/adapters/browse-location", "POST", ELSEWHERE));
        const checked = await accessCheckRoute(json("http://localhost/api/adapters/access-check", "POST", ELSEWHERE));

        expect([tested.status, browsed.status, checked.status]).toEqual([403, 403, 403]);
        expect((await bodyOf(tested)).error).toBe(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(mocks.testConnection).not.toHaveBeenCalled();
        expect(mocks.browseLocation).not.toHaveBeenCalled();
        expect(mocks.applyStoredSecrets).not.toHaveBeenCalled();
    });

    it("are not copied into a connection of a member, nor of an API key of a platform admin", async () => {
        const member = await cloneRoute(json("http://localhost/api/adapters/nas/clone", "POST", {}), params("nas"));
        mocks.ctx = ADMIN_KEY;
        const key = await cloneRoute(json("http://localhost/api/adapters/nas/clone", "POST", {}), params("nas"));

        expect([member.status, key.status]).toEqual([403, 403]);
        expect(mocks.cloneAdapter).not.toHaveBeenCalled();
    });

    it("fill the form of a platform admin with a session, who may change the destination anyway", async () => {
        mocks.ctx = ADMIN;

        const tested = await testConnectionRoute(json("http://localhost/api/adapters/test-connection", "POST", ELSEWHERE));
        const cloned = await cloneRoute(json("http://localhost/api/adapters/nas/clone", "POST", {}), params("nas"));

        expect([tested.status, cloned.status]).toEqual([200, 201]);
        expect(mocks.testConnection).toHaveBeenCalledWith(expect.objectContaining({ storedConfigId: "nas" }));
    });

    it("leave every other saved connection to the rights of the caller", async () => {
        const other = { ...ELSEWHERE, configId: "s3" };

        expect((await testConnectionRoute(json("http://localhost/api/adapters/test-connection", "POST", other))).status).toBe(200);
        expect((await browseLocationRoute(json("http://localhost/api/adapters/browse-location", "POST", other))).status).toBe(200);
        expect((await cloneRoute(json("http://localhost/api/adapters/s3/clone", "POST", {}), params("s3"))).status).toBe(201);
    });
});

describe("a configuration backup at a destination", () => {
    const CONFIG_FILE = "config-backups/config_backup_1.db.gz.enc";

    it("is not deleted by a member, and nothing is removed", async () => {
        const response = await deleteFileRoute(json("http://localhost/api/storage/nas/files", "DELETE", { path: CONFIG_FILE }), params("nas"));

        expect(response.status).toBe(403);
        expect((await bodyOf(response)).error).toBe(CONFIG_BACKUP_ADMIN_ONLY);
        expect(mocks.deleteFile).not.toHaveBeenCalled();
    });

    it("is refused on its own row of a selection, while the backups of jobs beside it go", async () => {
        const response = await bulkFilesRoute(json("http://localhost/api/storage/nas/files/bulk", "POST", { action: "delete", paths: ["nightly/shop.tar", CONFIG_FILE] }), params("nas"));
        const { data } = await bodyOf(response);

        expect(response.status).toBe(200);
        expect(mocks.deleteBackupsBulk).toHaveBeenCalledWith("nas", ["nightly/shop.tar"]);
        expect(data?.succeeded).toEqual(["nightly/shop.tar"]);
        expect(data?.failed).toEqual([{ id: CONFIG_FILE, error: CONFIG_BACKUP_ADMIN_ONLY }]);
    });

    it("is not locked or unlocked by a member, one or in a selection", async () => {
        const one = await lockBackup("nas", CONFIG_FILE);
        const many = await bulkFilesRoute(json("http://localhost/api/storage/nas/files/bulk", "POST", { action: "unlock", paths: [CONFIG_FILE] }), params("nas"));

        expect(one).toEqual({ success: false, error: CONFIG_BACKUP_ADMIN_ONLY });
        expect(mocks.toggleLock).not.toHaveBeenCalled();
        expect((await bodyOf(many)).data?.failed).toHaveLength(1);
        expect(mocks.setBackupsLocked).not.toHaveBeenCalled();
    });

    it("is deleted and locked by a platform admin with a session", async () => {
        mocks.ctx = ADMIN;

        const deleted = await deleteFileRoute(json("http://localhost/api/storage/nas/files", "DELETE", { path: CONFIG_FILE }), params("nas"));
        const locked = await lockBackup("nas", CONFIG_FILE);

        expect(deleted.status).toBe(200);
        expect(locked).toEqual({ success: true, locked: true });
    });
});

describe("the destination of the configuration backup as a target", () => {
    const RESTORE = { file: "nightly/files.tar", target: { kind: "storage", configId: "nas", basePath: "/restored" } };

    it("takes no restored files from a member", async () => {
        const response = await restoreFilesRoute(json("http://localhost/api/storage/s3/restore-files", "POST", RESTORE), params("s3"));

        expect(response.status).toBe(403);
        expect((await bodyOf(response)).error).toBe(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(mocks.restoreFilesToStorage).not.toHaveBeenCalled();
    });

    it("takes files restored to another destination as before", async () => {
        const response = await restoreFilesRoute(json("http://localhost/api/storage/s3/restore-files", "POST", { ...RESTORE, target: { ...RESTORE.target, configId: "s3" } }), params("s3"));

        expect(response.status).toBe(200);
        expect(mocks.restoreFilesToStorage).toHaveBeenCalledOnce();
    });

    it("is not shared with customers by a member, through the API or the page", async () => {
        const settings = { allTenants: true, tenantIds: [], encryptedOnly: false, ownRecipients: true };

        const routed = await shareRoute(json("http://localhost/api/adapters/nas/share", "PUT", { ...settings, confirmed: true }), params("nas"));
        const acted = await saveConnectionShare("nas", settings, true);

        expect(routed.status).toBe(403);
        expect(acted).toEqual({ success: false, error: CONFIG_BACKUP_DESTINATION_LOCKED });
        expect(mocks.shareSave).not.toHaveBeenCalled();
    });
});

describe("the saved logins of the destination of the configuration backup", () => {
    /** A config of the form with a host of the caller's, signing in with the login of the destination. */
    const FORM = { adapterId: "sftp", config: { host: "attacker.example", username: "backup" }, primaryCredentialId: "nas-login" };
    const SSH_FORM = { adapterId: "mysql", config: { connectionMode: "ssh", sshHost: "attacker.example", sshUsername: "root" }, sshCredentialId: "nas-login" };

    /** Every request that lays a saved login over a config of its own, or stores one with it. */
    const requests = () => [
        testConnectionRoute(json("http://localhost/api/adapters/test-connection", "POST", FORM)),
        browseLocationRoute(json("http://localhost/api/adapters/browse-location", "POST", FORM)),
        accessCheckRoute(json("http://localhost/api/adapters/access-check", "POST", FORM)),
        checkSnapshotRoute(json("http://localhost/api/adapters/check-snapshot", "POST", FORM)),
        testSshRoute(json("http://localhost/api/adapters/test-ssh", "POST", SSH_FORM)),
        remoteBrowseRoute(json("http://localhost/api/system/filesystem/remote", "POST", { ...SSH_FORM, path: "/" })),
        createRoute(json("http://localhost/api/adapters", "POST", { ...FORM, name: "Mine", type: "storage" })),
        updateRoute(json("http://localhost/api/adapters/s3", "PUT", { name: "S3", ...FORM }), params("s3")),
    ];

    it("never sign in to a host of a form, a new connection or another one for a member", async () => {
        const responses = await Promise.all(requests());

        expect(responses.map((response) => response.status)).toEqual(Array(8).fill(403));
        for (const response of responses) expect((await bodyOf(response)).error).toBe(CONFIG_BACKUP_LOGIN_APPLY_LOCKED);
        expect(mocks.testConnection).not.toHaveBeenCalled();
        expect(mocks.browseLocation).not.toHaveBeenCalled();
        expect(mocks.getDatabases).not.toHaveBeenCalled();
        expect(mocks.listRemote).not.toHaveBeenCalled();
        expect(mocks.createAdapter).not.toHaveBeenCalled();
        expect(mocks.updateAdapter).not.toHaveBeenCalled();
    });

    it("are refused to an API key of a platform admin too", async () => {
        mocks.ctx = ADMIN_KEY;

        expect((await Promise.all(requests())).map((response) => response.status)).toEqual(Array(8).fill(403));
    });

    it("do not follow a new config of a connection that already signs in with them", async () => {
        const response = await updateRoute(json("http://localhost/api/adapters/twin", "PUT", { config: { host: "attacker.example" } }), params("twin"));

        expect(response.status).toBe(403);
        expect(mocks.updateAdapter).not.toHaveBeenCalled();
    });

    it("are used by a platform admin with a session, and every other login stays with the rights of the caller", async () => {
        mocks.ctx = ADMIN;
        expect((await testConnectionRoute(json("http://localhost/api/adapters/test-connection", "POST", FORM))).status).toBe(200);
        expect((await updateRoute(json("http://localhost/api/adapters/twin", "PUT", { config: { host: "nas.internal" } }), params("twin"))).status).toBe(200);

        mocks.ctx = MEMBER;
        const own = { ...FORM, primaryCredentialId: "s3-login" };
        expect((await testConnectionRoute(json("http://localhost/api/adapters/test-connection", "POST", own))).status).toBe(200);
        expect((await createRoute(json("http://localhost/api/adapters", "POST", { ...own, name: "Mine", type: "storage" }))).status).toBe(201);
        expect((await updateRoute(json("http://localhost/api/adapters/s3", "PUT", { name: "S3", ...own }), params("s3"))).status).toBe(200);
    });
});

describe("a restore of files to where they came from", () => {
    const ORIGIN = { file: "nightly/files.tar", target: { kind: "origin" } };
    type Input = { checkTargets?: (ids: string[]) => Promise<void> };

    /** The service as far as the route sees it: it asks about the connections its archive names before it writes. */
    const restoreInto = (origin: string) => mocks.restoreFilesToStorage.mockImplementation(async (input: Input) => {
        if (!input.checkTargets) throw new Error("The origin was never checked");
        await input.checkTargets([origin]);
        return { restored: 1, failed: [], totalBytes: 1 };
    });

    it("writes nothing into the destination of the configuration backup for a member, when a directory source of the job is that destination", async () => {
        restoreInto("nas");

        const response = await restoreFilesRoute(json("http://localhost/api/storage/s3/restore-files", "POST", ORIGIN), params("s3"));

        expect(response.status).toBe(403);
        expect((await bodyOf(response)).error).toBe(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("writes back into any other origin, and into that destination for a platform admin with a session", async () => {
        restoreInto("sftp-source");
        expect((await restoreFilesRoute(json("http://localhost/api/storage/s3/restore-files", "POST", ORIGIN), params("s3"))).status).toBe(200);

        mocks.ctx = ADMIN;
        restoreInto("nas");
        expect((await restoreFilesRoute(json("http://localhost/api/storage/s3/restore-files", "POST", ORIGIN), params("s3"))).status).toBe(200);
    });
});
