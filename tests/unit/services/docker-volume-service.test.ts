import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    config: null as null | { id: string; type: string; adapterId: string },
    readVolumeInventory: vi.fn(),
    readVolumeSizes: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: { adapterConfig: { findUnique: vi.fn(async () => mocks.config) } } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn(async () => ({ socketPath: "/var/run/docker.sock" })) }));
vi.mock("@/lib/adapters/storage/docker/inventory", () => ({ readVolumeInventory: mocks.readVolumeInventory, readVolumeSizes: mocks.readVolumeSizes }));

const { listDockerVolumes, measureDockerVolumes } = await import("@/services/storage/docker-volume-service");

let host = 0;

describe("the volumes of a Docker connection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Every test gets a connection of its own, so the kept sizes of one never answer another.
        host += 1;
        mocks.config = { id: `docker-${host}`, type: "storage", adapterId: "docker-volume" };
        mocks.readVolumeSizes.mockResolvedValue({ immich_pgdata: 1_800_000_000 });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("lists them for a Docker connection, and no other kind", async () => {
        mocks.readVolumeInventory.mockResolvedValue([{ name: "immich_pgdata" }]);
        expect(await listDockerVolumes(mocks.config!.id)).toEqual([{ name: "immich_pgdata" }]);
        expect(mocks.readVolumeInventory).toHaveBeenCalledWith({ socketPath: "/var/run/docker.sock" });

        mocks.config = { id: "nas", type: "storage", adapterId: "sftp" };
        await expect(listDockerVolumes("nas")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("measures once for every picker opened within ten minutes, and again after", async () => {
        vi.useFakeTimers();
        const id = mocks.config!.id;

        const [first, second] = await Promise.all([measureDockerVolumes(id), measureDockerVolumes(id)]);
        await measureDockerVolumes(id);
        expect(first).toEqual({ immich_pgdata: 1_800_000_000 });
        expect(second).toBe(first);
        expect(mocks.readVolumeSizes).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(10 * 60 * 1000 + 1);
        await measureDockerVolumes(id);
        expect(mocks.readVolumeSizes).toHaveBeenCalledTimes(2);
    });

    it("does not keep a measurement that failed", async () => {
        const id = mocks.config!.id;
        mocks.readVolumeSizes.mockRejectedValueOnce(new Error("The Docker socket was not found"));

        await expect(measureDockerVolumes(id)).rejects.toThrow("The Docker socket was not found");
        expect(await measureDockerVolumes(id)).toEqual({ immich_pgdata: 1_800_000_000 });
        expect(mocks.readVolumeSizes).toHaveBeenCalledTimes(2);
    });
});
