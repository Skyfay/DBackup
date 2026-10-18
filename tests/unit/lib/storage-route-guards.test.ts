/**
 * The routes that hand out, open or restore a backup by its path. A configuration backup is a copy of
 * the whole DBackup database with `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`, so like the database
 * download it is only for a platform admin signed in with a session. A refused permission answers
 * 403, never 500. A token a download prepares is collected only in the tenant and with the API key
 * that prepared it.
 */
import { Readable } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";
import { explicitScope } from "@/lib/tenant/context";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" | "apikey"; apiKeyId?: string };

const mocks = vi.hoisted(() => ({
    ctx: null as null | Ctx,
    isConfigBackupFile: vi.fn(),
    downloadFile: vi.fn(),
    listFiles: vi.fn(),
    deleteFile: vi.fn(),
    analyzeBackup: vi.fn(),
    browseArchive: vi.fn(),
    planFileRestore: vi.fn(),
    restoreFilesToStorage: vi.fn(),
    planArchiveDownload: vi.fn(),
    openArchiveDownload: vi.fn(),
    restore: vi.fn(),
    history: vi.fn(),
    checkRestorePath: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => {
    const has = (ctx: Ctx, permission: string) => (ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission);
    return {
        getAuthContext: async () => mocks.ctx,
        checkPermissionWithContext: (ctx: Ctx, permission: string) => {
            if (!has(ctx, permission)) throw new PermissionError(permission);
        },
        checkAnyPermissionWithContext: (ctx: Ctx, permissions: string[]) => {
            if (!permissions.some((permission) => has(ctx, permission))) throw new PermissionError(permissions.join(" or "));
        },
        tenantOf: (ctx: Ctx) => {
            if (!ctx.tenantId) throw new PermissionError("a tenant");
            return ctx.tenantId;
        },
    };
});
vi.mock("@/services/storage/config-backup-access", () => ({ isConfigBackupFile: (...args: unknown[]) => mocks.isConfigBackupFile(...args) }));
vi.mock("@/services/storage/storage-service", () => ({
    storageService: {
        downloadFile: (...args: unknown[]) => mocks.downloadFile(...args),
        listFilesWithMetadata: (...args: unknown[]) => mocks.listFiles(...args),
        deleteFile: (...args: unknown[]) => mocks.deleteFile(...args),
    },
}));
vi.mock("@/services/storage/backup-contents", () => ({
    analyzeBackup: (...args: unknown[]) => mocks.analyzeBackup(...args),
    browseArchive: (...args: unknown[]) => mocks.browseArchive(...args),
}));
vi.mock("@/services/restore/file-restore", () => ({
    planFileRestore: (...args: unknown[]) => mocks.planFileRestore(...args),
    restoreFilesToStorage: (...args: unknown[]) => mocks.restoreFilesToStorage(...args),
}));
vi.mock("@/services/restore/archive-download", () => ({
    planArchiveDownload: (...args: unknown[]) => mocks.planArchiveDownload(...args),
    openArchiveDownload: (...args: unknown[]) => mocks.openArchiveDownload(...args),
}));
vi.mock("@/services/restore/restore-service", () => ({ restoreService: { restore: (...args: unknown[]) => mocks.restore(...args) } }));
vi.mock("@/services/user/user-service", () => ({ userService: { nameOf: async () => "Lena" } }));
vi.mock("@/services/dashboard-service", () => ({
    getStorageHistory: (...args: unknown[]) => mocks.history(...args),
    refreshStorageStatsCache: vi.fn(async () => []),
}));
vi.mock("@/services/storage/restore-path-check", () => ({ checkRestorePath: (...args: unknown[]) => mocks.checkRestorePath(...args) }));
vi.mock("@/services/storage/storage-lookup", () => ({ isMissingStorage: () => false }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn(), logFor: vi.fn() } }));
vi.mock("@/services/storage/backup-audit", () => ({
    backupAuditDetails: async (_id: string, file: string) => ({ file, destination: "NAS" }),
    fileRestoreTarget: async () => ({}),
    restoreAuditDetails: async () => ({}),
}));
vi.mock("@/lib/server/temp-file-response", () => ({
    tempFileDownloadResponse: (_tempFile: string, fileName: string) => new Response(`file ${fileName}`, { status: 200 }),
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const download = await import("@/app/api/storage/[id]/download/route");
const analyze = await import("@/app/api/storage/[id]/analyze/route");
const browse = await import("@/app/api/storage/[id]/browse-archive/route");
const restoreFiles = await import("@/app/api/storage/[id]/restore-files/route");
const restore = await import("@/app/api/storage/[id]/restore/route");
const files = await import("@/app/api/storage/[id]/files/route");
const history = await import("@/app/api/storage/[id]/history/route");
const checkPath = await import("@/app/api/storage/[id]/check-path/route");

const params = { params: Promise.resolve({ id: "nas" }) };
const get = (query: string) => new NextRequest(`http://dbackup.test/api/storage/nas/x${query}`);
const post = (body: unknown) => new NextRequest("http://dbackup.test/api/storage/nas/x", { method: "POST", body: JSON.stringify(body) });
const del = (body: unknown) => new NextRequest("http://dbackup.test/api/storage/nas/x", { method: "DELETE", body: JSON.stringify(body) });

const STORAGE_RIGHTS = ["storage:read", "storage:download", "storage:restore", "storage:delete"];
const member = (...permissions: string[]): Ctx => ({ userId: "lena", tenantId: "default", allTenants: false, isPlatformAdmin: false, permissions, authMethod: "session" });
const admin = (): Ctx => ({ userId: "root", tenantId: "default", allTenants: false, isPlatformAdmin: true, permissions: [], authMethod: "session" });
const apiKey = (...permissions: string[]): Ctx => ({ ...member(...permissions), authMethod: "apikey", apiKeyId: "key-ci" });

const CONFIG_BACKUP = "config-backups/config_backup_2026-10-18T03-00-00-000Z.db.gz.enc";

/** Every way a backup is read by its path, each with what it reaches when it is not refused. */
const readers = [
    { name: "a download", send: () => download.GET(get(`?file=${encodeURIComponent(CONFIG_BACKUP)}&decrypt=true`), params), reached: () => mocks.downloadFile },
    { name: "a decrypted download", send: () => download.POST(post({ file: CONFIG_BACKUP, prepare: true }), params), reached: () => mocks.downloadFile },
    { name: "an analysis", send: () => analyze.POST(post({ file: CONFIG_BACKUP }), params), reached: () => mocks.analyzeBackup },
    { name: "a look inside the archive", send: () => browse.POST(post({ file: CONFIG_BACKUP }), params), reached: () => mocks.browseArchive },
    { name: "a download of files", send: () => restoreFiles.POST(post({ file: CONFIG_BACKUP, target: { kind: "download" } }), params), reached: () => mocks.openArchiveDownload },
    { name: "a count of a pick", send: () => restoreFiles.POST(post({ file: CONFIG_BACKUP, target: { kind: "download" }, dryRun: true }), params), reached: () => mocks.planFileRestore },
    { name: "a restore of files", send: () => restoreFiles.POST(post({ file: CONFIG_BACKUP, target: { kind: "origin" } }), params), reached: () => mocks.restoreFilesToStorage },
    { name: "a restore", send: () => restore.POST(post({ file: CONFIG_BACKUP, targetSourceId: "src-1" }), params), reached: () => mocks.restore },
] as const;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigBackupFile.mockImplementation(async (_id: string, file: string) => file.startsWith("config-backups/"));
    mocks.downloadFile.mockResolvedValue({ success: true, isZip: false });
    mocks.analyzeBackup.mockResolvedValue({ databases: [] });
    mocks.browseArchive.mockResolvedValue({ entries: [] });
    mocks.planFileRestore.mockResolvedValue({ fileCount: 1, totalBytes: 1 });
    mocks.restoreFilesToStorage.mockResolvedValue({ restored: 1, failed: [] });
    mocks.planArchiveDownload.mockResolvedValue({ fileName: "pick.tar.gz", contentType: "application/gzip" });
    mocks.openArchiveDownload.mockImplementation(async () => ({ stream: Readable.from([Buffer.from("tar")]), fileName: "pick.tar.gz", contentType: "application/gzip" }));
    mocks.restore.mockResolvedValue({ success: true, executionId: "run-1" });
    mocks.listFiles.mockResolvedValue([]);
    mocks.deleteFile.mockResolvedValue(true);
    mocks.history.mockResolvedValue([]);
    mocks.checkRestorePath.mockResolvedValue({ state: "empty" });
});

describe.each(readers)("$name of a configuration backup", ({ send, reached }) => {
    it("is refused to a member with every right on the backups, and reads nothing", async () => {
        mocks.ctx = member(...STORAGE_RIGHTS);

        const response = await send();

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining("configuration backup") });
        expect(reached()).not.toHaveBeenCalled();
    });

    it("is refused to an API key with every right on the backups", async () => {
        mocks.ctx = apiKey(...STORAGE_RIGHTS);

        expect((await send()).status).toBe(403);
        expect(reached()).not.toHaveBeenCalled();
    });

    it("is open to a platform admin signed in with a session", async () => {
        mocks.ctx = admin();

        const response = await send();

        expect(response.status).not.toBe(403);
        expect(reached()).toHaveBeenCalled();
        expect(mocks.isConfigBackupFile).not.toHaveBeenCalled();
    });
});

