// @vitest-environment node
/**
 * A test of a connection runs a config against a host, so it goes into the audit log once it ran,
 * naming the saved connection, the same as the other things someone runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";

const mocks = vi.hoisted(() => ({
    testConnection: vi.fn(),
    connectionName: vi.fn(),
    logFor: vi.fn(),
    permissions: [] as string[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/auth/access-control", async () => {
    const { PermissionError } = await import("@/lib/logging/errors");
    return {
        getAuthContext: async () => ({ userId: "ada", tenantId: "default", allTenants: false, isPlatformAdmin: false, permissions: mocks.permissions, authMethod: "session" }),
        checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
            if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
        },
        hasPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => ctx.permissions.includes(permission),
        tenantOf: (ctx: { tenantId: string }) => ctx.tenantId,
    };
});
vi.mock("@/services/config/config-backup-targets", () => ({ getConfigBackupTargets: async () => ({ storageId: null, profileId: null, credentialIds: [] }) }));
vi.mock("@/services/adapters/connection-test", () => ({ testConnection: (...args: unknown[]) => mocks.testConnection(...args) }));
vi.mock("@/services/adapters/adapter-audit", () => ({ connectionName: (...args: unknown[]) => mocks.connectionName(...args) }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.logFor(...args) } }));

const { POST } = await import("@/app/api/adapters/test-connection/route");

const test = (body: unknown) => POST(new NextRequest("http://localhost/api/adapters/test-connection", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

describe("the audit entry of a connection test", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.permissions = [PERMISSIONS.SOURCES.WRITE, PERMISSIONS.SOURCES.READ];
        mocks.connectionName.mockResolvedValue("Shop MySQL");
        mocks.testConnection.mockResolvedValue({ ok: true, result: { success: false, message: "Access denied for user 'shop'" } });
    });

    it("names the saved connection it tested and whether the server answered", async () => {
        const response = await test({ adapterId: "mysql", config: { host: "db" }, configId: "shop-mysql" });

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "ada" }),
            "EXECUTE",
            "ADAPTER",
            { action: "connection_test", name: "Shop MySQL", adapter: "mysql", success: false },
            "shop-mysql"
        );
    });

    it("notes the test of a form that is no saved connection yet", async () => {
        mocks.testConnection.mockResolvedValue({ ok: true, result: { success: true, message: "Connected" } });

        await test({ adapterId: "mysql", config: { host: "db" } });

        expect(mocks.logFor).toHaveBeenCalledWith(expect.anything(), "EXECUTE", "ADAPTER", { action: "connection_test", adapter: "mysql", success: true }, undefined);
    });

    it("notes nothing for a test that was refused or never ran", async () => {
        mocks.permissions = [PERMISSIONS.SOURCES.READ];
        expect((await test({ adapterId: "mysql", config: { host: "db" } })).status).toBe(403);

        mocks.permissions = [PERMISSIONS.SOURCES.WRITE];
        mocks.testConnection.mockResolvedValue({ ok: false, reason: "unsupported" });
        await test({ adapterId: "mysql", config: { host: "db" } });

        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("answers a failure inside with a fixed sentence", async () => {
        mocks.testConnection.mockRejectedValue(new Error("ENOENT /usr/bin/mysql at /srv/dbackup"));

        const response = await test({ adapterId: "mysql", config: { host: "db" } });

        expect(response.status).toBe(500);
        expect(JSON.stringify(await response.json())).not.toContain("/srv/dbackup");
    });
});
