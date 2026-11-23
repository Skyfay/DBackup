/**
 * Restoring into a Docker volume.
 *
 * A file arrives as a local path plus the permissions and owner the backup recorded. It goes
 * back as a one-entry tar handed to the container archive endpoint, which applies those from
 * the tar headers - verified before this was designed around, because a restored data
 * directory with the wrong owner is one no database will start on.
 *
 * The tar is always built here rather than passed through from anywhere. A tar produced by a
 * host tool can carry extended attributes the daemon cannot apply, and it fails the whole
 * call over a single one - macOS `bsdtar` stamps `com.apple.provenance` onto every file,
 * which is exactly how that was found.
 */

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pack } from "tar-stream";

import type { UploadOptions } from "@/lib/core/interfaces";
import { startAll, stopRunning, type StoppedContainer } from "./containers";
import type { DockerEngine } from "./engine/types";
import { ownContainerStopRefusal } from "./own-container-stop";
import { mountPathFor } from "./temp-container";
import { volumeNameProblem } from "./volume-name";

type Log = (message: string, level?: "info" | "warning" | "error") => void;

/**
 * A path inside a restore target, split into the volume and the path within it.
 *
 * The restore joins the target the user picked with the path from the archive, and for this
 * adapter the target is the volume name - so the first component is the volume and the rest
 * is where the file goes inside it.
 */
export interface VolumePath {
    volume: string;
    inner: string;
}

export function splitVolumePath(remotePath: string): VolumePath {
    const normalized = remotePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const slash = normalized.indexOf("/");
    if (slash <= 0 || slash === normalized.length - 1) {
        throw new Error(
            `'${remotePath}' does not name a file inside a volume. A Docker restore target is a volume name, `
            + `and the archive's own path is appended to it.`
        );
    }
    const volume = normalized.slice(0, slash);
    // The same rule as a backup, so a restore never mounts a folder of the Docker host either.
    const problem = volumeNameProblem(volume);
    if (problem) throw new Error(problem);
    return { volume, inner: normalized.slice(slash + 1) };
}

/**
 * Everything that has to happen once per target volume, before its first file.
 *
 * Ordered so a failure never leaves a service down for nothing: the image is checked before
 * anything is stopped, and the volume is only emptied once there is a helper able to refill
 * it. Emptying is what "overwrite" means here - leaving the old contents in place would
 * merge two states, and for a database that is not a restore but a corruption.
 */
export interface PreparedVolume {
    containerId: string;
    stoppedContainers: StoppedContainer[];
}

export async function prepareVolumeForRestore(
    engine: DockerEngine,
    config: Record<string, unknown>,
    volume: string,
    helperImage: string,
    log: Log,
): Promise<PreparedVolume> {
    // Before anything is stopped. An image that cannot be had is a restore that was never
    // going to work, and finding that out after the containers are down is the worst order.
    await engine.ensureImage(helperImage);

    const existing = await engine.inspectVolume(volume);
    const holders = await engine.containersUsingVolume(volume);
    // Never DBackup's own container, whose stop would end the restore and leave it down.
    const refusal = await ownContainerStopRefusal(engine, config, holders, "restore");
    if (refusal) throw new Error(`${volume}: ${refusal}`);
    // Not optional the way it is for a backup: writing into a volume a container is reading
    // is how a half-restored database happens.
    const stoppedContainers = await stopRunning(engine, holders, log);

    try {
        if (!existing) {
            await engine.createVolume(volume);
            log(`Created volume '${volume}'`);
        } else {
            log(`Emptying volume '${volume}' before restoring into it`, "warning");
            await engine.emptyVolume(volume, helperImage);
        }

        const containerId = await engine.createMountContainer([volume], helperImage, {});
        return { containerId, stoppedContainers };
    } catch (e: unknown) {
        await startAll(engine, stoppedContainers, log);
        throw e;
    }
}

/** Removes the helper and starts whatever was stopped for this volume. */
export async function finishVolumeRestore(
    engine: DockerEngine,
    prepared: PreparedVolume,
    log: Log,
): Promise<void> {
    await engine.removeMountContainer(prepared.containerId).catch(() => { });
    await startAll(engine, prepared.stoppedContainers, log);
}

/** Writes one file into a prepared volume, with the metadata the backup recorded. */
export async function writeFile(
    engine: DockerEngine,
    containerId: string,
    volume: string,
    inner: string,
    localPath: string,
    options?: UploadOptions,
): Promise<void> {
    const { size } = await fs.stat(localPath);
    const tar = pack();
    const entry = tar.entry({
        name: inner,
        size,
        // The permission bits alone, never setuid, setgid or sticky, whoever passed the mode,
        // see `metadataFromIndex`, which also keeps the owners to the volume the backup read.
        ...(options?.mode !== undefined ? { mode: options.mode & 0o777 } : {}),
        ...(options?.uid !== undefined ? { uid: options.uid } : {}),
        ...(options?.gid !== undefined ? { gid: options.gid } : {}),
    });

    // Buffered through a PassThrough so the tar is a plain readable by the time the request
    // body starts, rather than a stream still being written into as it is consumed.
    const body = new PassThrough();
    tar.pipe(body);
    const written = pipeline(createReadStream(localPath), entry).then(() => tar.finalize());

    await Promise.all([
        engine.importPath(containerId, mountPathFor(volume), body),
        written,
    ]);
}
