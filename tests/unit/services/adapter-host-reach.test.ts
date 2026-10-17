/**
 * A connection that reaches the server DBackup runs on, like Local Filesystem with the folder "/"
 * or SQLite pointed at the database of DBackup, is the platform's alone: a customer's tenant
 * neither adds nor copies one, the home tenant and code outside any tenant do.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("ENCRYPTION_KEY", "d".repeat(64));

const mocks = vi.hoisted(() => ({
    isShared: vi.fn(),
    profiles: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/credential-validation", () => ({ validateCredentialAssignments: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/adapters/snapshot-validation", () => ({ validateSnapshotConfig: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/sharing/destination-access", () => ({ isShared: (...args: unknown[]) => mocks.isShared(...args) }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    overlayCredentialsOnConfig: async (_adapterId: string, config: Record<string, unknown>, primary: string | null, ssh: string | null) => ({
        ...config,
        ...(primary ? mocks.profiles[primary] : {}),
        ...(ssh ? mocks.profiles[ssh] : {}),
    }),
}));

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
        prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
        prismaMock.adapterConfig.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "new", ...args.data })) as never);
        // Every kind is one the tenants may add themselves.
        prismaMock.tenant.findUnique.mockResolvedValue({ name: "Acme", addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true } as never);
    });

    it("refuses Local Filesystem and SQLite in local mode in a customer's tenant", async () => {
        await expect(runAsTenant("acme", () => createAdapter(ROOT)))
            .rejects.toThrow("Local Filesystem reaches the server DBackup runs on, which only the platform adds.");
        await expect(runAsTenant("acme", () => createAdapter(DBACKUP_DB))).rejects.toThrow("SQLite in local mode reads a file on the server DBackup runs on");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("lets the platform add them, in the home tenant and outside any tenant", async () => {
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
        prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
        prismaMock.adapterConfig.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "copy", ...args.data })) as never);
        prismaMock.tenant.findUnique.mockResolvedValue({ name: "Acme", addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true } as never);
    });

    it("refuses a copy of a connection that reaches the server DBackup runs on in a customer's tenant, wherever the original came from", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(original() as never);

        await expect(runAsTenant("acme", () => cloneAdapter("orig", {}))).rejects.toThrow("Local Filesystem reaches the server DBackup runs on");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();

        await expect(runAsTenant(HOME_TENANT_ID, () => cloneAdapter("orig", {}))).resolves.toMatchObject({ clone: { id: "copy" } });
    });

    it("refuses a copy of a destination shared with other tenants, which would show the folders of its customers", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(original({ adapterId: "s3-aws", storageRole: "DESTINATION", config: JSON.stringify(encryptConfig({ bucket: "b" })) }) as never);
        mocks.isShared.mockResolvedValue(true);

        await expect(runAsTenant(HOME_TENANT_ID, () => cloneAdapter("orig", { role: "SOURCE" }))).rejects.toThrow("It is shared with other tenants, so it is not copied.");
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });
});
