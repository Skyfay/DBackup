// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    running: vi.fn(),
    userName: vi.fn(),
    users: vi.fn(),
    open: vi.fn(),
    inspect: vi.fn(),
    stage: vi.fn(),
    importConfig: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        execution: { count: (...args: unknown[]) => mocks.running(...args) },
        user: { findUnique: (...args: unknown[]) => mocks.userName(...args), count: () => mocks.users() },
    },
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: vi.fn() } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn() }));
vi.mock("@/services/config/open-backup", () => ({ openBackupFile: (...args: unknown[]) => mocks.open(...args) }));
vi.mock("@/services/config/copy-inspect", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/config/copy-inspect")>()),
    inspectDatabaseCopy: (...args: unknown[]) => mocks.inspect(...args),
}));
vi.mock("@/services/config/restore-staging", () => ({ stageDatabaseRestore: (...args: unknown[]) => mocks.stage(...args) }));
vi.mock("@/services/config/import", () => ({ importConfiguration: (...args: unknown[]) => mocks.importConfig(...args) }));

const root = mkdtempSync(path.join(os.tmpdir(), "dbackup-flow-"));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => root }));

const { applyCheckedRestore, checkUploadedBackup, hasNoAccountYet } = await import("@/services/config/restore-flow");

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

    it("allows a restore without a sign-in only while DBackup has no account", async () => {
        mocks.users.mockResolvedValue(0);
        expect(await hasNoAccountYet()).toBe(true);
        mocks.users.mockResolvedValue(1);
        expect(await hasNoAccountYet()).toBe(false);
    });
});
