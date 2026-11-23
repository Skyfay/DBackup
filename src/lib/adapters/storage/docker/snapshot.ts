/**
 * Preparing a group of volumes for reading, and putting everything back afterwards.
 *
 * The order matters more than the steps do. Containers come down before the helper goes up
 * and go back up after it comes down, and every failure path in between has to leave the
 * user's services running - including the one where creating the helper fails after the
 * containers are already stopped.
 */

import type { SnapshotHandle, SnapshotOptions } from "@/lib/core/interfaces";
import type { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { startAll, stopRunning, type StoppedContainer } from "./containers";
import type { ContainerInfo, DockerEngine } from "./engine/types";
import { planVolumeGroups } from "./grouping";
import { ownContainerStopRefusal } from "./own-container-stop";
import { findOrphanedHelpers, releaseOrphanedHelper } from "./recovery";
import {
    SESSION_CONFIG_KEY,
    disposeSession,
    getSession,
    openConnection,
    registerSession,
} from "./session";
import { createHelper, removeHelper } from "./temp-container";
import { assertVolumeName } from "./volume-name";

const log = logger.child({ adapter: "docker-volume" });

const DEFAULT_HELPER_IMAGE = "alpine:latest";

type Log = (message: string, level?: "info" | "warning" | "error") => void;

/** What the runner hands in so the adapter can write into the run's own history. */
type ExecutionLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

/**
 * Says something into the run's history, and into the server log as well.
 *
 * Both, deliberately: the history is what an operator reads after the fact, the server log
 * is what someone debugging a broken host reads while it happens. Until the runner started
 * handing a callback in, this only had the second - so "your containers were left stopped by
 * an earlier run" and "this backup is only crash-consistent" reached nobody who needed them.
 */
function sayVia(onLog?: ExecutionLog): Log {
    return (message, level) => {
        if (level === "error") log.error(message);
        else if (level === "warning") log.warn(message);
        else log.info(message);
        onLog?.(message, level ?? "info", "storage");
    };
}

/**
 * Answers without a round trip, deliberately.
 *
 * For a share this asks a real question - the VSS service can be stopped, a permission can
 * be revoked, and the answer decides whether an option may be switched on at all. For a
 * container runtime there is no such thing as a daemon that runs but cannot mount a volume,
 * so the only question is whether the daemon is reachable, which the preparation finds out
 * one moment later and reports far better than a boolean can.
 *
 * It matters because the runner calls this once per group, and each call would otherwise be
 * its own connection - which over SSH is its own handshake.
 */
export async function supportsDockerSnapshot(): Promise<{ supported: boolean; message: string }> {
    return { supported: true, message: "Docker volumes are always read through a helper container." };
}

/** Volume names grouped so no container is stopped twice, over a connection of its own. */
export async function planDockerSourceGroups(
    config: Record<string, unknown>,
    volumes: string[]
): Promise<string[][]> {
    // Before Docker hears them, whose filter matches folders as well as volumes.
    volumes.forEach(assertVolumeName);
    const connection = openConnection(config);
    try {
        return await planVolumeGroups(connection.engine, volumes);
    } finally {
        await connection.close().catch(() => { });
    }
}

export async function createDockerSnapshot(
    config: Record<string, unknown>,
    volumes: string[],
    options?: SnapshotOptions
): Promise<SnapshotHandle> {
    // A source that is no volume name would mount a folder of the Docker host, see `volume-name.ts`.
    volumes.forEach(assertVolumeName);
    const say = sayVia(options?.onLog);
    // Info, not a warning: falling back to the Docker CLI is a working setup, not a problem,
    // and warning on every run of one trains people to ignore warnings. If the CLI is missing
    // on the target, that failure is loud on its own.
    const connection = openConnection(config, (message) => say(message));
    const engine = connection.engine;
    const helperImage = typeof config.helperImage === "string" && config.helperImage.length > 0
        ? config.helperImage
        : DEFAULT_HELPER_IMAGE;

    let stopped: StoppedContainer[] = [];
    try {
        await clearOrphans(engine, say);

        // Every container holding any of the group's volumes. Deduplicated because that is
        // the point of the grouping - a container holding two of them appears twice here.
        const holders = await containersHolding(engine, volumes);

        if (options?.stopContainers === false) {
            if (holders.some((c) => c.running)) {
                say(
                    `Reading ${volumes.join(", ")} while its container(s) keep running, because this source is set not to stop them. `
                    + `The backup is crash-consistent, not clean.`,
                    "warning"
                );
            }
        } else if (holders.length === 0) {
            // Worth saying rather than staying silent: nothing was stopped because nothing
            // was holding it, which reads very differently from nothing being stopped
            // because the option was off.
            say(`No container is using ${volumes.join(", ")}, so nothing had to be stopped`);
        } else {
            // Never DBackup's own container, whose stop would end this run and leave it down.
            const refusal = await ownContainerStopRefusal(engine, config, holders, "backup");
            if (refusal) throw new Error(`${volumes.join(", ")}: ${refusal}`);
            stopped = await stopRunning(engine, holders, say);
        }

        const containerId = await createHelper(engine, volumes, helperImage, sessionLabel(volumes), stopped);
        say(`Reading through helper container '${short(containerId)}' (${helperImage})`);

        // Costs a few percent of the export it describes, and buys a real "x of y" instead
        // of a number ticking up against nothing. Null when the helper could not be run,
        // which is a nicety lost rather than a backup failed.
        const entryCounts = await engine.countEntriesPerVolume(containerId);
        if (!entryCounts) {
            say(
                `Could not count the files in ${volumes.join(", ")} beforehand, so progress will show a running count without a total. `
                + `The backup itself is unaffected.`,
                "warning"
            );
        }

        const session = registerSession(
            { engine, containerId, stoppedContainers: stopped, volumes, entryCounts },
            connection
        );

        return {
            id: containerId,
            configOverride: { [SESSION_CONFIG_KEY]: session.id },
            // Kept short because the runner puts its own noun in front of it.
            label: `'${short(containerId)}'`,
            noun: "helper container",
        };
    } catch (e: unknown) {
        // Anything already stopped comes back before the failure leaves this function. The
        // helper does not exist yet on this path, so there is nothing else to undo.
        await startAll(engine, stopped, say);
        await connection.close().catch(() => { });
        throw e;
    }
}

/**
 * Removes the helper and starts the containers again.
 *
 * Tolerates a handle whose session is gone, which is both required by the interface and the
 * shape every orphaned helper arrives in: the run that created it is no longer around, so
 * the state has to be read back off the container's own labels.
 */
export async function releaseDockerSnapshot(
    config: Record<string, unknown>,
    handle: SnapshotHandle,
    onLog?: ExecutionLog
): Promise<void> {
    const say = sayVia(onLog);
    const sessionId = handle.configOverride?.[SESSION_CONFIG_KEY];
    const session = typeof sessionId === "string" ? getSession(sessionId) : undefined;

    if (session && typeof sessionId === "string") {
        try {
            // Helper first, then the containers: the helper holds nothing anyone is waiting
            // for, while a container left down is the failure that matters.
            await removeHelper(session.engine, session.containerId)
                .then(() => say(`Removed helper container '${short(session.containerId)}'`))
                .catch((e: unknown) => {
                    say(`Could not remove the helper container: ${describe(e)}. It will be cleaned up by the next run.`, "warning");
                });
            await startAll(session.engine, session.stoppedContainers, say);
        } finally {
            await disposeSession(sessionId as string);
        }
        return;
    }

    // No live session: an orphan, or a release attempted twice. Both are handled by reading
    // the state off the host rather than trusting anything in memory.
    const connection = openConnection(config, (message) => say(message));
    try {
        const orphans = await findOrphanedHelpers(connection.engine);
        const match = orphans.find((o) => o.containerId === handle.id);
        if (!match) return;
        await releaseOrphanedHelper(connection.engine, match, say);
    } finally {
        await connection.close().catch(() => { });
    }
}

/**
 * Deliberately not exposed as `findOrphanedSnapshots` on the adapter.
 *
 * The runner offers that hook so leftovers can be cleared before a new snapshot is taken,
 * and it calls it once per group over a connection of its own. For Docker the sweep needs
 * the same connection the preparation is about to open anyway, and has to happen at exactly
 * that moment - so it lives inside `createDockerSnapshot` instead. Declaring the hook as
 * well would mean a second connection per group doing the same work twice.
 *
 * Kept exported for the tests, which have to be able to ask what is lying around without
 * preparing anything.
 */
export async function findOrphanedDockerSnapshots(
    config: Record<string, unknown>
): Promise<SnapshotHandle[]> {
    const connection = openConnection(config);
    try {
        const orphans = await findOrphanedHelpers(connection.engine);
        return orphans.map((orphan) => ({
            id: orphan.containerId,
            configOverride: {},
            label: orphan.label,
        }));
    } finally {
        await connection.close().catch(() => { });
    }
}

/**
 * Clears leftovers before creating anything.
 *
 * Done inside the preparation as well as through `findOrphanedSnapshots`, because the
 * containers a dead run left stopped should come back at the first opportunity rather than
 * only when the runner happens to ask. Failing here does not fail the backup: a leftover
 * helper is harmless, and the containers it recorded are reported either way.
 */
async function clearOrphans(engine: DockerEngine, say: Log): Promise<void> {
    const orphans = await findOrphanedHelpers(engine).catch(() => []);
    for (const orphan of orphans) {
        await releaseOrphanedHelper(engine, orphan, say).catch((e: unknown) => {
            say(`Could not clean up ${orphan.label}: ${describe(e)}`, "warning");
        });
    }
}

/** Container ids read as a person would: the short form Docker itself prints. */
function short(id: string): string {
    return id.slice(0, 12);
}

async function containersHolding(engine: DockerEngine, volumes: readonly string[]): Promise<ContainerInfo[]> {
    const byId = new Map<string, ContainerInfo>();
    for (const volume of volumes) {
        for (const container of await engine.containersUsingVolume(volume)) {
            byId.set(container.id, container);
        }
    }
    return [...byId.values()];
}

/** Read only by a human looking at `docker ps`, so it says what the helper is for. */
function sessionLabel(volumes: readonly string[]): string {
    return volumes.join(",");
}

function describe(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
