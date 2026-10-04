/**
 * The volumes of a Docker connection for the picker of the job form, and how big they are.
 */

import prisma from "@/lib/prisma";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { readVolumeInventory, readVolumeSizes, type DockerVolumeEntry } from "@/lib/adapters/storage/docker/inventory";
import { NotFoundError } from "@/lib/logging/errors";

/** How long one measurement of the sizes serves every picker opened on the same connection. */
const SIZES_KEPT_MS = 10 * 60 * 1000;

const measured = new Map<string, { at: number; sizes: Promise<Record<string, number>> }>();

async function dockerConfig(configId: string): Promise<Record<string, unknown>> {
    const adapterConfig = await prisma.adapterConfig.findUnique({ where: { id: configId } });
    if (!adapterConfig || adapterConfig.type !== "storage" || adapterConfig.adapterId !== "docker-volume") {
        throw new NotFoundError("Docker connection", configId);
    }
    return (await resolveAdapterConfig(adapterConfig)) as Record<string, unknown>;
}

export async function listDockerVolumes(configId: string): Promise<DockerVolumeEntry[]> {
    return readVolumeInventory(await dockerConfig(configId));
}

/**
 * Answers with what `docker system df` said within the last ten minutes, since the daemon walks
 * every volume to measure them, which takes long and loads the disk on a big host. A request that
 * comes while a measurement runs waits for that one, and a failed one is not kept.
 */
export async function measureDockerVolumes(configId: string): Promise<Record<string, number>> {
    const kept = measured.get(configId);
    if (kept && Date.now() - kept.at < SIZES_KEPT_MS) return kept.sizes;

    const sizes = dockerConfig(configId).then(readVolumeSizes);
    measured.set(configId, { at: Date.now(), sizes });
    sizes.catch(() => {
        if (measured.get(configId)?.sizes === sizes) measured.delete(configId);
    });
    return sizes;
}
