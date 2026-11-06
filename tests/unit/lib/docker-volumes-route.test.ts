import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NotFoundError, PermissionError } from "@/lib/logging/errors";
import { assertSourceFolder } from "@/lib/archive/remote-paths";

const mocks = vi.hoisted(() => ({
    signedIn: true,
    permissions: [] as string[],
    list: vi.fn(),
    measure: vi.fn(),
    reachesHost: false,
    browse: vi.fn(),
    logFor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => (mocks.signedIn ? { userId: "u1", permissions: mocks.permissions, isPlatformAdmin: false } : null),
    checkPermissionWithContext: (_ctx: unknown, permission: string) => {
        if (!mocks.permissions.includes(permission)) throw new PermissionError(permission);
    },
    checkAnyPermissionWithContext: (_ctx: unknown, permissions: string[]) => {
        if (!permissions.some((permission) => mocks.permissions.includes(permission))) throw new PermissionError(permissions.join(" or "));
    },
}));
// Whether the connection reaches the server DBackup runs on, like Docker Volumes without SSH.
vi.mock("@/services/adapters/location-browse-service", () => ({
    HOST_FOLDER_PICKERS: ["jobs:write", "storage:restore"],
    savedConnectionReachesHost: async () => mocks.reachesHost,
    browseSavedFolders: mocks.browse,
}));
vi.mock("@/services/adapters/adapter-list", () => ({
    getSavedConnection: async (id: string) => ({ id, name: `Connection ${id}`, adapterId: "local-filesystem", type: "storage" }),
}));
vi.mock("@/services/storage/docker-volume-service", () => ({ listDockerVolumes: mocks.list, measureDockerVolumes: mocks.measure }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor } }));
vi.mock("@/services/adapters/adapter-audit", () => ({ connectionName: async (id: string) => (id === "docker-1" ? "Immich host" : null) }));
// The tenant of each connection, which the entry of a look at it goes to, also from All tenants.
vi.mock("@/services/audit/record-names", () => ({
    connectionPlace: async (id: string) => ({ name: id, tenantId: id === "docker-1" ? "globex" : "default" }),
    credentialPlace: async () => null,
}));
vi.mock("@/lib/adapters/dialed-hosts", () => ({ dialedHosts: () => [], hostOf: () => null }));

const volumes = await import("@/app/api/adapters/[id]/volumes/route");
const sizes = await import("@/app/api/adapters/[id]/volumes/sizes/route");
const browse = await import("@/app/api/adapters/[id]/browse/route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (path: string) => new NextRequest(`http://dbackup.test/api/adapters/${path}`);

describe("the volumes of a Docker connection over the API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.signedIn = true;
        mocks.permissions = ["destinations:read"];
        mocks.reachesHost = false;
    });

    it("lists the volumes and folders of the server DBackup runs on only for whoever picks them in a job or a restore", async () => {
        mocks.reachesHost = true;
        mocks.list.mockResolvedValue([]);
        mocks.measure.mockResolvedValue({});
        mocks.browse.mockResolvedValue([{ name: "srv", path: "srv" }]);

        expect((await volumes.GET(request("docker-1/volumes"), params("docker-1"))).status).toBe(403);
        expect((await sizes.GET(request("docker-1/volumes/sizes"), params("docker-1"))).status).toBe(403);
        expect((await browse.GET(request("local-1/browse?path="), params("local-1"))).status).toBe(403);
        expect(mocks.list).not.toHaveBeenCalled();
        expect(mocks.browse).not.toHaveBeenCalled();

        for (const picker of ["jobs:write", "storage:restore"]) {
            mocks.permissions = ["destinations:read", picker];
            expect((await volumes.GET(request("docker-1/volumes"), params("docker-1"))).status, picker).toBe(200);
            expect((await browse.GET(request("local-1/browse?path="), params("local-1"))).status, picker).toBe(200);
        }
    });

    it("lists the folders of a connection to a server of its own for whoever may see the connections", async () => {
        mocks.browse.mockResolvedValue([]);
        expect((await browse.GET(request("sftp-1/browse?path="), params("sftp-1"))).status).toBe(200);
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

    it("notes every read of a saved connection in the audit log once it ran, with its name, never its config", async () => {
        mocks.list.mockResolvedValue([]);
        mocks.measure.mockRejectedValue(new Error("the daemon did not answer"));
        mocks.browse.mockResolvedValue([]);

        await volumes.GET(request("docker-1/volumes"), params("docker-1"));
        await sizes.GET(request("docker-1/volumes/sizes"), params("docker-1"));
        await browse.GET(request("sftp-1/browse?path=srv"), params("sftp-1"));

        const ctx = expect.objectContaining({ userId: "u1" });
        expect(mocks.logFor.mock.calls).toEqual([
            [ctx, "EXECUTE", "ADAPTER", { action: "volume_list", name: "Immich host", adapter: "docker-volume", success: true }, "docker-1", { tenantId: "globex" }],
            [ctx, "EXECUTE", "ADAPTER", { action: "volume_sizes", name: "Immich host", adapter: "docker-volume", success: false }, "docker-1", { tenantId: "globex" }],
            [ctx, "EXECUTE", "ADAPTER", { action: "folder_browse", name: "Connection sftp-1", adapter: "local-filesystem", success: true }, "sftp-1", { tenantId: "default" }],
        ]);
    });

    it("answers 400 to a path that climbs above the folder of the connection, and writes no entry for it", async () => {
        // The guard of the service, which refuses the path before the adapter lists anything.
        mocks.browse.mockImplementation(async (_source: unknown, path: string) => {
            assertSourceFolder(path);
            return [];
        });

        const response = await browse.GET(request(`sftp-1/browse?path=${encodeURIComponent("../..")}`), params("sftp-1"));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("leaves the folder of its connection");
        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("writes nothing for a connection that is not found or a read that is refused", async () => {
        mocks.list.mockRejectedValue(new NotFoundError("Docker connection", "nas"));
        expect((await volumes.GET(request("nas/volumes"), params("nas"))).status).toBe(404);
        mocks.permissions = [];
        expect((await sizes.GET(request("docker-1/volumes/sizes"), params("docker-1"))).status).toBe(403);
        expect(mocks.logFor).not.toHaveBeenCalled();
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

    it("answers a fixed sentence when the daemon could not answer, the detail goes to the log", async () => {
        mocks.list.mockRejectedValue(new Error("connect ENOENT /var/run/docker.sock"));

        const response = await volumes.GET(request("docker-1/volumes"), params("docker-1"));

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ success: false, error: "The Docker volumes could not be listed. The log of DBackup has the details." });
    });
});