describe("a backup of a job", () => {
    it("answers 400 with the sentence when the decrypted download names no database of a backup that holds several", async () => {
        mocks.ctx = member("storage:download");
        const { ValidationError } = await import("@/lib/logging/errors");
        mocks.downloadFile.mockRejectedValueOnce(new ValidationError("This backup holds 2 database(s). Name the database to download, or download the contents as a .tar.gz."));

        const response = await download.GET(get(`?file=${encodeURIComponent("nightly/shop.tar")}&decrypt=true`), params);

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("Name the database to download");
    });

    it("still downloads for a member with the download right, asked in the view of its tenant", async () => {
        mocks.ctx = member("storage:download");

        const response = await download.GET(get(`?file=${encodeURIComponent("nightly/shop.tar")}`), params);

        expect(response.status).toBe(200);
        expect(mocks.isConfigBackupFile).toHaveBeenCalledWith("nas", "nightly/shop.tar", "default");
        expect(mocks.downloadFile).toHaveBeenCalled();
    });

    it("is refused when its sidecar says it is a configuration backup, wherever it lies", async () => {
        mocks.ctx = member("storage:download");
        mocks.isConfigBackupFile.mockResolvedValue(true);

        const response = await download.GET(get(`?file=${encodeURIComponent("nightly/renamed.db.gz.enc")}`), params);

        expect(response.status).toBe(403);
        expect(mocks.downloadFile).not.toHaveBeenCalled();
    });
});

