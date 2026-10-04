/**
 * What a Docker host holds, as the volume picker of the job form shows it: every volume with the
 * containers that mount it, whether they run, where they mount it and the Compose project it
 * belongs to.
 *
 * A bare list of names is not enough to pick from. An anonymous volume is a 64 character hash,
 * and the only thing that says what it holds is the container that mounts it and where.
 */

import type { ContainerDetail, VolumeInfo } from "./engine/types";
import { withEngine } from "./with-engine";

/** The label Compose puts on the volumes and containers of a project. */
const PROJECT_LABEL = "com.docker.compose.project";

/** The name Docker gives a volume nobody named. */
const ANONYMOUS = /^[0-9a-f]{64}$/;

export interface DockerVolumeUser {
    container: string;
    running: boolean;
    image: string;
    /** Where the container mounts the volume. */
    mount: string;
}

export interface DockerVolumeEntry {
    name: string;
    anonymous: boolean;
    /** The Compose project, from the volume, or from the containers when all of them are of one. */
    stack: string | null;
    createdAt: string | null;
    users: DockerVolumeUser[];
}

export function buildVolumeInventory(volumes: readonly VolumeInfo[], containers: readonly ContainerDetail[]): DockerVolumeEntry[] {
    const users = new Map<string, DockerVolumeUser[]>();
    const projects = new Map<string, Set<string>>();
    for (const container of containers) {
        const project = container.labels[PROJECT_LABEL];
        for (const mount of container.mounts) {
            if (mount.type !== "volume" || !mount.volume) continue;
            const user = { container: container.name, running: container.running, image: container.image, mount: mount.destination };
            users.set(mount.volume, [...(users.get(mount.volume) ?? []), user]);
            if (project) projects.set(mount.volume, (projects.get(mount.volume) ?? new Set<string>()).add(project));
        }
    }

    return volumes
        .map((volume) => {
            // A volume made outside the project, like an external one or an anonymous one of a
            // service, still belongs to it when only that project mounts it.
            const theirs = [...(projects.get(volume.name) ?? [])];
            return {
                name: volume.name,
                anonymous: ANONYMOUS.test(volume.name),
                stack: volume.labels[PROJECT_LABEL] ?? (theirs.length === 1 ? theirs[0] : null),
                createdAt: volume.createdAt ?? null,
                users: (users.get(volume.name) ?? []).sort((a, b) => a.container.localeCompare(b.container)),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** The volumes of the host and the containers that mount them, in two calls to the daemon. */
export async function readVolumeInventory(config: Record<string, unknown>): Promise<DockerVolumeEntry[]> {
    return withEngine(
        config,
        async (engine) => {
            const volumes = await engine.listVolumes();
            return buildVolumeInventory(volumes, await engine.listContainers());
        },
        (message) => {
            throw new Error(message);
        },
    );
}

export async function readVolumeSizes(config: Record<string, unknown>): Promise<Record<string, number>> {
    return withEngine(
        config,
        async (engine) => Object.fromEntries(await engine.volumeSizes()),
        (message) => {
            throw new Error(message);
        },
    );
}
