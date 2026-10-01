// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    ctx: null as null | { userId: string; permissions: string[] },
    readPublic: vi.fn(),
    read: vi.fn(),
    info: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    look: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => mocks.ctx),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new Error(`Missing ${permission}`);
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.audit(...args) } }));
vi.mock("@/services/system/system-settings-service", () => ({ getSignInSettings: () => mocks.look() }));
vi.mock("@/services/system/login-image-service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/system/login-image-service")>()),
    readPublicLoginImage: () => mocks.readPublic(),
    readLoginImage: () => mocks.read(),
    getLoginImageInfo: () => mocks.info(),
    saveLoginImage: (...args: unknown[]) => mocks.save(...args),
    removeLoginImage: () => mocks.remove(),
}));

const publicRoute = await import("@/app/api/login-image/route");
const settingsRoute = await import("@/app/api/settings/login-image/route");
const { ValidationError } = await import("@/lib/logging/errors");

const upload = (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return new NextRequest("http://localhost/api/settings/login-image", { method: "POST", body });
};

describe("the routes of the login picture", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ctx = { userId: "u1", permissions: ["settings:read", "settings:write"] };
    });

    it("serves the picture to everyone while it is picked, with its type and nothing to sniff", async () => {
        mocks.readPublic.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mimeType: "image/webp", updatedAt: new Date("2026-10-01T10:00:00.000Z") });

        const response = await publicRoute.GET(new NextRequest("http://localhost/api/login-image?v=1790000000000"));

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/webp");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
        // The address changes with the picture, so the browser asks for it once.
        expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
        expect((await publicRoute.GET(new NextRequest("http://localhost/api/login-image"))).headers.get("Cache-Control")).toBe("public, max-age=3600");
    });

    it("answers 404 while the login page shows the logos", async () => {
        mocks.readPublic.mockResolvedValue(null);

        expect((await publicRoute.GET(new NextRequest("http://localhost/api/login-image"))).status).toBe(404);
    });

    it("refuses an upload without a session and without the right to change the settings", async () => {
        mocks.ctx = null;
        expect((await settingsRoute.POST(upload(new File(["x"], "a.png")))).status).toBe(401);

        mocks.ctx = { userId: "u1", permissions: ["settings:read"] };
        await expect(settingsRoute.POST(upload(new File(["x"], "a.png")))).rejects.toThrow("settings:write");
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it("keeps a new picture and writes which file replaced which", async () => {
        mocks.info.mockResolvedValue({ fileName: "old.png" });
        mocks.save.mockResolvedValue({ fileName: "alps.jpg", mimeType: "image/jpeg", size: 3, updatedAt: "2026-10-01T10:00:00.000Z" });

        const response = await settingsRoute.POST(upload(new File([new Uint8Array([0xff, 0xd8, 0xff])], "alps.jpg")));

        expect(response.status).toBe(200);
        expect(mocks.audit).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "SYSTEM", { area: "Sign-in", changes: [{ field: "Login image", from: "old.png", to: "alps.jpg" }] });
    });

    it("says why a file is refused", async () => {
        mocks.info.mockResolvedValue(null);
        mocks.save.mockRejectedValue(new ValidationError("Only a PNG, JPG or WebP picture works here."));

        const response = await settingsRoute.POST(upload(new File(["<svg/>"], "logo.svg")));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ success: false, error: "Only a PNG, JPG or WebP picture works here." });
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("removes the picture and writes that the login page shows the logos again", async () => {
        mocks.info.mockResolvedValue({ fileName: "alps.jpg" });
        mocks.look.mockResolvedValue({ loginLook: "image" });

        await settingsRoute.DELETE();

        expect(mocks.remove).toHaveBeenCalled();
        expect(mocks.audit).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "SYSTEM", {
            area: "Sign-in",
            changes: [{ field: "Login image", from: "alps.jpg", to: null }, { field: "Login page", from: "Your own image", to: "DBackup logos" }],
        });
    });
});
