// @vitest-environment node
/**
 * Routes that once checked `isPlatformAdmin` by hand go through `hasPermissionWithContext`, so a
 * platform admin in All tenants holds there what that view allows and nothing beside it, like
 * everywhere else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" };

const mocks = vi.hoisted(() => ({
    ctx: null as null | Ctx,
    history: vi.fn(),
    credential: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("@/lib/auth/access-control", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/auth/access-control")>()),
    getAuthContext: async () => mocks.ctx,
}));
vi.mock("@/services/system/db-version-service", () => ({ listVersionHistory: (...args: unknown[]) => mocks.history(...args) }));
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: (...args: unknown[]) => mocks.credential(...args) }));
vi.mock("googleapis", () => ({ google: {} }));
vi.mock("dropbox", () => ({ Dropbox: class {} }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const versionHistory = await import("@/app/api/adapters/[id]/version-history/route");
const dropbox = await import("@/app/api/adapters/dropbox/validate-token/route");
const onedrive = await import("@/app/api/adapters/onedrive/validate-token/route");
const googleDrive = await import("@/app/api/adapters/google-drive/validate-token/route");

const validate = (post: (req: NextRequest) => Promise<Response>) => post(new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify({ credentialId: "login-1" }) }));

const cases = [
    {
        name: "version-history",
        permission: PERMISSIONS.SOURCES.VIEW,
        send: () => versionHistory.GET(new NextRequest("http://localhost/api/adapters/db-1/version-history"), { params: Promise.resolve({ id: "db-1" }) }),
    },
    { name: "dropbox/validate-token", permission: PERMISSIONS.CREDENTIALS.READ, send: () => validate(dropbox.POST) },
    { name: "onedrive/validate-token", permission: PERMISSIONS.CREDENTIALS.READ, send: () => validate(onedrive.POST) },
    { name: "google-drive/validate-token", permission: PERMISSIONS.CREDENTIALS.READ, send: () => validate(googleDrive.POST) },
] as const;

const admin = (allTenants: boolean, ...permissions: string[]): Ctx => ({ userId: "root", tenantId: allTenants ? null : "t-acme", allTenants, isPlatformAdmin: true, permissions, authMethod: "session" });

describe.each(cases)("$name", ({ permission, send }) => {
    beforeEach(() => {
        mocks.history.mockResolvedValue([]);
        mocks.credential.mockRejectedValue(new Error("not reached"));
    });

    it("lets a platform admin in a tenant through", async () => {
        mocks.ctx = admin(false);
        expect((await send()).status).toBe(200);
    });

    it("holds a platform admin in All tenants to what that view allows", async () => {
        mocks.ctx = admin(true);
        expect((await send()).status).toBe(403);

        mocks.ctx = admin(true, permission);
        expect((await send()).status).toBe(200);
    });

    it("refuses someone without the permission", async () => {
        mocks.ctx = { ...admin(false), isPlatformAdmin: false };
        expect((await send()).status).toBe(403);
    });
});
