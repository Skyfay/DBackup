// @vitest-environment node
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { explicitScope, runAsTenant, type TenantScope } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    running: vi.fn(),
    destination: vi.fn(),
    userName: vi.fn(),
    users: vi.fn(),
    open: vi.fn(),
    inspect: vi.fn(),
    stage: vi.fn(),
    importConfig: vi.fn(),
    storage: { download: vi.fn(), read: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        execution: { count: (...args: unknown[]) => mocks.running(...args) },
        adapterConfig: { findUnique: (...args: unknown[]) => mocks.destination(...args) },
        user:{ findUnique: (...args: unknown[]) => mocks.userName(...args), count: () => mocks.users() },
    },
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: () => ({ id: "sftp" }) } }));
vi.mock("@/services/sharing/destination-access", () => ({
    isShared: async () => false,
    openRow: async () => ({ adapter: mocks.storage, config: {} }),
}));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn() }));
vi.mock("@/services/config/open-backup", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/config/open-backup")>()),
    openBackupFile: (...args: unknown[]) => mocks.open(...args),
}));
vi.mock("@/services/config/copy-inspect", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/config/copy-inspect")>()),
    inspectDatabaseCopy: (...args: unknown[]) => mocks.inspect(...args),
}));
vi.mock("@/services/config/restore-staging", () => ({ stageDatabaseRestore: (...args: unknown[]) => mocks.stage(...args) }));
vi.mock("@/services/config/import", () => ({ importConfiguration: (...args: unknown[]) => mocks.importConfig(...args) }));

const root = mkdtempSync(path.join(os.tmpdir(), "dbackup-flow-"));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => root }));

const { applyCheckedRestore, checkStoredBackup, checkUploadedBackup, hasNoAccountYet } = await import("@/services/config/restore-flow");

const PREVIEW = { kind: "database", version: "3.4.0", createdAt: null, counts: { connections: 1, jobs: 1, templates: 0, users: 1, runs: 0 }, otherKeys: false };
const MANU = { userId: "u-manu" };

/** An opened backup in the temp folder, like openBackupFile leaves it. */
function opened(content: string | Buffer): string {
    const file = path.join(root, `plain-${Math.random().toString(36).slice(2)}`);
    writeFileSync(file, content);
    return file;
}
const sqlite = () => Buffer.concat([Buffer.from("SQLite format 3\u0000"), Buffer.alloc(84)]);
const upload = (name = "config_backup.db.gz.enc") => ({ backup: new File(["encrypted"], name), meta: new File(['{"compression":"GZIP"}'], `${name}.meta.json`), keyHex: "ab12" });

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.running.mockResolvedValue(0);
    mocks.userName.mockResolvedValue({ name: "Manu" });
    mocks.inspect.mockResolvedValue({ preview: PREVIEW, keys: null });
    mocks.stage.mockResolvedValue(undefined);
    mocks.importConfig.mockResolvedValue({ notes: ["1 job is paused"] });
});

