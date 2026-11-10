/**
 * A Docker Volumes source reads named volumes and nothing else. Docker reads a mount source that
 * starts with `/` as a folder of its host, so a job source like `/etc` once bind-mounted that folder
 * into the helper and packed it into the backup, as root. The name is refused before it reaches
 * Docker, and the helper gets typed volume mounts, never string binds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Duplex } from "node:stream";
import { createFakeDockerEngine, type FakeDockerEngine } from "@/lib/testing/fake-docker-engine";

const dockerode = vi.hoisted(() => ({
    createContainer: vi.fn(),
    listContainers: vi.fn(),
}));

vi.mock("dockerode", () => ({
    default: class {
        modem = {};
        createContainer = dockerode.createContainer;
        listContainers = dockerode.listContainers;
    },
}));

const connectDocker = vi.fn();
vi.mock("@/lib/adapters/storage/docker/engine/connect", () => ({
    connectDocker: (config: unknown) => connectDocker(config),
    DEFAULT_SOCKET_PATH: "/var/run/docker.sock",
}));
vi.mock("@/lib/adapters/storage/docker/own-container", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/adapters/storage/docker/own-container")>()),
    ownContainerHints: async () => ({ inContainer: false, ids: [], hostname: "skydev" }),
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { volumeSourceProblem, volumeNameProblem } = await import("@/lib/adapters/storage/docker/volume-name");
const { createDockerodeEngine } = await import("@/lib/adapters/storage/docker/engine/dockerode-engine");
const { createDockerSnapshot, planDockerSourceGroups } = await import("@/lib/adapters/storage/docker/snapshot");
const { splitVolumePath } = await import("@/lib/adapters/storage/docker/write");

const HOST_PATHS = ["/etc", "/var/lib/docker/volumes/dbackup-data/_data", "/", "", "etc/shadow", "a:b", "C:\\data", ".hidden", "x", "-v"];
const VOLUMES = ["dbackup-data", "pg_data.1", "Immich", "a".repeat(64)];

function engine() {
    return createDockerodeEngine({ connect: async () => new Duplex({ read() { }, write(_c, _e, done) { done(); } }), label: "test" });
}

function useEngine(fake: FakeDockerEngine) {
    connectDocker.mockImplementation(() => ({ engine: fake, close: async () => { await fake.close(); } }));
    return fake;
}

beforeEach(() => {
    vi.clearAllMocks();
    dockerode.createContainer.mockResolvedValue({ id: "helper-1", start: vi.fn(), wait: vi.fn(async () => ({ StatusCode: 0 })), remove: vi.fn(async () => undefined) });
    dockerode.listContainers.mockResolvedValue([]);
});

describe("the path of a Docker Volumes source", () => {
    it.each(HOST_PATHS)("refuses %j, which is no single volume", (path) => {
        expect(volumeSourceProblem(path)).not.toBeNull();
    });

    it.each(VOLUMES)("takes the volume %s", (path) => {
        expect(volumeSourceProblem(path)).toBeNull();
    });
});

describe("the helper container", () => {
    it("mounts each volume of the group as a typed volume, never as a string bind", async () => {
        await engine().createMountContainer(["dbackup-data", "pg_data"], "alpine:3", {});

        const body = dockerode.createContainer.mock.calls[0][0];
        expect(body.HostConfig.Binds).toBeUndefined();
        expect(body.HostConfig.Mounts).toEqual([
            { Type: "volume", Source: "dbackup-data", Target: "/vol/dbackup-data" },
            { Type: "volume", Source: "pg_data", Target: "/vol/pg_data" },
        ]);
    });

    it.each(["/etc", "/var/lib/docker/volumes/x/_data", "a:b"])("is never created for %s, which Docker reads as a folder of its host", async (name) => {
        await expect(engine().createMountContainer(["dbackup-data", name], "alpine:3", {})).rejects.toThrow("is no Docker volume name");
        expect(dockerode.createContainer).not.toHaveBeenCalled();
    });

    it("empties a volume through a typed volume mount", async () => {
        await engine().emptyVolume("dbackup-data", "alpine:3");

        expect(dockerode.createContainer.mock.calls[0][0].HostConfig).toEqual({ Mounts: [{ Type: "volume", Source: "dbackup-data", Target: "/vol" }] });
        await expect(engine().emptyVolume("/etc", "alpine:3")).rejects.toThrow("is no Docker volume name");
        expect(dockerode.createContainer).toHaveBeenCalledTimes(1);
    });

    it("asks no container list for a folder, which the volume filter would match by its destination", async () => {
        await expect(engine().containersUsingVolume("/data")).rejects.toThrow("is no Docker volume name");
        expect(dockerode.listContainers).not.toHaveBeenCalled();
    });
});

describe("a backup of a path that is no volume", () => {
    it("mounts nothing and stops nothing", async () => {
        const fake = useEngine(createFakeDockerEngine({ containers: [{ id: "web", name: "web", running: true, volumes: ["/etc"] }] }));

        await expect(createDockerSnapshot({ connectionMode: "direct" }, ["/etc"], { stopContainers: true })).rejects.toThrow("is no Docker volume name");
        await expect(planDockerSourceGroups({ connectionMode: "direct" }, ["dbackup-data", "/etc"])).rejects.toThrow("is no Docker volume name");
        expect(fake.calls.created).toEqual([]);
        expect(fake.calls.stopped).toEqual([]);
    });
});

describe("a restore into a path that is no volume", () => {
    it("follows the same rule for the volume part", () => {
        expect(() => splitVolumePath("a:b/file.txt")).toThrow("is no Docker volume name");
        expect(() => splitVolumePath(".x/file.txt")).toThrow("is no Docker volume name");
        expect(splitVolumePath("/dbackup-data/file.txt")).toEqual({ volume: "dbackup-data", inner: "file.txt" });
        expect(volumeNameProblem("dbackup-data")).toBeNull();
    });
});