describe("a refused permission", () => {
    const routes = [
        { name: "a restore", send: () => restore.POST(post({ file: "nightly/shop.tar" }), params) },
        { name: "a download", send: () => download.GET(get("?file=nightly/shop.tar"), params) },
        { name: "a decrypted download", send: () => download.POST(post({ file: "nightly/shop.tar" }), params) },
        { name: "the listing", send: () => files.GET(get(""), params) },
        { name: "a delete", send: () => files.DELETE(del({ path: "nightly/shop.tar" }), params) },
        { name: "the history", send: () => history.GET(get(""), params) },
        { name: "a download of files", send: () => restoreFiles.POST(post({ file: "nightly/shop.tar", target: { kind: "download" } }), params) },
        { name: "a prepared download of files", send: () => restoreFiles.GET(get("?token=abc"), params) },
        { name: "a check of a restore path", send: () => checkPath.POST(post({ path: "/restore" }), params) },
        { name: "an analysis", send: () => analyze.POST(post({ file: "nightly/shop.tar" }), params) },
        { name: "a look inside the archive", send: () => browse.POST(post({ file: "nightly/shop.tar" }), params) },
    ] as const;

    it.each(routes)("answers 403 for $name, never 500", async ({ send }) => {
        mocks.ctx = member();

        const response = await send();

        expect(response.status).toBe(403);
    });
});

describe("a download prepared on the server", () => {
    const prepare = async () => {
        const response = await download.POST(post({ file: "nightly/shop.tar", prepare: true }), params);
        return (await response.json()).data.token as string;
    };
    const collect = (token: string) => download.GET(get(`?token=${token}`), params);

    it("is collected by the request of the tenant and the API key that prepared it", async () => {
        mocks.ctx = apiKey("storage:download");
        const token = await prepare();

        expect((await collect(token)).status).toBe(200);
    });

    it("is not collected in another tenant, where the right to download was never checked for it", async () => {
        mocks.ctx = member("storage:download");
        const token = await prepare();

        mocks.ctx = { ...member("storage:download"), tenantId: "globex" };
        expect((await collect(token)).status).toBe(410);
    });

    it("is not collected with another API key or a session of the same person", async () => {
        mocks.ctx = apiKey("storage:download");
        const token = await prepare();

        mocks.ctx = member("storage:download");
        expect((await collect(token)).status).toBe(410);
        mocks.ctx = { ...apiKey("storage:download"), apiKeyId: "key-other" };
        expect((await collect(token)).status).toBe(410);
    });
});

describe("a download of files prepared for the browser", () => {
    const prepare = async () => {
        const response = await restoreFiles.POST(post({ file: "nightly/shop.tar", target: { kind: "download" }, databases: ["shop"], prepare: true }), params);
        return (await response.json()).data.token as string;
    };
    const collect = (token: string) => restoreFiles.GET(get(`?token=${token}`), params);

    it("is served in the tenant it was prepared in, whose view of the destination its path is in", async () => {
        mocks.ctx = member("storage:download");
        let servedIn: unknown;
        mocks.openArchiveDownload.mockImplementation(async () => {
            servedIn = explicitScope();
            return { stream: Readable.from([Buffer.from("tar")]), fileName: "shop.sql", contentType: "application/sql" };
        });
        const token = await prepare();

        expect((await collect(token)).status).toBe(200);
        expect(servedIn).toEqual({ kind: "tenant", tenantId: "default" });
    });

    it("is not collected in another tenant", async () => {
        mocks.ctx = member("storage:download");
        const token = await prepare();

        mocks.ctx = { ...member("storage:download"), tenantId: "globex" };
        expect((await collect(token)).status).toBe(410);
        expect(mocks.openArchiveDownload).not.toHaveBeenCalled();
    });
});
