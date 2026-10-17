import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    checkPermissionWithContext: vi.fn(),
    headers: vi.fn(),
    registryGet: vi.fn(),
    checkBackupPath: vi.fn(),
    checkBackupPathShared: vi.fn(),
    exec: vi.fn(),
    dispose: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: () => mocks.headers() }));

vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (...args: unknown[]) => mocks.checkPermissionWithContext(...args),
}));

vi.mock("@/lib/core/registry", () => ({
    registry: { get: (...args: unknown[]) => mocks.registryGet(...args) },
}));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));

vi.mock("@/lib/adapters/config-resolver", () => ({
    overlayCredentialsOnConfig: vi.fn(),
    // Every test here is about the SSH login of a server of its own, not about the server DBackup runs on.
    assertConfigOffHost: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mssql/preflight", () => ({
    checkBackupPath: (...args: unknown[]) => mocks.checkBackupPath(...args),
    checkBackupPathShared: (...args: unknown[]) => mocks.checkBackupPathShared(...args),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("@/lib/transport", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/transport")>();
    class FakeSshHost {
        exec = (...args: unknown[]) => mocks.exec(...args);
        dispose = () => mocks.dispose();
    }
    return {
        ...actual,
        SshHost: FakeSshHost,
        createHost: () => new FakeSshHost(),
    };
});

import { POST } from "@/app/api/adapters/test-ssh/route";

function request(body: unknown) {
    return { json: async () => body } as never;
}

const sshConfig = {
    connectionMode: "ssh",
    sshHost: "192.168.252.4",
    sshPort: 22,
    sshUsername: "ubuntu",
    sshAuthType: "privateKey",
    sshPrivateKey: "key",
};

describe("POST /api/adapters/test-ssh", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAuthContext.mockResolvedValue({ userId: "u1" });
        mocks.checkPermissionWithContext.mockResolvedValue(undefined);
        mocks.headers.mockResolvedValue(new Headers());
        mocks.registryGet.mockReturnValue({ id: "mysql" });
        mocks.exec.mockResolvedValue({ code: 0, stdout: "connected\n", stderr: "" });
        mocks.dispose.mockResolvedValue(undefined);
        mocks.checkBackupPath.mockResolvedValue({ readable: false, writable: false, error: "Path not found" });
        mocks.checkBackupPathShared.mockResolvedValue({ shared: true });
    });

    it("does not check the SQL Server backup path for other adapters", async () => {
        // The condition used to be `connectionMode === "ssh"`, which is true for
        // every adapter in SSH mode. A MySQL source was told its SQL Server
        // backup path was missing on a host that never ran SQL Server.
        const response = await POST(request({ config: sshConfig, adapterId: "mysql" }));
        const body = await response.json();

        expect(mocks.checkBackupPath).not.toHaveBeenCalled();
        expect(body.success).toBe(true);
        expect(body.message).not.toContain("backup path");
    });

    it("does not check it for a SQLite source either", async () => {
        // SQLite stores `mode` and unprefixed SSH keys, so it needs its own
        // resolver to be reachable at all.
        const { sqliteTransport } = await import("@/lib/adapters/database/sqlite/transport");
        mocks.registryGet.mockReturnValue({ id: "sqlite", transport: sqliteTransport });
        const response = await POST(request({
            config: { mode: "ssh", host: "10.0.0.4", username: "ops", authType: "privateKey", privateKey: "key" },
            adapterId: "sqlite",
        }));
        const body = await response.json();

        expect(mocks.checkBackupPath).not.toHaveBeenCalled();
        expect(body.success).toBe(true);
    });

    it("checks the backup path for MSSQL, where the SSH account needs that directory", async () => {
        mocks.registryGet.mockReturnValue({ id: "mssql" });
        const response = await POST(request({
            config: { ...sshConfig, backupPath: "/var/opt/mssql/backup" },
            adapterId: "mssql",
        }));
        const body = await response.json();

        expect(mocks.checkBackupPath).toHaveBeenCalled();
        expect(body.success).toBe(false);
        expect(body.message).toContain("backup path is not accessible");
    });

    it("fails when SQL Server cannot see the directory the SSH account can", async () => {
        // A containerized SQL Server writes into its own /var/opt/mssql/backup.
        // Both sides then pass their own checks and the backup dies on the
        // download, which is the failure this cross-check exists to move
        // forward into the connection test.
        mocks.registryGet.mockReturnValue({ id: "mssql" });
        mocks.checkBackupPath.mockResolvedValue({ readable: true, writable: true });
        mocks.checkBackupPathShared.mockResolvedValue({ shared: false });

        const response = await POST(request({
            config: { ...sshConfig, backupPath: "/var/opt/mssql/backup" },
            adapterId: "mssql",
        }));
        const body = await response.json();

        expect(body.success).toBe(false);
        expect(body.message).toContain("does not see the same directory");
    });

    it("still reports success when the shared check cannot answer", async () => {
        // xp_fileexist is undocumented and a locked-down login may not run it.
        // Not being able to ask is not a reason to fail a working connection.
        mocks.registryGet.mockReturnValue({ id: "mssql" });
        mocks.checkBackupPath.mockResolvedValue({ readable: true, writable: true });
        mocks.checkBackupPathShared.mockResolvedValue(null);

        const response = await POST(request({
            config: { ...sshConfig, backupPath: "/var/opt/mssql/backup" },
            adapterId: "mssql",
        }));
        const body = await response.json();

        expect(body.success).toBe(true);
        expect(body.message).not.toContain("shared with SQL Server");
    });

    it.each([
        ["an embedded newline", "/var/opt/mssql/backup\nrm -rf /"],
        ["a carriage return", "/var/opt\r/backup"],
        ["a NUL byte", "/var/opt/mssql/backup\0"],
        ["an empty string", ""],
    ])("rejects a backup path with %s", async (_label, backupPath) => {
        mocks.registryGet.mockReturnValue({ id: "mssql" });

        const response = await POST(request({
            config: { ...sshConfig, backupPath },
            adapterId: "mssql",
        }));
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.success).toBe(false);
        expect(mocks.checkBackupPath).not.toHaveBeenCalled();
    });

    it.each([
        ["spaces", "/var/opt/sql server/backup"],
        // Not required to be absolute. SQL Server on Windows takes this, and the
        // adapter joins it with path.posix, so refusing it would narrow what
        // works today without protecting anything - the path never reaches a
        // command line.
        ["a Windows drive letter", "C:/Backups"],
        ["a relative path", "backups/mssql"],
    ])("accepts a backup path with %s", async (_label, backupPath) => {
        mocks.registryGet.mockReturnValue({ id: "mssql" });
        mocks.checkBackupPath.mockResolvedValue({ readable: true, writable: true });

        const response = await POST(request({
            config: { ...sshConfig, backupPath },
            adapterId: "mssql",
        }));

        expect((await response.json()).success).toBe(true);
        expect(mocks.checkBackupPath).toHaveBeenCalled();
    });

    it("still checks it for a direct MSSQL source using SSH file transfer", async () => {
        mocks.registryGet.mockReturnValue({ id: "mssql" });
        mocks.checkBackupPath.mockResolvedValue({ readable: true, writable: true });
        const response = await POST(request({
            config: {
                fileTransferMode: "ssh",
                sshHost: "10.0.0.4",
                sshUsername: "ops",
                sshAuthType: "privateKey",
                sshPrivateKey: "key",
                backupPath: "/var/opt/mssql/backup",
            },
            adapterId: "mssql",
        }));
        const body = await response.json();

        expect(mocks.checkBackupPath).toHaveBeenCalled();
        expect(body.success).toBe(true);
    });
});
