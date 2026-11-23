/**
 * Recently deleted brings back what a delete took, and nothing a member could not make again: a
 * connection that reaches the server DBackup runs on comes back through a platform admin alone,
 * and a job whose name leads out of its own folder not at all. Before, a member of the home tenant
 * restored a Local Filesystem connection like any other.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import type { Tx } from "@/lib/prisma-tx";

const mocks = vi.hoisted(() => ({ mayReachHost: vi.fn() }));
vi.stubEnv("ENCRYPTION_KEY", "e".repeat(64));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/adapters/config-resolver", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/adapters/config-resolver")>()),
    mayReachHost: () => mocks.mayReachHost(),
}));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn(async () => undefined) } }));

const { restoreFromTrash } = await import("@/services/trash/trash-service");
const { restoreSnapshot } = await import("@/services/trash/trash-restore");
const { encrypt } = await import("@/lib/crypto");

const connection = (adapterId: string, config: Record<string, unknown>) => ({
    id: "t-conn",
    kind: "connection",
    recordId: "conn-1",
    name: "Files",
    detail: null,
    data: JSON.stringify({
        record: { id: "conn-1", name: "Files", type: "storage", storageRole: "SOURCE", adapterId, config: JSON.stringify(config), primaryCredentialId: null, sshCredentialId: null },
    }),
    deletedAt: new Date(),
    permission: "sources:write",
    superAdminOnly: false,
    tenantId: "default",
});

describe("a deleted connection that reaches the server DBackup runs on", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.$transaction.mockImplementation((async () => ({ name: "Files", notes: [] })) as never);
        // No destination of the tenant is shared with customers, see `assertOffSharedPlaces`.
        prismaMock.connectionShare.findMany.mockResolvedValue([]);
    });

    it("comes back for a platform admin alone", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(connection("local-filesystem", { basePath: "/srv/files" }) as never);

        mocks.mayReachHost.mockResolvedValue(false);
        const refused = await restoreFromTrash(["t-conn"]);
        expect(refused.restored).toEqual([]);
        expect(refused.failed).toEqual([{ id: "t-conn", name: "Files", error: "Local Filesystem reaches the server DBackup runs on, which only a platform admin adds." }]);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();

        mocks.mayReachHost.mockResolvedValue(true);
        const restored = await restoreFromTrash(["t-conn"]);
        expect(restored.restored).toHaveLength(1);
    });

    it("leaves a connection to a server of its own to whoever may restore its kind", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(connection("sftp", { host: "nas.internal", username: "backup" }) as never);
        mocks.mayReachHost.mockResolvedValue(false);

        const result = await restoreFromTrash(["t-conn"]);

        expect(result.restored).toHaveLength(1);
        expect(mocks.mayReachHost).not.toHaveBeenCalled();
    });

    it("does not come back with a port or a host that would reach a command line, which an earlier version stored", async () => {
        mocks.mayReachHost.mockResolvedValue(false);
        const login = { username: "backup", authType: "password", password: "pw" };
        for (const config of [{ host: "nas.internal", port: "22 -oProxyCommand=x", ...login }, { host: "nas\n-oProxyCommand=x", ...login }]) {
            prismaMock.deletedRecord.findUnique.mockResolvedValue(connection("rsync", config) as never);

            const result = await restoreFromTrash(["t-conn"]);

            expect(result.restored).toEqual([]);
            expect(result.failed[0].error).toMatch(/settings of the connection do not fit/);
            expect(result.failed[0].error).not.toMatch(/ProxyCommand/);
        }
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
});

const login = (data: string) => ({
    id: "t-login",
    kind: "credential",
    recordId: "cred-1",
    name: "Deploy key",
    detail: null,
    data: JSON.stringify({ record: { id: "cred-1", name: "Deploy key", type: "SSH_KEY", data } }),
    deletedAt: new Date(),
    permission: "credentials:delete",
    superAdminOnly: false,
    tenantId: "default",
});

describe("a deleted SSH login that uses the agent of the server DBackup runs on", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.$transaction.mockImplementation((async () => ({ name: "Deploy key", notes: [] })) as never);
    });

    it("comes back for a platform admin alone, like when it is created", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(login(encrypt(JSON.stringify({ username: "deploy", authType: "agent" }))) as never);

        mocks.mayReachHost.mockResolvedValue(false);
        const refused = await restoreFromTrash(["t-login"]);
        expect(refused.restored).toEqual([]);
        expect(refused.failed).toHaveLength(1);
        expect(refused.failed[0].error).toMatch(/agent/i);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();

        mocks.mayReachHost.mockResolvedValue(true);
        expect((await restoreFromTrash(["t-login"])).restored).toHaveLength(1);
    });

    it("counts a login it cannot read as one with the agent, and leaves a login with its own key to whoever may restore it", async () => {
        mocks.mayReachHost.mockResolvedValue(false);
        prismaMock.deletedRecord.findUnique.mockResolvedValue(login("not encrypted") as never);
        expect((await restoreFromTrash(["t-login"])).restored).toEqual([]);

        prismaMock.deletedRecord.findUnique.mockResolvedValue(login(encrypt(JSON.stringify({ username: "deploy", authType: "privateKey", privateKey: "key" }))) as never);
        expect((await restoreFromTrash(["t-login"])).restored).toHaveLength(1);
    });
});

describe("a deleted job whose name leads out of its own folder", () => {
    it("is not restored, under its own name or a new one", async () => {
        const snapshot = { record: { id: "job-1", name: "x/../config-backups" }, destinations: [] };
        await expect(restoreSnapshot(prismaMock as unknown as Tx, "job", snapshot as never)).rejects.toThrow("cannot be called config-backups");
        await expect(restoreSnapshot(prismaMock as unknown as Tx, "job", snapshot as never, "nightly/..")).rejects.toThrow("cannot hold a . or .. folder");
        expect(prismaMock.job.create).not.toHaveBeenCalled();
    });
});

const savedLogin = (type: string, data: Record<string, unknown>) => ({
    ...login(""),
    data: JSON.stringify({ record: { id: "cred-1", name: "Shop login", type, data: encrypt(JSON.stringify(data)) } }),
});

describe("a deleted login with a value a save refuses today, which an earlier version stored", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mayReachHost.mockResolvedValue(false);
        prismaMock.$transaction.mockImplementation((async () => ({ name: "Shop login", notes: [] })) as never);
    });

    it("does not come back with a line break in the password, which starts an option of its own for the MySQL tools", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(savedLogin("USERNAME_PASSWORD", { username: "shop", password: "pw\nplugin-dir=/srv" }) as never);

        const result = await restoreFromTrash(["t-login"]);

        expect(result.restored).toEqual([]);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).not.toMatch(/plugin-dir/);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("does not come back with a line break in the username", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(savedLogin("USERNAME_PASSWORD", { username: "shop\nx", password: "pw" }) as never);

        expect((await restoreFromTrash(["t-login"])).restored).toEqual([]);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("does not come back with a username rsync would read as an option while an rsync destination logs in with it", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(savedLogin("SSH_KEY", { username: "-e sh", authType: "privateKey", privateKey: "key" }) as never);
        prismaMock.adapterConfig.count.mockResolvedValue(1 as never);

        expect((await restoreFromTrash(["t-login"])).restored).toEqual([]);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("comes back with plain values", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(savedLogin("USERNAME_PASSWORD", { username: "shop", password: "a long pass phrase" }) as never);

        expect((await restoreFromTrash(["t-login"])).restored).toHaveLength(1);
    });
});