describe("a configuration restore in two steps", () => {
    it("opens an upload with its metadata and the typed key, and holds the copy for its Restore", async () => {
        mocks.open.mockResolvedValue(opened(sqlite()));

        const checked = await checkUploadedBackup(upload(), MANU);

        expect(checked).toMatchObject({ fileName: "config_backup.db.gz.enc", preview: PREVIEW });
        const [file, meta, override] = mocks.open.mock.calls[0];
        expect(path.basename(file as string)).toMatch(/_config_backup\.db\.gz\.enc$/);
        expect(meta).toEqual({ compression: "GZIP" });
        expect(override).toEqual({ rawKeyHex: "ab12" });
    });

    it("writes an upload into the private temporary folder, readable by DBackup alone", async () => {
        let seen: { dir: string; dirMode: number; fileMode: number } | null = null;
        mocks.open.mockImplementation(async (file: string) => {
            seen = { dir: path.dirname(file), dirMode: statSync(path.dirname(file)).mode & 0o777, fileMode: statSync(file).mode & 0o777 };
            return opened(sqlite());
        });

        await checkUploadedBackup(upload(), MANU);

        expect(seen).not.toBeNull();
        expect(path.dirname(seen!.dir)).toBe(root);
        expect(path.basename(seen!.dir)).toMatch(/^dbackup-private-/);
        if (process.platform !== "win32") {
            expect(seen!.dirMode).toBe(0o700);
            expect(seen!.fileMode).toBe(0o600);
        }
    });

    it("replaces the database with a checked copy, noting who restored it", async () => {
        mocks.open.mockResolvedValue(opened(sqlite()));
        const { token } = await checkUploadedBackup(upload(), MANU);

        expect(await applyCheckedRestore(token, MANU)).toEqual({ kind: "database", fileName: "config_backup.db.gz.enc" });
        expect(mocks.stage).toHaveBeenCalledWith(expect.any(String), null, { actorName: "Manu", fileName: "config_backup.db.gz.enc" });
    });

    it("waits while a backup or restore runs, which the restart would stop, and keeps the checked copy", async () => {
        mocks.open.mockResolvedValue(opened(sqlite()));
        const { token } = await checkUploadedBackup(upload(), MANU);
        mocks.running.mockResolvedValue(1);

        await expect(applyCheckedRestore(token, MANU)).rejects.toThrow("runs right now");
        expect(mocks.stage).not.toHaveBeenCalled();

        mocks.running.mockResolvedValue(0);
        await expect(applyCheckedRestore(token, MANU)).resolves.toMatchObject({ kind: "database" });
    });

    it("hands a checked backup only to whoever checked it, and only once", async () => {
        mocks.open.mockResolvedValue(opened(sqlite()));
        const { token } = await checkUploadedBackup(upload(), MANU);

        await expect(applyCheckedRestore(token, { userId: "u-lena" })).rejects.toThrow("is gone");
        await expect(applyCheckedRestore(token, "setup")).rejects.toThrow("is gone");
        await applyCheckedRestore(token, MANU);
        await expect(applyCheckedRestore(token, MANU)).rejects.toThrow("is gone");
    });

    it("imports a file of an older version as a whole and hands back what it could not bring back", async () => {
        mocks.open.mockResolvedValue(opened(JSON.stringify({ metadata: { version: "3.3.0", exportedAt: "2026-09-01T00:00:00.000Z" }, adapters: [{}, {}], jobs: [{}], users: [] })));
        const { token, preview } = await checkUploadedBackup(upload("config_backup.json.gz.enc"), MANU);

        expect(preview).toMatchObject({ kind: "json", version: "3.3.0", counts: { connections: 2, jobs: 1, users: 0 } });
        expect(await applyCheckedRestore(token, MANU)).toEqual({ kind: "json", fileName: "config_backup.json.gz.enc", notes: ["1 job is paused"] });
        expect(mocks.stage).not.toHaveBeenCalled();
    });

    it("refuses a file that is neither a copy nor a configuration file", async () => {
        mocks.open.mockResolvedValue(opened("hello"));

        await expect(checkUploadedBackup(upload("notes.txt"), MANU)).rejects.toThrow("no configuration backup of DBackup");
    });

    it("refuses a copy of the database without any account, which would leave the first sign-up open in it", async () => {
        mocks.inspect.mockResolvedValue({ preview: { ...PREVIEW, counts: { ...PREVIEW.counts, users: 0 } }, keys: null });

        for (const owner of ["setup", MANU] as const) {
            const plain = opened(sqlite());
            mocks.open.mockResolvedValue(plain);
            await expect(checkUploadedBackup(upload(), owner)).rejects.toThrow("holds no account");
            // Nothing waits for a Restore, and the opened copy is gone.
            expect(existsSync(plain)).toBe(false);
        }
        expect(mocks.stage).not.toHaveBeenCalled();
    });

    it("refuses a file of an older version without users on the sign-up page, and still takes it in Settings, which keeps its accounts", async () => {
        const noUsers = () => opened(JSON.stringify({ metadata: { version: "3.3.0", exportedAt: "2026-09-01T00:00:00.000Z" }, adapters: [], jobs: [], users: [] }));

        mocks.open.mockResolvedValue(noUsers());
        await expect(checkUploadedBackup(upload("config_backup.json.gz.enc"), "setup")).rejects.toThrow("holds no account");
        expect(mocks.importConfig).not.toHaveBeenCalled();

        mocks.open.mockResolvedValue(noUsers());
        await expect(checkUploadedBackup(upload("config_backup.json.gz.enc"), MANU)).resolves.toMatchObject({ preview: { kind: "json", counts: { users: 0 } } });
    });

    it("allows a restore without a sign-in only while DBackup has no account", async () => {
        mocks.users.mockResolvedValue(0);
        expect(await hasNoAccountYet()).toBe(true);
        mocks.users.mockResolvedValue(1);
        expect(await hasNoAccountYet()).toBe(false);
    });
});

