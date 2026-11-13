/**
 * The guards in front of trusting and forgetting the pinned SSH host key of a connection, in the
 * Server Actions of the connection form and in `/api/adapters/[id]/ssh-host-key`: the write right
 * of the kind of the connection, one tenant and never All tenants, and the destination of the
 * configuration backup for a platform admin alone. A refused request touches no service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";

const FINGERPRINT = "SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/AbCdE";

const mocks = vi.hoisted(() => ({
    viewer: null as null | { id: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[] },
    ctx: null as null | Record<string, unknown>,
    type: "storage" as string | null,
    locked: null as string | null,
    accept: vi.fn(),
    forget: vi.fn(),
}));

const holds = (who: { isPlatformAdmin: boolean; allTenants: boolean; permissions: string[] }, permission: string) =>
    (who.isPlatformAdmin && !who.allTenants) || who.permissions.includes(permission);

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (wanted: string | readonly string[]) => {
        const list = typeof wanted === "string" ? [wanted] : wanted;
        if (!mocks.viewer || !list.some((permission) => holds(mocks.viewer!, permission))) throw new PermissionError(list.join(" or "));
        return mocks.viewer;
    }),
    hasPermissionWithContext: holds,
    tenantRefusal: (ctx: { tenantId: string | null; allTenants?: boolean }) => (ctx.tenantId ? null : "All tenants only reads. Open the tenant of the record to change it."),
    getAuthContext: vi.fn(async () => mocks.ctx),
    checkPermissionWithContext: (ctx: { isPlatformAdmin: boolean; allTenants: boolean; permissions: string[] }, permission: string) => {
        if (!holds(ctx, permission)) throw new PermissionError(permission);
    },
    tenantOf: (ctx: { tenantId: string | null }) => {
        if (!ctx.tenantId) throw new PermissionError("a tenant", { message: "All tenants only reads. Open the tenant of the record to change it." });
        return ctx.tenantId;
    },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/services/adapters/adapter-list", () => ({ getAdapterType: vi.fn(async () => mocks.type) }));
vi.mock("@/lib/server/config-backup-target-guard", () => ({
    configBackupTargetRefusal: vi.fn(async () => mocks.locked),
    configBackupTargetResponse: vi.fn(async () => (mocks.locked ? Response.json({ success: false, error: mocks.locked }, { status: 403 }) : null)),
}));
vi.mock("@/services/adapters/ssh-host-key-accept", () => ({
    FINGERPRINT_PATTERN: /^SHA256:[A-Za-z0-9+/]{43}$/,
    acceptHostKey: mocks.accept,
    forgetHostKey: mocks.forget,
}));

const actions = await import("@/app/actions/adapter/ssh-host-key");
const route = await import("@/app/api/adapters/[id]/ssh-host-key/route");

const person = (permissions: string[], extra: Partial<NonNullable<typeof mocks.viewer>> = {}) =>
    ({ id: "u-lena", tenantId: "acme", allTenants: false, isPlatformAdmin: false, permissions, ...extra });

const post = (body: unknown) => route.POST(
    new NextRequest("http://dbackup.test/api/adapters/conn-1/ssh-host-key", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "conn-1" }) },
);
const del = () => route.DELETE(
    new NextRequest("http://dbackup.test/api/adapters/conn-1/ssh-host-key", { method: "DELETE" }),
    { params: Promise.resolve({ id: "conn-1" }) },
);

beforeEach(() => {
    vi.clearAllMocks();
    mocks.type = "storage";
    mocks.locked = null;
    mocks.viewer = person([PERMISSIONS.DESTINATIONS.WRITE]);
    mocks.ctx = { ...person([PERMISSIONS.DESTINATIONS.WRITE]), userId: "u-lena", authMethod: "session", apiKeyId: null };
    mocks.accept.mockResolvedValue({ name: "Offsite", type: "storage", previous: null, fingerprint: FINGERPRINT });
    mocks.forget.mockResolvedValue({ name: "Offsite", type: "storage", previous: FINGERPRINT, fingerprint: null });
});

describe("the actions of the connection form about the pinned host key", () => {
    it("trust and forget for someone who may change connections of that kind", async () => {
        await expect(actions.trustSshHostKey("conn-1", FINGERPRINT)).resolves.toMatchObject({ success: true, data: { fingerprint: FINGERPRINT } });
        await expect(actions.forgetSshHostKey("conn-1")).resolves.toMatchObject({ success: true });
        expect(mocks.accept).toHaveBeenCalledWith("conn-1", FINGERPRINT, { userId: "u-lena" });
        expect(mocks.forget).toHaveBeenCalledWith("conn-1", { userId: "u-lena" });
    });

    it("refuse someone who may only read connections", async () => {
        mocks.viewer = person([PERMISSIONS.DESTINATIONS.READ, PERMISSIONS.SOURCES.READ]);
        await expect(actions.trustSshHostKey("conn-1", FINGERPRINT)).rejects.toBeInstanceOf(PermissionError);
        await expect(actions.forgetSshHostKey("conn-1")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.accept).not.toHaveBeenCalled();
        expect(mocks.forget).not.toHaveBeenCalled();
    });

    it("refuse a destination to someone who may only change sources, like a connection that does not exist", async () => {
        mocks.viewer = person([PERMISSIONS.SOURCES.WRITE]);
        const refused = await actions.trustSshHostKey("conn-1", FINGERPRINT);
        mocks.type = null;
        const missing = await actions.forgetSshHostKey("conn-1");

        expect(refused.success).toBe(false);
        expect(missing).toEqual(refused);
        expect(mocks.accept).not.toHaveBeenCalled();
        expect(mocks.forget).not.toHaveBeenCalled();
    });

    it("change nothing in All tenants", async () => {
        mocks.viewer = person([PERMISSIONS.DESTINATIONS.WRITE], { tenantId: null, allTenants: true });
        await expect(actions.trustSshHostKey("conn-1", FINGERPRINT)).resolves.toMatchObject({ success: false, error: expect.stringContaining("All tenants") });
        expect(mocks.accept).not.toHaveBeenCalled();
    });

    it("leave the destination of the configuration backup to a platform admin", async () => {
        mocks.locked = "Only a platform admin changes the destination of the configuration backup.";
        await expect(actions.trustSshHostKey("conn-1", FINGERPRINT)).resolves.toEqual({ success: false, error: mocks.locked });
        await expect(actions.forgetSshHostKey("conn-1")).resolves.toEqual({ success: false, error: mocks.locked });
        expect(mocks.accept).not.toHaveBeenCalled();
        expect(mocks.forget).not.toHaveBeenCalled();
    });

    it("refuse anything that is no fingerprint before a service reads it", async () => {
        await expect(actions.trustSshHostKey("conn-1", "trust-anything")).resolves.toEqual({ success: false, error: "Invalid request" });
        expect(mocks.accept).not.toHaveBeenCalled();
    });
});

describe("the route of the pinned host key", () => {
    it("trusts and forgets for a caller with the write right, naming the API key of the request", async () => {
        mocks.ctx = { ...mocks.ctx, authMethod: "apikey", apiKeyId: "key-1" };
        expect((await post({ fingerprint: FINGERPRINT })).status).toBe(200);
        expect((await del()).status).toBe(200);
        expect(mocks.accept).toHaveBeenCalledWith("conn-1", FINGERPRINT, { userId: "u-lena", apiKeyId: "key-1" });
        expect(mocks.forget).toHaveBeenCalledWith("conn-1", { userId: "u-lena", apiKeyId: "key-1" });
    });

    it("answers 401 without a session or key", async () => {
        mocks.ctx = null;
        expect((await post({ fingerprint: FINGERPRINT })).status).toBe(401);
        expect((await del()).status).toBe(401);
    });

    it("answers a connection the caller may not see like a missing one", async () => {
        mocks.ctx = { ...mocks.ctx, permissions: [PERMISSIONS.SOURCES.WRITE] };
        expect((await post({ fingerprint: FINGERPRINT })).status).toBe(404);
        expect((await del()).status).toBe(404);
        expect(mocks.accept).not.toHaveBeenCalled();
    });

    it("answers 403 to a caller who may only read, in All tenants and for the destination of the configuration backup", async () => {
        mocks.ctx = { ...mocks.ctx, permissions: [PERMISSIONS.DESTINATIONS.READ] };
        expect((await post({ fingerprint: FINGERPRINT })).status).toBe(403);

        mocks.ctx = { ...mocks.ctx, permissions: [PERMISSIONS.DESTINATIONS.WRITE], tenantId: null, allTenants: true };
        expect((await del()).status).toBe(403);

        mocks.ctx = { ...mocks.ctx, tenantId: "acme", allTenants: false };
        mocks.locked = "Only a platform admin changes the destination of the configuration backup.";
        expect((await post({ fingerprint: FINGERPRINT })).status).toBe(403);
        expect((await del()).status).toBe(403);

        expect(mocks.accept).not.toHaveBeenCalled();
        expect(mocks.forget).not.toHaveBeenCalled();
    });

    it("answers 400 to a body without a fingerprint", async () => {
        expect((await post({ fingerprint: "anything" })).status).toBe(400);
        expect(mocks.accept).not.toHaveBeenCalled();
    });
});
