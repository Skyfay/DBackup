import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NotFoundError, PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    signedIn: true,
    permissions: [] as string[],
    list: vi.fn(),
    measure: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => (mocks.signedIn ? { userId: "u1", permissions: mocks.permissions, isSuperAdmin: false } : null),
    checkPermissionWithContext: (_ctx: unknown, permission: string) => {
        if (!mocks.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/storage/docker-volume-service", () => ({ listDockerVolumes: mocks.list, measureDockerVolumes: mocks.measure }));

const volumes = await import("@/app/api/adapters/[id]/volumes/route");
const sizes = await import("@/app/api/adapters/[id]/volumes/sizes/route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (path: string) => new NextRequest(`http://dbackup.test/api/adapters/${path}`);

describe("the volumes of a Docker connection over the API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.signedIn = true;
        mocks.permissions = ["destinations:read"];
    });

    it("lists the volumes with their containers, and measures them apart", async () => {
        mocks.list.mockResolvedValue([{ name: "immich_pgdata", anonymous: false, stack: "immich", createdAt: null, users: [] }]);
        mocks.measure.mockResolvedValue({ immich_pgdata: 1_800_000_000 });

        const listed = await volumes.GET(request("docker-1/volumes"), params("docker-1"));
        expect(await listed.json()).toEqual({ success: true, data: { volumes: [{ name: "immich_pgdata", anonymous: false, stack: "immich", createdAt: null, users: [] }] } });
        expect(mocks.list).toHaveBeenCalledWith("docker-1");

        const measured = await sizes.GET(request("docker-1/volumes/sizes"), params("docker-1"));
        expect(await measured.json()).toEqual({ success: true, data: { sizes: { immich_pgdata: 1_800_000_000 } } });
    });

    it("turns away a visitor, a user without the read permission and a connection of another kind", async () => {
        mocks.signedIn = false;
        expect((await volumes.GET(request("docker-1/volumes"), params("docker-1"))).status).toBe(401);

        mocks.signedIn = true;
        mocks.permissions = [];
        expect((await volumes.GET(request("docker-1/volumes"), params("docker-1"))).status).toBe(403);
        expect((await sizes.GET(request("docker-1/volumes/sizes"), params("docker-1"))).status).toBe(403);
        expect(mocks.list).not.toHaveBeenCalled();

        mocks.permissions = ["destinations:read"];
        mocks.list.mockRejectedValue(new NotFoundError("Docker connection", "nas"));
        expect((await volumes.GET(request("nas/volumes"), params("nas"))).status).toBe(404);
    });

    it("says why the daemon could not answer", async () => {
        mocks.list.mockRejectedValue(new Error("The Docker socket was not found"));

        const response = await volumes.GET(request("docker-1/volumes"), params("docker-1"));

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ success: false, error: "The Docker socket was not found" });
    });
});
