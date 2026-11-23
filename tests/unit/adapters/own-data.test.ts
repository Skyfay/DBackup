// @vitest-environment node
/**
 * A member of the home tenant may add connections to the server DBackup runs on. None of them may
 * reach the folder of DBackup's database or the folder of the configuration backup, which a job would
 * copy into an archive the member downloads, around the rule that the database download and the
 * configuration backup are for a platform admin alone. Checked on real folders, with links.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";
import { markLocalNetwork } from "@/lib/adapters/network-fact";

const mocks = vi.hoisted(() => ({
    headers: vi.fn(),
    ctx: null as null | { isPlatformAdmin: boolean; authMethod: string; tenantId: string | null; allTenants: boolean },
}));

vi.mock("next/headers", () => ({ headers: () => mocks.headers() }));
vi.mock("@/lib/auth/access-control", () => ({ getAuthContext: async () => mocks.ctx }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: (id: string) => ({ id }), register: vi.fn() } }));
vi.mock("@/lib/crypto", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/crypto")>()),
    decryptConfig: (config: unknown) => config,
}));

const { ownDataRefusal, assertOffOwnData, scanRefusal, localPathOf, OWN_DATA_REFUSED, CONFIG_BACKUP_FOLDER_REFUSED, TEMP_FOLDER_REFUSED } = await import("@/lib/adapters/own-data");
const { assertConfigOffHost, resolveAdapterConfig } = await import("@/lib/adapters/config-resolver");
const { assertMayReachHost } = await import("@/services/adapters/adapter-create");
const { runAsTenant } = await import("@/lib/tenant/context");
const { dump } = await import("@/lib/adapters/database/sqlite/dump");
const { restore } = await import("@/lib/adapters/database/sqlite/restore");
const { createFakeHost } = await import("@/lib/testing/fake-host");

let root: string;
let dataDir: string;
let backups: string;
const env = { url: process.env.DATABASE_URL, certs: process.env.CERTS_DIR, tmp: process.env.TMPDIR };

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "own-data-")));
    dataDir = path.join(root, "data", "db");
    backups = path.join(root, "backups");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(root, "data", "certs"), { recursive: true });
    fs.mkdirSync(path.join(backups, "config-backups"), { recursive: true });
    fs.mkdirSync(path.join(backups, "shop"), { recursive: true });
    fs.mkdirSync(path.join(root, "member"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "dbackup.db"), "");
    // Links a member could point a connection or a folder of a job at.
    fs.symlinkSync(dataDir, path.join(root, "member", "innocent"));
    fs.symlinkSync(path.join(dataDir, "dbackup.db"), path.join(root, "member", "app.sqlite"));
    fs.symlinkSync(path.join(backups, "config-backups"), path.join(root, "member", "reports"));
    process.env.DATABASE_URL = `file:${path.join(dataDir, "dbackup.db")}`;
    process.env.CERTS_DIR = path.join(root, "data", "certs");
    // The temporary folder of DBackup, a folder of its own here, since the others lie in the one of the system.
    fs.mkdirSync(path.join(root, "tmp", "run-1"), { recursive: true });
    fs.symlinkSync(path.join(root, "tmp"), path.join(root, "member", "scratch"));
    process.env.TMPDIR = path.join(root, "tmp");
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (env.url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = env.url;
    if (env.certs === undefined) delete process.env.CERTS_DIR;
    else process.env.CERTS_DIR = env.certs;
    if (env.tmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = env.tmp;
});

const local = (basePath: string) => ({ basePath });
const asMember = () => {
    mocks.headers.mockResolvedValue(new Headers());
    mocks.ctx = { isPlatformAdmin: false, authMethod: "session", tenantId: "default", allTenants: false };
};
const asPlatformAdmin = (authMethod = "session") => {
    mocks.headers.mockResolvedValue(new Headers());
    mocks.ctx = { isPlatformAdmin: true, authMethod, tenantId: "default", allTenants: false };
};

beforeEach(() => {
    mocks.headers.mockReset();
    mocks.ctx = null;
    // The configuration backup goes to the Local Filesystem "nas" at the backups folder.
    prismaMock.systemSetting.findUnique.mockResolvedValue({ key: "config.backup.storageId", value: "nas" } as never);
    prismaMock.adapterConfig.findFirst.mockResolvedValue({ adapterId: "local-filesystem", config: JSON.stringify({ basePath: `${backups}/` }) } as never);
});

describe("a local path that reaches DBackup's own data", () => {
    it("is refused when it is the folder of the database, lies inside it or holds it, however it is written", async () => {
        for (const basePath of [dataDir, `${dataDir}/`, path.join(dataDir, "nested"), path.join(root, "data"), "/", path.join(root, "member", "..", "data", "db", "..")]) {
            expect(await ownDataRefusal("local-filesystem", local(basePath))).toBe(OWN_DATA_REFUSED);
        }
        for (const file of ["dbackup.db", "dbackup.db.before-migrate-2026-10-26", "restore-pending.db"]) {
            expect(await ownDataRefusal("sqlite", { mode: "local", path: path.join(dataDir, file) })).toBe(OWN_DATA_REFUSED);
        }
    });

    it("is refused at the temporary folder, which holds the plain copy of the configuration backup and decrypted restores", async () => {
        const tmp = path.join(root, "tmp");
        expect(await ownDataRefusal("local-filesystem", local(tmp))).toBe(TEMP_FOLDER_REFUSED);
        expect(await ownDataRefusal("local-filesystem", local(path.join(tmp, "run-1")))).toBe(TEMP_FOLDER_REFUSED);
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "member", "scratch")))).toBe(TEMP_FOLDER_REFUSED);
        expect(await ownDataRefusal("sqlite", { mode: "local", path: path.join(tmp, "run-1", "config.db") })).toBe(TEMP_FOLDER_REFUSED);
        // The folder of a job inside an allowed connection that is a link into it.
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "member")), { subPath: "scratch" })).toBe(TEMP_FOLDER_REFUSED);
    });

    it("counts the shared folder of SQL Server, but not the temporary folder, where it only touches names it made up", async () => {
        expect(localPathOf("mssql", { host: "sql", fileTransferMode: "local", localBackupPath: dataDir })).toBe(dataDir);
        expect(localPathOf("mssql", { host: "sql" })).toBe("/tmp");
        expect(localPathOf("mssql", { host: "sql", fileTransferMode: "ssh", sshUsername: "backup" })).toBeNull();
        expect(await ownDataRefusal("mssql", { host: "sql", fileTransferMode: "local", localBackupPath: dataDir })).toBe(OWN_DATA_REFUSED);
        expect(await ownDataRefusal("mssql", { host: "sql", fileTransferMode: "local", localBackupPath: path.join(root, "tmp") })).toBeNull();
    });

    it("is refused when it holds the folder of the TLS certificate", async () => {
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "data", "certs")))).toBe(OWN_DATA_REFUSED);
    });

    it("is refused through a link that points there", async () => {
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "member", "innocent")))).toBe(OWN_DATA_REFUSED);
        expect(await ownDataRefusal("sqlite", { mode: "local", path: path.join(root, "member", "app.sqlite") })).toBe(OWN_DATA_REFUSED);
        // The folder of a job inside an allowed connection that is a link into the data folder.
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "member")), { subPath: "/innocent" })).toBe(OWN_DATA_REFUSED);
    });

    it("follows a link that does not lead anywhere yet to where a write through it lands, like the Local Filesystem does", async () => {
        // A folder of a job that is a link to a folder not made yet inside the data folder. A write
        // through it creates that folder, so it counts as the folder it points at.
        fs.symlinkSync(path.join(dataDir, "not-yet"), path.join(root, "member", "later"));
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "member")), { subPath: "later/Nightly" })).toBe(OWN_DATA_REFUSED);
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "member", "later")))).toBe(OWN_DATA_REFUSED);
    });

    it("reads a loop of links as the path it is, which no write follows", async () => {
        fs.symlinkSync("loop-b", path.join(root, "member", "loop-a"));
        fs.symlinkSync("loop-a", path.join(root, "member", "loop-b"));
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "member", "loop-a", "x")))).toBeNull();
    });

    it("is refused at the folder of the configuration backup, also as a second connection to its destination", async () => {
        expect(await ownDataRefusal("local-filesystem", local(backups))).toBe(CONFIG_BACKUP_FOLDER_REFUSED);
        expect(await ownDataRefusal("local-filesystem", local(path.join(backups, "config-backups")))).toBe(CONFIG_BACKUP_FOLDER_REFUSED);
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "member", "reports")))).toBe(CONFIG_BACKUP_FOLDER_REFUSED);
    });

    it("lets the destination of the configuration backup write into its own folder", async () => {
        expect(await ownDataRefusal("local-filesystem", local(backups), { configId: "nas" })).toBeNull();
    });

    it("passes a folder beside them, one that only starts like them, SQLite over SSH and every other adapter", async () => {
        expect(await ownDataRefusal("local-filesystem", local(path.join(backups, "shop")))).toBeNull();
        expect(await ownDataRefusal("local-filesystem", local(`${dataDir}-old`))).toBeNull();
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "member")))).toBeNull();
        expect(await ownDataRefusal("sqlite", { mode: "ssh", path: path.join(dataDir, "dbackup.db") })).toBeNull();
        expect(await ownDataRefusal("sftp", { basePath: dataDir })).toBeNull();
    });

    it("is refused while the folder of the configuration backup cannot be read", async () => {
        prismaMock.systemSetting.findUnique.mockRejectedValue(new Error("database is locked"));
        expect(await ownDataRefusal("local-filesystem", local(path.join(backups, "shop")))).not.toBeNull();
    });
});

describe("who may add or try such a connection", () => {
    it("refuses a member of the home tenant, who may not try a connection to the server at all", async () => {
        asMember();
        await expect(assertOffOwnData("local-filesystem", local(dataDir))).rejects.toBeInstanceOf(ValidationError);
        await expect(assertConfigOffHost("sqlite", { mode: "local", path: path.join(dataDir, "dbackup.db") })).rejects.toThrow("which only a platform admin adds");
        await expect(assertConfigOffHost("local-filesystem", local(path.join(backups, "shop")))).rejects.toThrow("which only a platform admin adds");
    });

    it("refuses an API key of a platform admin, like the database download", async () => {
        asPlatformAdmin("apikey");
        await expect(assertOffOwnData("local-filesystem", local(dataDir))).rejects.toThrow(OWN_DATA_REFUSED);
    });

    it("lets a platform admin with a session and code outside a request reach it", async () => {
        asPlatformAdmin();
        await expect(assertOffOwnData("local-filesystem", local(dataDir))).resolves.toBeUndefined();

        mocks.headers.mockRejectedValue(new Error("headers was called outside a request scope"));
        await expect(assertOffOwnData("local-filesystem", local(dataDir))).resolves.toBeUndefined();
    });

    it("lets a platform admin with a session try a folder that reaches none of it", async () => {
        asPlatformAdmin();
        await expect(assertOffOwnData("local-filesystem", local(path.join(backups, "shop")))).resolves.toBeUndefined();
        await expect(assertConfigOffHost("local-filesystem", local(path.join(backups, "shop")))).resolves.toBeUndefined();
    });
});

describe("where the reach of a connection is decided", () => {
    const saved = (id: string, basePath: string) => ({ id, adapterId: "local-filesystem", config: JSON.stringify({ basePath }), primaryCredentialId: null, sshCredentialId: null, tenantId: "default" });

    it("refuses a member of the home tenant every Local Filesystem connection, whatever folder it names", async () => {
        asMember();
        await expect(runAsTenant("default", () => assertMayReachHost("local-filesystem", local(dataDir)))).rejects.toThrow("which only a platform admin adds");
        await expect(runAsTenant("default", () => assertMayReachHost("local-filesystem", local(path.join(backups, "shop"))))).rejects.toThrow("which only a platform admin adds");
    });

    it("refuses an API key of a platform admin a folder of its own data, and lets the session add one beside it", async () => {
        asPlatformAdmin("apikey");
        await expect(runAsTenant("default", () => assertMayReachHost("local-filesystem", local(path.join(backups, "shop"))))).rejects.toThrow("which only a platform admin adds");
        asPlatformAdmin();
        await expect(runAsTenant("default", () => assertMayReachHost("local-filesystem", () => local(backups)))).resolves.toBeUndefined();
        await expect(runAsTenant("default", () => assertMayReachHost("local-filesystem", local(path.join(backups, "shop"))))).resolves.toBeUndefined();
    });

    it("refuses a member a saved connection of the platform admin that reaches it, but not the destination of the configuration backup", async () => {
        asMember();
        await expect(resolveAdapterConfig(saved("admin-data", dataDir))).rejects.toThrow(OWN_DATA_REFUSED);
        await expect(resolveAdapterConfig(saved("nas", backups))).resolves.toEqual(markLocalNetwork({ basePath: backups }, false));
    });

    it("hands a platform admin and a run outside a request the saved connection", async () => {
        asPlatformAdmin();
        await expect(resolveAdapterConfig(saved("admin-data", dataDir))).resolves.toEqual(markLocalNetwork({ basePath: dataDir }, false));
        mocks.headers.mockRejectedValue(new Error("headers was called outside a request scope"));
        await expect(resolveAdapterConfig(saved("admin-data", dataDir))).resolves.toEqual(markLocalNetwork({ basePath: dataDir }, false));
    });
});

describe("a task that goes through every destination", () => {
    it("leaves out one whose folder reaches the own data of DBackup, but not the destination of the configuration backup", async () => {
        expect(await scanRefusal("local-filesystem", local(dataDir), "admin-data")).toBe(OWN_DATA_REFUSED);
        expect(await scanRefusal("local-filesystem", local(path.join(root, "tmp")), "scratch")).toBe(TEMP_FOLDER_REFUSED);
        expect(await scanRefusal("local-filesystem", local(backups), "second")).toBe(CONFIG_BACKUP_FOLDER_REFUSED);
        expect(await scanRefusal("local-filesystem", local(root), "nas")).toBeNull();
        expect(await scanRefusal("local-filesystem", local(path.join(backups, "shop")), "shop")).toBeNull();
        expect(await scanRefusal("s3-aws", { bucket: "backups" }, "s3")).toBeNull();
    });
});

describe("a SQLite source in local mode at run time", () => {
    it("neither dumps nor restores over DBackup's own database through a link, whoever saved it", async () => {
        const config = { mode: "local", path: path.join(root, "member", "app.sqlite") };
        const host = createFakeHost({ kind: "direct" });

        const dumped = await dump(config as never, path.join(root, "out.sqlite"), host);
        const restored = await restore(config as never, path.join(root, "in.sqlite"), host);

        expect(dumped).toMatchObject({ success: false, error: OWN_DATA_REFUSED });
        expect(restored).toMatchObject({ success: false, error: OWN_DATA_REFUSED });
        expect(host.calls.exec).toEqual([]);
    });
});
