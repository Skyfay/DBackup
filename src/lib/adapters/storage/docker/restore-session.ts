/**
 * One connection and one helper per target volume, for the length of a restore.
 *
 * The restore writes files one at a time through `upload()`, and each target volume needs a
 * container to write into, its holders stopped, and - for an overwrite - its old contents
 * gone. Doing that per file would stop the containers over and over and empty the volume
 * between every write, which is not a restore but a way to end up with one file.
 *
 * Prepared lazily and memoised per volume, because the restore resolves its targets up front
 * but reaches them through a concurrency pool: two files of the same volume can start at the
 * same moment, and only one of them may do the preparing.
 */

import type { StorageSession, UploadOptions } from "@/lib/core/interfaces";
import type { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { connectDocker, type DockerConnection } from "./engine/connect";
import {
    finishVolumeRestore,
    prepareVolumeForRestore,
    splitVolumePath,
    writeFile,
    type PreparedVolume,
} from "./write";

const log = logger.child({ adapter: "docker-volume" });

const DEFAULT_HELPER_IMAGE = "alpine:latest";

type OnLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

export type DockerRestoreSession = StorageSession;

/**
 * Never throws, and connects nothing.
 *
 * `createDestinationSessions` treats a failed `openSession` as "this adapter cannot hold a
 * session" and quietly falls back to calling `upload()` once per file. For this adapter that
 * fallback would be destructive - each call would empty the volume again - so there must be
 * nothing here that can fail. Connection problems surface on the first write instead, where
 * they are reported against a file rather than swallowed.
 */
export function openDockerRestoreSession(
    config: Record<string, unknown>,
    onLog?: OnLog,
): DockerRestoreSession {
    const helperImage = typeof config.helperImage === "string" && config.helperImage.length > 0
        ? config.helperImage
        : DEFAULT_HELPER_IMAGE;

    let connection: DockerConnection | null = null;
    const prepared = new Map<string, Promise<PreparedVolume>>();

    const say = (message: string, level: "info" | "warning" | "error" = "info") => {
        onLog?.(message, level, "storage");
        if (level === "error") log.error(message);
        else if (level === "warning") log.warn(message);
        else log.info(message);
    };

    // Info rather than a warning - see the note in snapshot.ts.
    const engine = () => (connection ??= connectDocker(config, (m) => say(m))).engine;

    /**
     * The helper for one volume, prepared once.
     *
     * Stored before it is awaited, so two files arriving together share one preparation
     * rather than each stopping the containers and emptying the volume.
     */
    const helperFor = (volume: string): Promise<PreparedVolume> => {
        let pending = prepared.get(volume);
        if (!pending) {
            pending = prepareVolumeForRestore(engine(), config, volume, helperImage, say);
            prepared.set(volume, pending);
            // Keeps the rejection for real awaiters without tripping Node's
            // unhandled-rejection warning while nothing is awaiting it yet.
            pending.catch(() => { });
        }
        return pending;
    };

    const session: DockerRestoreSession = {
        async upload(localPath, remotePath, _onProgress, _onLog, options?: UploadOptions) {
            const { volume, inner } = splitVolumePath(remotePath);
            const helper = await helperFor(volume);
            await writeFile(engine(), helper.containerId, volume, inner, localPath, options);
            return true;
        },

        async close() {
            // Every volume is finished independently. One helper that will not go away must
            // not keep another volume's containers down.
            for (const [volume, pending] of prepared) {
                const helper = await pending.catch(() => null);
                if (!helper) continue;
                await finishVolumeRestore(engine(), helper, say).catch((e: unknown) => {
                    say(`Could not finish restoring volume '${volume}': ${describe(e)}`, "error");
                });
            }
            prepared.clear();
            await connection?.close().catch(() => { });
            connection = null;
        },
    };

    return session;
}

function describe(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
