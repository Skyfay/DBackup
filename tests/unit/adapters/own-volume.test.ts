// @vitest-environment node
/**
 * Docker Volumes without SSH reach the Docker of the server DBackup runs on, and a member of the
 * home tenant may use such a connection in a job. No run reads the volume DBackup's own container
 * keeps its database, its certificates or its temporary files in, and a run that cannot tell which
 * container is its own reads no volume that way.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import type { ContainerDetail, VolumeInfo } from "@/lib/adapters/storage/docker/engine/types";

const mocks = vi.hoisted(() => ({
    hints: { inContainer: true, ids: [] as string[], hostname: "dbackup" },
    containers: vi.fn(),
    volume: vi.fn(),
    volumes: vi.fn(),
    close: vi.fn(async () => undefined),
}));

vi.mock("@/lib/adapters/storage/docker/engine/connect", () => ({
    connectDocker: () => ({
        engine: { listContainers: mocks.containers, inspectVolume: mocks.volume, listVolumes: mocks.volumes },
        close: mocks.close,
    }),
}));
vi.mock("@/lib/adapters/storage/docker/own-container", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/adapters/storage/docker/own-container")>()),
    ownContainerHints: async () => mocks.hints,
}));

const { ownVolumeRefusal, OWN_VOLUME_REFUSED, OWN_VOLUME_UNKNOWN } = await import("@/lib/adapters/own-data");
const { containerIdsIn, findOwnContainer } = await import("@/lib/adapters/storage/docker/own-container");

const OWN_ID = "a".repeat(64);
const OTHER_ID = "b".repeat(64);
const env = { url: process.env.DATABASE_URL, certs: process.env.CERTS_DIR, tmp: process.env.TMPDIR };

function container(id: string, mounts: ContainerDetail["mounts"]): ContainerDetail {
    return { id, name: id.slice(0, 6), running: true, labels: {}, image: "x", mounts };
}

/** DBackup with its database in a volume, its certificates in another and its temporary folder in a bind mount. */
const DBACKUP = container(OWN_ID, [
    { type: "volume", volume: "dbackup_data", destination: "/app/data" },
    { type: "volume", volume: "dbackup_certs", destination: "/app/data/certs" },
    { type: "bind", destination: "/tmp/dbackup" },
    { type: "volume", volume: "dbackup_cache", destination: "/app/cache" },
]);
/** Another app on the same host, with a volume at the same folder inside its own container. */
const SHOP = container(OTHER_ID, [{ type: "volume", volume: "shop_data", destination: "/app/data" }]);

beforeAll(() => {
    process.env.DATABASE_URL = "file:/app/data/dbackup.db";
    process.env.CERTS_DIR = "/app/data/certs";
    process.env.TMPDIR = "/tmp/dbackup";
});

afterAll(() => {
    for (const [key, value] of [["DATABASE_URL", env.url], ["CERTS_DIR", env.certs], ["TMPDIR", env.tmp]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.hints = { inContainer: true, ids: [OWN_ID], hostname: "dbackup" };
    mocks.containers.mockResolvedValue([SHOP, DBACKUP]);
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
});

describe("a Docker volume that holds DBackup's own data", () => {
    it("is refused when DBackup's own container keeps its database or its certificates in it", async () => {
        expect(await ownVolumeRefusal("docker-volume", { connectionMode: "direct" }, "dbackup_data")).toBe(OWN_VOLUME_REFUSED);
        expect(await ownVolumeRefusal("docker-volume", {}, "/dbackup_certs/")).toBe(OWN_VOLUME_REFUSED);
        expect(mocks.close).toHaveBeenCalled();
    });

    it("passes a volume of another container at the same folder and one of DBackup's container that holds none of it", async () => {
        expect(await ownVolumeRefusal("docker-volume", {}, "shop_data")).toBeNull();
        expect(await ownVolumeRefusal("docker-volume", {}, "dbackup_cache")).toBeNull();
    });

    it("finds DBackup's container by the short id Docker gives as the hostname", async () => {
        mocks.hints = { inContainer: true, ids: [], hostname: OWN_ID.slice(0, 12) };
        expect(await ownVolumeRefusal("docker-volume", {}, "dbackup_data")).toBe(OWN_VOLUME_REFUSED);
    });

    it("reads no volume in a container this Docker host does not list, since nothing says which is its own", async () => {
        mocks.hints = { inContainer: true, ids: ["c".repeat(64)], hostname: "dbackup" };
        expect(await ownVolumeRefusal("docker-volume", {}, "shop_data")).toBe(OWN_VOLUME_UNKNOWN);
    });

    it("reads no volume when Docker does not say which volumes DBackup's container holds", async () => {
        mocks.containers.mockRejectedValue(new Error("socket hang up"));
        expect(await ownVolumeRefusal("docker-volume", {}, "shop_data")).toMatch(/Docker did not answer/);
    });

    it("compares the folder of a volume on the server with the folders of DBackup when it runs in no container", async () => {
        mocks.hints = { inContainer: false, ids: [], hostname: "skydev" };
        const at = (mountpoint?: string): VolumeInfo => ({ name: "v", driver: "local", labels: {}, ...(mountpoint ? { mountpoint } : {}) });
        mocks.volume.mockResolvedValueOnce(at("/app/data")).mockResolvedValueOnce(at("/var/lib/docker/volumes/v/_data")).mockResolvedValueOnce(at());
        expect(await ownVolumeRefusal("docker-volume", {}, "v")).toBe(OWN_VOLUME_REFUSED);
        expect(await ownVolumeRefusal("docker-volume", {}, "v")).toBeNull();
        expect(await ownVolumeRefusal("docker-volume", {}, "v")).toBeNull();
    });

    it("leaves Docker over SSH and every other adapter to their own checks", async () => {
        expect(await ownVolumeRefusal("docker-volume", { connectionMode: "ssh" }, "dbackup_data")).toBeNull();
        expect(await ownVolumeRefusal("local-filesystem", { basePath: "/app/data" }, "dbackup_data")).toBeNull();
        expect(mocks.containers).not.toHaveBeenCalled();
    });
});

describe("the container DBackup runs in", () => {
    it("is read from the folders Docker and Podman mount its hostname from, and from its cgroup", () => {
        const mountinfo = [
            `612 590 0:52 /var/lib/docker/containers/${OWN_ID}/hostname /etc/hostname rw,relatime - ext4 /dev/sda1 rw`,
            `613 590 0:52 /var/lib/containers/storage/overlay-containers/${OTHER_ID}/userdata/hosts /etc/hosts rw - ext4 /dev/sda1 rw`,
        ].join("\n");
        expect(containerIdsIn(mountinfo)).toEqual([OWN_ID, OTHER_ID]);
        expect(containerIdsIn(`0::/system.slice/docker-${OWN_ID}.scope`)).toEqual([OWN_ID]);
        expect(containerIdsIn("0::/")).toEqual([]);
    });

    it("is never matched by a name, nor by a short id that fits two containers", () => {
        const twin = container(`${OWN_ID.slice(0, 12)}${"f".repeat(52)}`, []);
        expect(findOwnContainer([DBACKUP, SHOP], { inContainer: true, ids: [], hostname: DBACKUP.name })).toBeNull();
        expect(findOwnContainer([DBACKUP, twin], { inContainer: true, ids: [], hostname: OWN_ID.slice(0, 12) })).toBeNull();
        expect(findOwnContainer([SHOP, DBACKUP], { inContainer: true, ids: [OWN_ID], hostname: "x" })).toBe(DBACKUP);
    });
});
