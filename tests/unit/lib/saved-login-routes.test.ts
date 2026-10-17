// @vitest-environment node
/**
 * The form-driven connection endpoints take a config whose host the caller picks beside the id of a
 * saved login, which they decrypt for that host. A caller who may only see connections must not get
 * a login sent to a server of their choosing, and All tenants, which reads the logins of every
 * tenant, applies none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" };

const mocks = vi.hoisted(() => ({
    ctx: null as null | Ctx,
    overlay: vi.fn(),
    testConnection: vi.fn(),
    listRemote: vi.fn(),
    registryGet: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => {
    const has = (ctx: Ctx, permission: string) => (ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission);
    const check = (ctx: Ctx, permission: string) => {
        if (!has(ctx, permission)) throw new PermissionError(permission);
    };
    return {
        getAuthContext: async () => mocks.ctx,
        hasPermissionWithContext: has,
        checkPermissionWithContext: check,
        checkPermission: async (permission: string) => {
            check(mocks.ctx!, permission);
            return mocks.ctx;
        },
        tenantOf: (ctx: Ctx) => {
            if (!ctx.tenantId) throw new PermissionError("a tenant");
            return ctx.tenantId;
        },
    };
});
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: (...args: unknown[]) => mocks.registryGet(...args) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    overlayCredentialsOnConfig: (...args: unknown[]) => mocks.overlay(...args),
    applyStoredSecrets: vi.fn(async (_adapterId: string, _id: string, config: unknown) => config),
}));
vi.mock("@/lib/transport", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/transport")>()),
    withHost: async (_adapter: unknown, _config: unknown, fn: (host: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock("@/services/adapters/connection-test", () => ({ testConnection: (...args: unknown[]) => mocks.testConnection(...args) }));
vi.mock("@/services/system/filesystem-service", () => ({ listRemoteDirectory: (...args: unknown[]) => mocks.listRemote(...args) }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const testConnectionRoute = await import("@/app/api/adapters/test-connection/route");
const accessCheckRoute = await import("@/app/api/adapters/access-check/route");
const checkSnapshotRoute = await import("@/app/api/adapters/check-snapshot/route");
const testSshRoute = await import("@/app/api/adapters/test-ssh/route");
const remoteRoute = await import("@/app/api/system/filesystem/remote/route");

const post = (body: unknown) => new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const someone = (...permissions: string[]): Ctx => ({ userId: "lena", tenantId: "t-acme", allTenants: false, isPlatformAdmin: false, permissions, authMethod: "session" });
const allTenants = (): Ctx => ({ userId: "root", tenantId: null, allTenants: true, isPlatformAdmin: true, permissions: [PERMISSIONS.SOURCES.VIEW, PERMISSIONS.DESTINATIONS.READ, PERMISSIONS.SETTINGS.READ, PERMISSIONS.CREDENTIALS.READ], authMethod: "session" });

/** Every endpoint with a request that names a saved login and the rights it reads and changes. */
const cases = [
    {
        name: "test-connection",
        send: () => testConnectionRoute.POST(post({ adapterId: "mysql", config: { host: "evil.example" }, primaryCredentialId: "login-1" })),
        applied: () => mocks.testConnection,
        read: PERMISSIONS.SOURCES.VIEW,
        manage: PERMISSIONS.SOURCES.WRITE,
    },
    {
        name: "access-check",
        send: () => accessCheckRoute.POST(post({ adapterId: "mysql", config: { host: "evil.example" }, primaryCredentialId: "login-1" })),
        applied: () => mocks.overlay,
        read: PERMISSIONS.SOURCES.VIEW,
        manage: PERMISSIONS.SOURCES.WRITE,
    },
    {
        name: "check-snapshot",
        send: () => checkSnapshotRoute.POST(post({ adapterId: "smb", config: { address: "//evil.example/share" }, primaryCredentialId: "login-1" })),
        applied: () => mocks.overlay,
        read: PERMISSIONS.DESTINATIONS.READ,
        manage: PERMISSIONS.DESTINATIONS.WRITE,
    },
    {
        name: "test-ssh",
        send: () => testSshRoute.POST(post({ adapterId: "mysql", config: { connectionMode: "ssh", sshHost: "evil.example" }, sshCredentialId: "login-1" })),
        applied: () => mocks.overlay,
        read: PERMISSIONS.SOURCES.VIEW,
        manage: PERMISSIONS.SOURCES.WRITE,
    },
    {
        name: "filesystem/remote",
        send: () => remoteRoute.POST(post({ adapterId: "mysql", config: { host: "evil.example" }, path: "/", sshCredentialId: "login-1" })),
        applied: () => mocks.listRemote,
        read: PERMISSIONS.SETTINGS.READ,
        manage: PERMISSIONS.SOURCES.WRITE,
    },
] as const;

describe.each(cases)("POST $name with a saved login", ({ send, applied, read, manage }) => {
    beforeEach(() => {
        mocks.overlay.mockImplementation(async (_adapterId: string, config: unknown) => config);
        mocks.testConnection.mockResolvedValue({ ok: true, result: { success: true, message: "ok" } });
        mocks.listRemote.mockResolvedValue({ path: "/", entries: [] });
        mocks.registryGet.mockReturnValue({ id: "adapter", getDatabases: vi.fn(async () => ["shop"]), supportsSnapshot: vi.fn(async () => ({ supported: true })) });
    });

    it("refuses it to someone who may only see the connections, and applies nothing", async () => {
        // test-ssh checks the right to see sources itself, the snapshot check that of destinations.
        mocks.ctx = someone(read, PERMISSIONS.SOURCES.VIEW);

        const response = await send();

        expect(response.status).toBe(403);
        expect(applied()).not.toHaveBeenCalled();
    });

    it("applies it for someone who may change that kind of connection", async () => {
        mocks.ctx = someone(read, manage, PERMISSIONS.SOURCES.VIEW);

        const response = await send();

        expect(response.status).not.toBe(403);
        expect(applied()).toHaveBeenCalled();
    });

    it("applies it for someone who may reveal the saved logins anyway", async () => {
        mocks.ctx = someone(read, PERMISSIONS.CREDENTIALS.REVEAL, PERMISSIONS.SOURCES.VIEW);

        expect((await send()).status).not.toBe(403);
        expect(applied()).toHaveBeenCalled();
    });

    it("refuses it in All tenants, which reads the saved logins of every tenant", async () => {
        mocks.ctx = allTenants();

        expect((await send()).status).toBe(403);
        expect(applied()).not.toHaveBeenCalled();
    });
});

describe("a config without a saved login", () => {
    it("is still tested with the right to see the connections alone", async () => {
        mocks.ctx = someone(PERMISSIONS.SOURCES.VIEW);
        mocks.testConnection.mockResolvedValue({ ok: true, result: { success: true, message: "ok" } });

        const response = await testConnectionRoute.POST(post({ adapterId: "mysql", config: { host: "db.example" } }));

        expect(response.status).toBe(200);
        expect(mocks.testConnection).toHaveBeenCalledWith(expect.objectContaining({ storedConfigId: undefined }));
    });
});
