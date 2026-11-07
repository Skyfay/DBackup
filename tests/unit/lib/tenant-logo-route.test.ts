// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    ctx: null as null | { userId: string; isPlatformAdmin: boolean; authMethod: "session" | "apikey"; tenantId: string | null; allTenants: boolean; permissions: string[] },
    audit: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => mocks.ctx,
    checkPermissionWithContext: (ctx: { isPlatformAdmin: boolean; allTenants: boolean; permissions: string[] }, permission: string) => {
        if (!((ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission))) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.audit } }));

const { mayViewTenantLogo, saveTenantLogo } = await import("@/services/tenant/tenant-logo-service");
const route = await import("@/app/api/tenants/[id]/logo/route");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => route.GET(new NextRequest(`http://localhost/api/tenants/${id}/logo?v=1`), params(id));
const upload = (id: string, bytes: Uint8Array) => {
    const body = new FormData();
    body.append("file", new File([Buffer.from(bytes)], "logo.png", { type: "image/png" }));
    return route.POST(new NextRequest(`http://localhost/api/tenants/${id}/logo`, { method: "POST", body }), params(id));
};

const member = (tenantId: string | null, ...permissions: string[]) => ({ userId: "lena", isPlatformAdmin: false, authMethod: "session" as const, tenantId, allTenants: false, permissions });

describe("who sees the logo of a tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.tenantLogo.findUnique.mockResolvedValue({ data: Buffer.from(PNG), mimeType: "image/png" } as never);
    });

    it("shows it to the people of the tenant, also while they work in another of their tenants", async () => {
        expect(await mayViewTenantLogo(member("t-acme"), "t-acme")).toBe(true);

        prismaMock.tenantMembership.findUnique.mockResolvedValue({ tenantId: "t-acme" } as never);
        expect(await mayViewTenantLogo(member("t-shop"), "t-acme")).toBe(true);
    });

    it("shows it to someone whose platform group reaches the tenant, like their switcher lists it", async () => {
        prismaMock.tenantMembership.findUnique.mockResolvedValue(null);
        const support = { platformGroup: { allTenants: false, tenants: [{ tenantId: "t-acme" }] } };
        prismaMock.user.findUnique.mockResolvedValueOnce(support as never).mockResolvedValueOnce(support as never);
        expect(await mayViewTenantLogo(member("t-shop"), "t-acme")).toBe(true);
        expect(await mayViewTenantLogo(member("t-shop"), "t-praxis")).toBe(false);
    });

    it("shows it to a platform admin, who sees every tenant", async () => {
        expect(await mayViewTenantLogo({ ...member(null), isPlatformAdmin: true }, "t-acme")).toBe(true);
        expect(prismaMock.tenantMembership.findUnique).not.toHaveBeenCalled();
    });

    it("never shows it to someone of another tenant or to a key of another tenant", async () => {
        prismaMock.tenantMembership.findUnique.mockResolvedValue(null);
        expect(await mayViewTenantLogo(member("t-shop"), "t-acme")).toBe(false);
        expect(await mayViewTenantLogo({ ...member("t-shop"), authMethod: "apikey" }, "t-acme")).toBe(false);
    });

    it("answers someone outside the tenant like a tenant without a logo", async () => {
        mocks.ctx = member("t-shop");
        prismaMock.tenantMembership.findUnique.mockResolvedValue(null);

        expect((await get("t-acme")).status).toBe(404);
        expect(prismaMock.tenantLogo.findUnique).not.toHaveBeenCalled();
    });

    it("serves the logo with the type read from its bytes to a member, and nothing without a sign-in", async () => {
        mocks.ctx = member("t-acme");
        const response = await get("t-acme");
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/png");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");

        mocks.ctx = null;
        expect((await get("t-acme")).status).toBe(401);
    });

    it("serves no stored type but the four pictures an upload is kept as", async () => {
        mocks.ctx = member("t-acme");
        for (const mimeType of ["image/svg+xml", "text/html", "application/octet-stream"]) {
            prismaMock.tenantLogo.findUnique.mockResolvedValue({ data: Buffer.from(SVG), mimeType } as never);
            expect((await get("t-acme")).status).toBe(404);
        }
        for (const mimeType of ["image/jpeg", "image/gif", "image/webp"]) {
            prismaMock.tenantLogo.findUnique.mockResolvedValue({ data: Buffer.from(PNG), mimeType } as never);
            expect((await get("t-acme")).headers.get("Content-Type")).toBe(mimeType);
        }
    });
});

describe("who changes the logo of a tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.tenant.findUnique.mockResolvedValue({ id: "t-acme", name: "Acme", logo: null } as never);
        prismaMock.tenantLogo.upsert.mockResolvedValue({ updatedAt: new Date("2026-10-15T10:00:00.000Z") } as never);
    });

    it("lets someone who may change the tenant settings upload one for the tenant they work in, written to its audit log", async () => {
        mocks.ctx = member("t-acme", PERMISSIONS.TENANT_SETTINGS.WRITE);

        const response = await upload("t-acme", PNG);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { url: "/api/tenants/t-acme/logo?v=1792058400000" } });
        expect(mocks.audit).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "TENANT", expect.objectContaining({ area: "Tenant settings" }), "t-acme");
    });

    it("refuses without the right to change the tenant settings, and for another tenant than the one worked in", async () => {
        mocks.ctx = member("t-acme", PERMISSIONS.TENANT_SETTINGS.READ);
        expect((await upload("t-acme", PNG)).status).toBe(403);

        mocks.ctx = member("t-shop", PERMISSIONS.TENANT_SETTINGS.WRITE);
        expect((await upload("t-acme", PNG)).status).toBe(403);
        expect((await route.DELETE(new NextRequest("http://localhost/api/tenants/t-acme/logo", { method: "DELETE" }), params("t-acme"))).status).toBe(403);

        // All tenants changes no tenant, not even for a platform admin.
        mocks.ctx = { ...member(null), isPlatformAdmin: true, allTenants: true };
        expect((await upload("t-acme", PNG)).status).toBe(403);
        expect(prismaMock.tenantLogo.upsert).not.toHaveBeenCalled();
    });

    it("refuses a body clearly above the limit before it reads the form", async () => {
        mocks.ctx = member("t-acme", PERMISSIONS.TENANT_SETTINGS.WRITE);
        const formData = vi.fn();
        const huge = { headers: new Headers({ "content-length": String(50 * 1024 * 1024) }), formData } as unknown as NextRequest;

        const response = await route.POST(huge, params("t-acme"));

        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({ success: false, error: "The logo is larger than 1 MB." });
        expect(formData).not.toHaveBeenCalled();
    });

    it("refuses an SVG and anything that is no picture by its bytes, whatever the file claims", async () => {
        mocks.ctx = member("t-acme", PERMISSIONS.TENANT_SETTINGS.WRITE);

        const refused = await upload("t-acme", SVG);
        expect(refused.status).toBe(400);
        expect((await refused.json()).error).toMatch(/PNG, JPG, GIF or WebP/);
        await expect(saveTenantLogo("t-acme", new Uint8Array())).rejects.toThrow(/empty/);
        await expect(saveTenantLogo("t-acme", new Uint8Array(1024 * 1024 + 1).fill(1))).rejects.toThrow(/larger than 1 MB/);
        expect(prismaMock.tenantLogo.upsert).not.toHaveBeenCalled();
    });
});
