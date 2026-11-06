/**
 * A connection that reaches the server DBackup runs on, like Local Filesystem with the folder "/"
 * or SQLite pointed at the database of DBackup, is added and copied by a platform admin with a
 * session alone: a customer's tenant never, a member of the home tenant neither, which before could
 * and was held back only by a list of paths. Code outside a request, like the lab seed, still does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("ENCRYPTION_KEY", "d".repeat(64));

const mocks = vi.hoisted(() => ({
    isShared: vi.fn(),
    // Whether the code that runs now is a platform admin with a session, see `mayReachHost`.
    mayReachHost: vi.fn(),
    profiles: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/credential-validation", () => ({ validateCredentialAssignments: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/adapters/snapshot-validation", () => ({ validateSnapshotConfig: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/sharing/destination-access", () => ({ isShared: (...args: unknown[]) => mocks.isShared(...args) }));
vi.mock("@/lib/adapters/config-resolver", () => {
    const overlay = async (_adapterId: string, config: Record<string, unknown>, primary: string | null, ssh: string | null) => ({
        ...config,
        ...(primary ? mocks.profiles[primary] : {}),
        ...(ssh ? mocks.profiles[ssh] : {}),
    });
    return { overlayCredentialsOnConfig: overlay, layLoginsOver: overlay, mayReachHost: () => mocks.mayReachHost() };
});

import { prismaMock } from "@/lib/testing/prisma-mock";
import { encryptConfig } from "@/lib/crypto";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { createAdapter } from "@/services/adapters/adapter-create";
import { cloneAdapter } from "@/services/adapters/adapter-clone";

const ROOT = { name: "Everything", type: "storage", adapterId: "local-filesystem", config: { basePath: "/" } };
const DBACKUP_DB = { name: "DBackup", type: "database", adapterId: "sqlite", config: { mode: "local", path: "/app/data/dbackup.db" } };

describe("adding a connection that reaches the server DBackup runs on", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.profiles = {};
        mocks.mayReachHost.mockResolvedValue(true);
        prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
        // The tenant shares no destination with customers.
        prismaMock.connectionShare.findMany.mockResolvedValue([]);
        prismaMock.adapterConfig.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "new", ...args.data })) as never);
        // Every kind is one the tenants may add themselves.
        prismaMock.tenant.findUnique.mockResolvedValue({ name: "Acme", addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true } as never);
    });

    it("refuses Local Filesystem and SQLite in local mode in a customer's tenant", async () => {
        await expect(runAsTenant("acme", () => createAdapter(ROOT)))
            .rejects.toThrow("Local Filesystem reaches the server DBackup runs on, which only a platform admin adds.");
        await expect(runAsTenant("acme", () => createAdapter(DBACKUP_DB))).rejects.toThrow("SQLite in local mode reads a file on the server DBackup runs on");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("refuses every kind of it to a member of the home tenant, who may still pick one in a job", async () => {
        mocks.mayReachHost.mockResolvedValue(false);
        const home = (input: Parameters<typeof createAdapter>[0]) => runAsTenant(HOME_TENANT_ID, () => createAdapter(input));

        await expect(home(ROOT)).rejects.toThrow("Local Filesystem reaches the server DBackup runs on, which only a platform admin adds.");
        await expect(home(DBACKUP_DB)).rejects.toThrow("SQLite in local mode reads a file on the server DBackup runs on");
        await expect(home({ name: "Volumes", type: "storage", adapterId: "docker-volume", storageRole: "SOURCE", config: { connectionMode: "direct" } })).rejects.toThrow("without SSH reach the Docker");
        await expect(home({ name: "Shop", type: "database", adapterId: "mysql", config: { host: "db.internal", options: "--result-file=/srv/x" } })).rejects.toThrow("The additional options of MySQL");
        await expect(home({ name: "ERP", type: "database", adapterId: "mssql", config: { host: "sql.internal", fileTransferMode: "local", localBackupPath: "/mnt/mssql" } }))
            .rejects.toThrow("with a shared folder moves its backup files");
        await expect(home({ ...ROOT, config: { basePath: "/srv/backups" } })).rejects.toThrow("which only a platform admin adds");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();

        // A server of its own stays open to the member.
        await expect(home({ name: "Shop", type: "database", adapterId: "mysql", config: { host: "db.internal", user: "backup" } })).resolves.toMatchObject({ id: "new" });
        await expect(home({ name: "ERP", type: "database", adapterId: "mssql", config: { host: "sql.internal", fileTransferMode: "ssh", sshUsername: "backup" } })).resolves.toMatchObject({ id: "new" });
    });

    it("lets a platform admin add them in the home tenant, and code outside any tenant", async () => {
        await runAsTenant(HOME_TENANT_ID, () => createAdapter(ROOT));
        await runAsSystem(() => createAdapter({ ...DBACKUP_DB, name: "DBackup 2" }));
        await createAdapter({ ...ROOT, name: "Script" });

        expect(prismaMock.adapterConfig.create).toHaveBeenCalledTimes(3);
    });

    it("refuses an SSH key profile that logs in through the agent of the server, which the config alone does not show", async () => {
        mocks.profiles = { agent: { authType: "agent", username: "backup" } };
        const overSsh = { name: "App DB", type: "database", adapterId: "sqlite", config: { mode: "ssh", host: "app.acme", path: "/srv/app.db" } };

        await expect(runAsTenant("acme", () => createAdapter({ ...overSsh, sshCredentialId: "agent" }))).rejects.toThrow("An SSH agent login");
        await expect(runAsTenant("acme", () => createAdapter(overSsh))).resolves.toMatchObject({ id: "new" });
    });

    it("adds a customer's own server as before", async () => {
        await expect(runAsTenant("acme", () => createAdapter({ name: "Shop", type: "database", adapterId: "mysql", config: { host: "db.acme", user: "backup" } })))
            .resolves.toMatchObject({ id: "new" });
    });
});

describe("copying a connection", () => {
    const original = (overrides: Record<string, unknown> = {}) => ({
        id: "orig",
        name: "Files",
        type: "storage",
        adapterId: "local-filesystem",
        storageRole: "SOURCE",
        config: JSON.stringify(encryptConfig({ basePath: "/srv" })),
        metadata: null,
        primaryCredentialId: null,
        sshCredentialId: null,
        ...overrides,
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isShared.mockResolvedValue(false);
        mocks.mayReachHost.mockResolvedValue(true);
        prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
        // The tenant shares no destination with customers.
        prismaMock.connectionShare.findMany.mockResolvedValue([]);
        prismaMock.adapterConfig.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "copy", ...args.data })) as never);
        prismaMock.tenant.findUnique.mockResolvedValue({ name: "Acme", addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true } as never);
    });

    it("refuses a copy of a connection that reaches the server DBackup runs on in a customer's tenant, wherever the original came from", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(original() as never);

        await expect(runAsTenant("acme", () => cloneAdapter("orig", {}))).rejects.toThrow("Local Filesystem reaches the server DBackup runs on");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();

        await expect(runAsTenant(HOME_TENANT_ID, () => cloneAdapter("orig", {}))).resolves.toMatchObject({ clone: { id: "copy" } });
    });

    it("refuses a copy of a Local Filesystem connection to a member of the home tenant", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(original() as never);
        mocks.mayReachHost.mockResolvedValue(false);

        await expect(runAsTenant(HOME_TENANT_ID, () => cloneAdapter("orig", {}))).rejects.toThrow("which only a platform admin adds");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("refuses a copy of a destination shared with other tenants, which would show the folders of its customers", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(original({ adapterId: "s3-aws", storageRole: "DESTINATION", config: JSON.stringify(encryptConfig({ bucket: "b" })) }) as never);
        mocks.isShared.mockResolvedValue(true);

        await expect(runAsTenant(HOME_TENANT_ID, () => cloneAdapter("orig", { role: "SOURCE" }))).rejects.toThrow("It is shared with other tenants, so it is not copied.");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });
});