describe("the tenant a configuration restore reads in", () => {
    const HOME: TenantScope = { kind: "tenant", tenantId: HOME_TENANT_ID };

    it("looks up the key of an upload in the home tenant, also on the sign-up page, which has no session", async () => {
        const scopes: (TenantScope | undefined)[] = [];
        mocks.open.mockImplementation(async () => {
            scopes.push(explicitScope());
            return opened(sqlite());
        });

        await checkUploadedBackup(upload(), "setup");
        // An admin who looks at a customer opens it with the keys of the platform all the same.
        await runAsTenant("acme", () => checkUploadedBackup(upload(), MANU));

        expect(scopes).toEqual([HOME, HOME]);
    });

    it("counts the running runs of every tenant before a copy replaces the database on the sign-up page", async () => {
        mocks.open.mockResolvedValue(opened(sqlite()));
        const { token } = await checkUploadedBackup(upload(), "setup");
        let scope: TenantScope | undefined;
        mocks.running.mockImplementation(async () => {
            scope = explicitScope();
            return 0;
        });

        await expect(applyCheckedRestore(token, "setup")).resolves.toMatchObject({ kind: "database" });
        expect(scope).toEqual({ kind: "system" });
    });

    it("reads a configuration backup at a destination only from one of the home tenant", async () => {
        let scope: TenantScope | undefined;
        mocks.destination.mockImplementation(async () => {
            scope = explicitScope();
            return null;
        });

        await expect(runAsTenant("acme", () => checkStoredBackup("dest-acme", "config_backup.db.gz.enc", undefined, MANU))).rejects.toThrow("destination of the home tenant");
        expect(scope).toEqual(HOME);
    });

    it("opens a configuration backup at a destination only when it is encrypted, so a planted plain file is never taken", async () => {
        mocks.destination.mockResolvedValue({ id: "home-nas", name: "NAS", type: "storage", storageRole: "DESTINATION", adapterId: "sftp", tenantId: HOME_TENANT_ID, config: "{}" });
        mocks.storage.download.mockResolvedValue(true);
        mocks.storage.read.mockResolvedValue(JSON.stringify({ sourceType: "SYSTEM", compression: "GZIP" }));

        await expect(checkStoredBackup("home-nas", "config-backups/config_backup_2026.db.gz", undefined, MANU)).rejects.toThrow("restored only when it is encrypted");
        expect(mocks.open).not.toHaveBeenCalled();

        mocks.storage.read.mockResolvedValue(JSON.stringify({ encryption: { enabled: true, iv: "aa", authTag: "bb", profileId: "config-key" } }));
        mocks.open.mockResolvedValue(opened(sqlite()));
        await expect(checkStoredBackup("home-nas", "config-backups/config_backup_2026.db.gz.enc", undefined, MANU)).resolves.toMatchObject({ fileName: "config_backup_2026.db.gz.enc" });
    });

    it("never reads a path that leaves the destination, also when a caller forgot to check it", async () => {
        mocks.destination.mockResolvedValue({ id: "home-nas", name: "NAS", type: "storage", storageRole: "DESTINATION", adapterId: "sftp", tenantId: HOME_TENANT_ID, config: "{}" });

        for (const file of ["../config_backup.db.gz.enc", "/srv/config_backup.db.gz.enc", "config-backups\\..\\..\\x.enc"]) {
            await expect(checkStoredBackup("home-nas", file, undefined, MANU)).rejects.toBeInstanceOf(ValidationError);
        }
        expect(mocks.storage.download).not.toHaveBeenCalled();
        expect(mocks.storage.read).not.toHaveBeenCalled();
    });

    it("reads a configuration backup only from a destination, never from a directory source or a database connection of the home tenant", async () => {
        mocks.storage.download.mockResolvedValue(true);
        mocks.storage.read.mockResolvedValue(JSON.stringify({ encryption: { enabled: true, iv: "aa", authTag: "bb", profileId: "config-key" } }));
        mocks.open.mockResolvedValue(opened(sqlite()));

        mocks.destination.mockResolvedValue({ id: "home-files", name: "File server", type: "storage", storageRole: "SOURCE", adapterId: "sftp", tenantId: HOME_TENANT_ID, config: "{}" });
        await expect(checkStoredBackup("home-files", "config-backups/config_backup_2026.db.gz.enc", undefined, MANU)).rejects.toThrow("File server is no destination");

        mocks.destination.mockResolvedValue({ id: "home-db", name: "Postgres", type: "database", storageRole: "DESTINATION", adapterId: "sftp", tenantId: HOME_TENANT_ID, config: "{}" });
        await expect(checkStoredBackup("home-db", "config-backups/config_backup_2026.db.gz.enc", undefined, MANU)).rejects.toThrow("Postgres is no destination");

        expect(mocks.storage.download).not.toHaveBeenCalled();
        expect(mocks.open).not.toHaveBeenCalled();
    });
});
