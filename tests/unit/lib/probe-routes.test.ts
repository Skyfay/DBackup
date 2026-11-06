// @vitest-environment node
/**
 * The pickers and checks of a connection form reach a server of the caller's choosing with its
 * login, like the test of a connection. The audit log keeps each look once it ran, and the answer
 * passes what the server said, never the words of a failure of DBackup itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AdapterAnswerError } from "@/lib/adapters/adapter-answer";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    logFor: vi.fn(),
    browseLocation: vi.fn(),
    listRemoteDirectory: vi.fn(),
    listLocalDirectory: vi.fn(),
    supportsSnapshot: vi.fn(),
    getDatabases: vi.fn(),
    overlay: vi.fn(),
}));

const CTX = { userId: "u1", authMethod: "session", tenantId: "default", allTenants: false, isPlatformAdmin: true, permissions: [] as string[] };

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => CTX,
    checkPermissionWithContext: () => undefined,
    hasPermissionWithContext: () => true,
    tenantOf: () => "default",
    checkPlatformAdmin: async () => ({ id: "u1", isPlatformAdmin: true, tenantId: "default" }),
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor, log: vi.fn() } }));
vi.mock("@/lib/server/config-backup-target-guard", () => ({ savedLoginRefusal: async () => null, storedSecretsRefusal: async () => null }));
vi.mock("@/lib/auth/form-config-access", () => ({ assertMayReadFormConfig: () => undefined }));
vi.mock("@/lib/auth/saved-login-access", () => ({ assertMayApplySavedLogin: () => undefined, namesSavedLogin: () => false }));
vi.mock("@/lib/auth/adapter-config-access", () => ({ canEditStoredConfig: () => false }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    overlayCredentialsOnConfig: (...args: unknown[]) => mocks.overlay(...args),
    assertConfigOffHost: async () => undefined,
    applyStoredSecrets: async (_id: string, _configId: string, config: unknown) => config,
}));
vi.mock("@/lib/core/registry", () => ({
    registry: { get: (id: string) => ({ id, supportsSnapshot: mocks.supportsSnapshot, getDatabases: mocks.getDatabases }) },
}));
vi.mock("@/lib/transport", () => ({ withHost: async (_adapter: unknown, _config: unknown, fn: (host: unknown) => Promise<unknown>) => fn({}) }));
vi.mock("@/services/databases/databases-read-audit", () => ({ auditedDatabasesRead: (_ctx: unknown, _target: unknown, read: () => Promise<unknown>) => read() }));
vi.mock("@/services/adapters/location-browse-service", () => ({ browseLocation: (...args: unknown[]) => mocks.browseLocation(...args) }));
vi.mock("@/services/system/filesystem-service", () => ({
    BlockedPathError: class BlockedPathError extends Error {},
    listRemoteDirectory: (...args: unknown[]) => mocks.listRemoteDirectory(...args),
    listLocalDirectory: (...args: unknown[]) => mocks.listLocalDirectory(...args),
}));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

const browseLocationRoute = await import("@/app/api/adapters/browse-location/route");
const remoteRoute = await import("@/app/api/system/filesystem/remote/route");
const localRoute = await import("@/app/api/system/filesystem/route");
const snapshotRoute = await import("@/app/api/adapters/check-snapshot/route");
const accessCheckRoute = await import("@/app/api/adapters/access-check/route");

const post = (body: unknown) => new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const LISTING = { currentPath: "/srv", parentPath: "/", entries: [] };
const entry = (details: Record<string, unknown>) => [CTX, "EXECUTE", "ADAPTER", details];

beforeEach(() => {
    vi.clearAllMocks();
    mocks.browseLocation.mockResolvedValue([]);
    mocks.listRemoteDirectory.mockResolvedValue(LISTING);
    mocks.listLocalDirectory.mockResolvedValue(LISTING);
    mocks.supportsSnapshot.mockResolvedValue({ supported: true, message: "VSS is available" });
    mocks.getDatabases.mockResolvedValue(["shop"]);
    mocks.overlay.mockImplementation(async (_id: string, config: unknown) => config);
});

/** A failure of DBackup itself, before any server was asked, whose words name a file of DBackup. */
const ownFailure = () => mocks.overlay.mockRejectedValueOnce(new Error("Unsupported state or unable to authenticate data: /app/data/dbackup.db"));

