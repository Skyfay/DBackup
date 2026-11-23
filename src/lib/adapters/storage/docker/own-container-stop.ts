import { hostLocalReason } from "@/lib/adapters/host-local";
import type { ContainerInfo, DockerEngine } from "./engine/types";
import { findOwnContainer, ownContainerHints } from "./own-container";

/**
 * Whether a run may stop the containers that hold some volumes. Never the container DBackup runs
 * in: the stop ends the run that asked for it, before it starts anything again, and Docker does not
 * bring back a container stopped through its API, so DBackup would stay down for every tenant. A
 * connection without SSH reaches the Docker of the server DBackup runs on, so its own container is
 * looked for there, by its id, see `own-container.ts`. In a container this Docker host does not
 * list, nothing says a stop leaves DBackup alone, so nothing is stopped, like `ownVolumeRefusal`
 * refuses the volume then.
 */

/** What a run does instead, by what it was going to stop the containers for. */
export type StopPurpose = "backup" | "restore";

const OWN_HOLDS: Record<StopPurpose, string> = {
    backup: "DBackup's own container holds this volume, and a run never stops the container DBackup runs in. Turn off Stop containers for this source to read it while it runs.",
    restore: "DBackup's own container holds this volume, and a restore would have to stop the container DBackup runs in. Restore into another volume.",
};

const OWN_UNKNOWN: Record<StopPurpose, string> = {
    backup: "DBackup runs in a container this Docker host does not list, so it cannot tell whether stopping the containers of this volume would stop DBackup itself, and stops none. Turn off Stop containers for this source, or connect to the Docker host over SSH.",
    restore: "DBackup runs in a container this Docker host does not list, so it cannot tell whether stopping the containers of this volume would stop DBackup itself, and stops none. Connect to the Docker host over SSH instead.",
};

/** Why the running ones of `holders` may not be stopped, as the sentence that refuses it, or null when they may. */
export async function ownContainerStopRefusal(
    engine: DockerEngine,
    config: Record<string, unknown>,
    holders: readonly ContainerInfo[],
    purpose: StopPurpose,
): Promise<string | null> {
    // Docker over SSH reaches another server, where DBackup does not run.
    if (!hostLocalReason("docker-volume", config)) return null;
    const running = holders.filter((container) => container.running);
    if (running.length === 0) return null;
    const hints = await ownContainerHints();
    if (!hints.inContainer) return null;
    const own = findOwnContainer(await engine.listContainers(), hints);
    if (!own) return OWN_UNKNOWN[purpose];
    return running.some((container) => container.id === own.id) ? OWN_HOLDS[purpose] : null;
}
