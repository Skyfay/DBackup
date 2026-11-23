/**
 * The file browser of the server DBackup runs on serves a path field of a Local Filesystem or a
 * local SQLite connection, which a platform admin with a session adds alone. It needed only
 * `settings:read` in the home tenant before, so a member listed the folders of the server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AuthenticationError, PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), list: vi.fn() }));

vi.mock("@/lib/auth/access-control", () => ({
    checkPlatformAdmin: () => mocks.viewer(),
}));
vi.mock("@/services/system/filesystem-service", () => ({
    BlockedPathError: class BlockedPathError extends Error {},
    listLocalDirectory: (...args: unknown[]) => mocks.list(...args),
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { GET } = await import("@/app/api/system/filesystem/route");

const request = () => new NextRequest("http://localhost/api/system/filesystem?path=/data");

describe("the file browser of the server DBackup runs on", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.list.mockResolvedValue({ currentPath: "/data", parentPath: "/", entries: [] });
    });

    it("lists a folder for a platform admin in the home tenant", async () => {
        mocks.viewer.mockResolvedValue({ isPlatformAdmin: true, tenantId: "default" });

        const res = await GET(request());

        expect(res.status).toBe(200);
        expect(mocks.list).toHaveBeenCalledWith("/data");
    });

    it("lists nothing for a member of the home tenant, an API key or a session outside it", async () => {
        mocks.viewer.mockRejectedValue(new PermissionError("platform admin"));
        expect((await GET(request())).status).toBe(403);

        mocks.viewer.mockRejectedValue(new AuthenticationError());
        expect((await GET(request())).status).toBe(401);

        mocks.viewer.mockResolvedValue({ isPlatformAdmin: true, tenantId: "acme" });
        expect((await GET(request())).status).toBe(403);
        expect(mocks.list).not.toHaveBeenCalled();
    });
});