describe("the audit log of a look at a server", () => {
    it("keeps a browse of the folders of a connection form with its adapter and host, whether the server answered or not", async () => {
        const body = { adapterId: "sftp", config: { host: "nas.example.ch:2222" }, path: "srv" };
        await browseLocationRoute.POST(post(body));
        mocks.browseLocation.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
        await browseLocationRoute.POST(post(body));

        expect(mocks.logFor.mock.calls).toEqual([
            entry({ action: "folder_browse", adapter: "sftp", host: "nas.example.ch", success: true }),
            entry({ action: "folder_browse", adapter: "sftp", host: "nas.example.ch", success: false }),
        ]);
    });

    it("writes nothing for a browse that was refused before it dialed", async () => {
        mocks.browseLocation.mockRejectedValueOnce(new ValidationError("The host is in the local network"));

        expect((await browseLocationRoute.POST(post({ adapterId: "sftp", config: { host: "10.0.0.5" }, path: "" }))).status).toBe(400);
        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("keeps a browse over SFTP of a path field and one of the server DBackup runs on", async () => {
        await remoteRoute.POST(post({ adapterId: "sqlite", config: { host: "files.example.ch" }, path: "/srv" }));
        await localRoute.GET(new NextRequest("http://localhost/api/system/filesystem?path=/backups"));

        expect(mocks.logFor.mock.calls).toEqual([
            entry({ action: "folder_browse", adapter: "sqlite", host: "files.example.ch", success: true }),
            [{ userId: "u1", authMethod: "session" }, "EXECUTE", "ADAPTER", { action: "folder_browse", local: true, success: true }],
        ]);
    });

    it("keeps a snapshot check with its host", async () => {
        await snapshotRoute.POST(post({ adapterId: "smb", config: { address: "//fs1.example.ch/backups" } }));

        expect(mocks.logFor).toHaveBeenCalledExactlyOnceWith(...entry({ action: "snapshot_check", adapter: "smb", host: "fs1.example.ch", success: true }));
    });
});

describe("the answer of a look that failed", () => {
    it("passes what the SFTP server said and keeps a failure of DBackup in the log", async () => {
        const body = { adapterId: "sqlite", config: { host: "files.example.ch" }, path: "/srv" };
        mocks.listRemoteDirectory.mockRejectedValueOnce(new AdapterAnswerError("sftp", "list folder", "No such file: /srv"));
        expect(await (await remoteRoute.POST(post(body))).json()).toMatchObject({ error: "No such file: /srv" });

        mocks.listRemoteDirectory.mockRejectedValueOnce(new Error("ENOENT: /app/data/dbackup.db"));
        const broken = await remoteRoute.POST(post(body));
        expect(broken.status).toBe(500);
        expect((await broken.json()).error).not.toContain("dbackup.db");
    });

    it("passes what the file server said to the snapshot check, and nothing of a failure of DBackup", async () => {
        const body = { adapterId: "smb", config: { address: "//fs1.example.ch/backups" } };
        mocks.supportsSnapshot.mockRejectedValueOnce(new Error("NT_STATUS_LOGON_FAILURE"));
        expect(await (await snapshotRoute.POST(post(body))).json()).toEqual({ supported: false, message: "NT_STATUS_LOGON_FAILURE" });

        ownFailure();
        const broken = await snapshotRoute.POST(post(body));
        expect(broken.status).toBe(500);
        const answer = await broken.json();
        expect(answer.supported).toBe(false);
        expect(answer.message).not.toContain("dbackup.db");
    });

    it("answers the access check with what the database server said, and a fixed sentence otherwise", async () => {
        const body = { adapterId: "mysql", config: { host: "db.example.ch" } };
        mocks.getDatabases.mockRejectedValueOnce(new Error("Access denied for user 'shop'"));
        const refused = await accessCheckRoute.POST(post(body));
        expect(refused.status).toBe(500);
        expect((await refused.json()).message).toBe("Access denied for user 'shop'");

        ownFailure();
        const broken = await accessCheckRoute.POST(post(body));
        expect(broken.status).toBe(500);
        expect((await broken.json()).message).not.toContain("dbackup.db");
    });
});
