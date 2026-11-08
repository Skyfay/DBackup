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

/** The Docker connection of the id, read through the tenant filter, so one of another tenant is not found. */
async function dockerConnection(configId: string) {
    const adapterConfig = await prisma.adapterConfig.findUnique({ where: { id: configId } });
    if (!adapterConfig || adapterConfig.type !== "storage" || adapterConfig.adapterId !== "docker-volume") {
        throw new NotFoundError("Docker connection", configId);
    }
    return adapterConfig;
}

/** The config of the connection with its secrets, for the daemon. */
async function configOf(connection: Awaited<ReturnType<typeof dockerConnection>>): Promise<Record<string, unknown>> {
    return (await resolveAdapterConfig(connection)) as Record<string, unknown>;
}

export async function listDockerVolumes(configId: string): Promise<DockerVolumeEntry[]> {
    return readVolumeInventory(await configOf(await dockerConnection(configId)));
}

/**
 * Answers with what `docker system df` said within the last ten minutes, since the daemon walks
 * every volume to measure them, which takes long and loads the disk on a big host. A request that
 * comes while a measurement runs waits for that one, and a failed one is not kept.
 *
 * The kept sizes are one map for the whole process, keyed by the connection, so the connection is
 * read through the tenant filter before they answer.
 */
export async function measureDockerVolumes(configId: string): Promise<Record<string, number>> {
    const connection = await dockerConnection(configId);
    const kept = measured.get(configId);
    if (kept && Date.now() - kept.at < SIZES_KEPT_MS) return kept.sizes;

    const sizes = configOf(connection).then(readVolumeSizes);
    measured.set(configId, { at: Date.now(), sizes });
    sizes.catch(() => {
        if (measured.get(configId)?.sizes === sizes) measured.delete(configId);
    });
    return sizes;
}
