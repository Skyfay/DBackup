// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    ctx: null as null | { userId: string },
    user: null as null | { id: string; name: string; image: string | null },
    find: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => mocks.ctx),
    getCurrentUserWithGroup: vi.fn(async () => mocks.user),
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));
vi.mock("@/services/user/avatar-service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/user/avatar-service")>()),
    findAvatar: (...args: unknown[]) => mocks.find(...args),
    saveAvatar: (...args: unknown[]) => mocks.save(...args),
    removeAvatar: (...args: unknown[]) => mocks.remove(...args),
}));

const pictureRoute = await import("@/app/api/avatar/[userId]/route");
const ownRoute = await import("@/app/api/user/avatar/route");
const { ValidationError } = await import("@/lib/logging/errors");

const params = (userId: string) => ({ params: Promise.resolve({ userId }) });
const upload = (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return new NextRequest("http://localhost/api/user/avatar", { method: "POST", body });
};

describe("the routes of the pictures of the people", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ctx = { userId: "u2" };
        mocks.user = { id: "u1", name: "Manu", image: null };
    });

    it("shows a picture to anyone signed in, kept for good with its time and with nothing to sniff", async () => {
        mocks.find.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mimeType: "image/gif" });

        const response = await pictureRoute.GET(new NextRequest("http://localhost/api/avatar/u1?v=1790000000000"), params("u1"));

        expect(response.status).toBe(200);
        expect(mocks.find).toHaveBeenCalledWith("u1");
        expect(response.headers.get("Content-Type")).toBe("image/gif");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
        expect((await pictureRoute.GET(new NextRequest("http://localhost/api/avatar/u1"), params("u1"))).headers.get("Cache-Control")).toBe("private, max-age=3600");
    });

    it("shows no picture without a sign-in, and answers 404 for a person without one", async () => {
        mocks.find.mockResolvedValue(null);
        expect((await pictureRoute.GET(new NextRequest("http://localhost/api/avatar/u9"), params("u9"))).status).toBe(404);

        mocks.ctx = null;
        expect((await pictureRoute.GET(new NextRequest("http://localhost/api/avatar/u1"), params("u1"))).status).toBe(401);
    });

    it("keeps a new picture of the signed-in person alone and writes it to the audit log", async () => {
        mocks.save.mockResolvedValue("/api/avatar/u1?v=1790000000000");

        const response = await ownRoute.POST(upload(new File([new Uint8Array([0xff, 0xd8, 0xff])], "me.jpg", { type: "image/jpeg" })));

        expect(await response.json()).toEqual({ success: true, data: { url: "/api/avatar/u1?v=1790000000000" } });
        expect(mocks.save).toHaveBeenCalledWith("u1", expect.any(Uint8Array));
        expect(mocks.audit).toHaveBeenCalledWith("u1", "UPDATE", "USER", { name: "Manu", changes: [{ field: "Picture", from: null, to: "A new picture" }] }, "u1");
    });

    it("says why a file is refused, and refuses one larger than 5 MB before reading it", async () => {
        mocks.save.mockRejectedValue(new ValidationError("Only a PNG, JPG, GIF or WebP picture works here."));
        const refused = await ownRoute.POST(upload(new File(["<svg/>"], "me.png", { type: "image/png" })));
        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({ success: false, error: "Only a PNG, JPG, GIF or WebP picture works here." });

        mocks.save.mockClear();
        const huge = await ownRoute.POST(upload(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png")));
        expect(huge.status).toBe(400);
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it("removes the own picture, and changes nothing without a sign-in or a picture", async () => {
        mocks.user = { id: "u1", name: "Manu", image: "/api/avatar/u1?v=1" };
        expect((await ownRoute.DELETE()).status).toBe(200);
        expect(mocks.remove).toHaveBeenCalledWith("u1");
        expect(mocks.audit).toHaveBeenCalledWith("u1", "UPDATE", "USER", { name: "Manu", changes: [{ field: "Picture", from: "A picture", to: null }] }, "u1");

        vi.clearAllMocks();
        mocks.user = { id: "u1", name: "Manu", image: null };
        await ownRoute.DELETE();
        expect(mocks.remove).not.toHaveBeenCalled();

        mocks.user = null;
        expect((await ownRoute.DELETE()).status).toBe(401);
        expect((await ownRoute.POST(upload(new File(["x"], "me.png")))).status).toBe(401);
    });
});
