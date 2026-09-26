import { StorageAdapter, DirectoryBrowseEntry, FileInfo } from "@/lib/core/interfaces";
import { DockerVolumeSchema } from "@/lib/adapters/definitions/storage";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { downloadVolume } from "./read";
import { withEngine } from "./with-engine";
import { openDockerRestoreSession } from "./restore-session";
import {
    createDockerSnapshot,
    planDockerSourceGroups,
    releaseDockerSnapshot,
    supportsDockerSnapshot,
} from "./snapshot";

const log = logger.child({ adapter: "docker-volume" });

export type DockerVolumeConfig = Record<string, unknown>;

/**
 * Docker volumes as a backup source.
 *
 * A volume is data with no other way out: a database inside a container can be dumped
 * through its own adapter, but the configuration, uploads and plugin state beside it are
 * reachable only through the container runtime. Until now the only way to back that up was
 * to have set the volume up as a bind mount in the first place.
 *
 * Source only. Writing archives into a container runtime is not a thing anyone wants, and
 * offering it as a destination would only let someone build a job that fails on its first
 * upload - see `supportedRoles` on the definition.
 */
export const DockerVolumeAdapter: StorageAdapter = {
    id: "docker-volume",
    type: "storage",
    name: "Docker Volumes",
    configSchema: DockerVolumeSchema,
    // Read by the config resolver to decide whether an assigned profile is overlaid at all.
    // No primary slot: a Docker socket has no login of its own, so reaching the host that
    // owns it is the entire access question.
    credentials: { ssh: "SSH_KEY" },

    /**
     * A volume has no live path at all - its contents are only reachable through a
     * container - so the preparation is not an option the way shadow copies are. Stopping
     * the containers is the part that stays optional, per job source.
     */
    alwaysSnapshot: true,

    planSourceGroups: planDockerSourceGroups,
    supportsSnapshot: supportsDockerSnapshot,
    createSnapshot: createDockerSnapshot,
    releaseSnapshot: releaseDockerSnapshot,
    // `findOrphanedSnapshots` is deliberately absent - the sweep needs the connection the
    // preparation is about to open anyway, so it happens inside createSnapshot. See snapshot.ts.

    async test(config) {
        return withEngine<{ success: boolean; message: string; version?: string }>(
            config,
            async (engine) => {
                const { version, apiVersion } = await engine.version();
                const volumes = await engine.listVolumes();
                return {
                    success: true,
                    message: `Connected to Docker ${version} (API ${apiVersion}), ${volumes.length} volume(s) visible`,
                    version,
                };
            },
            (message) => ({ success: false, message }),
        );
    },

    async ping(config) {
        return withEngine<{ success: boolean; message: string }>(
            config,
            async (engine) => {
                const { version } = await engine.version();
                return { success: true, message: `Docker ${version}` };
            },
            (message) => ({ success: false, message }),
        );
    },

    /**
     * The volume list, shaped as directories so the existing folder picker in the job form
     * shows it with no new route and no new component. A volume has no children, so anything
     * below the root is empty.
     */
    async browseDirectories(config, subPath): Promise<DirectoryBrowseEntry[]> {
        if (subPath) return [];
        return withEngine(config, async (engine) => {
            const volumes = await engine.listVolumes();
            return volumes
                .map((volume) => ({ name: volume.name, path: volume.name }))
                .sort((a, b) => a.name.localeCompare(b.name));
        }, (message) => {
            // Thrown, not swallowed. This used to return an empty list so an unreachable
            // host would not break the dialog - but "no volumes on this host" and "this
            // host cannot be reached" are the two answers a person most needs to tell
            // apart, and one of them was being shown for both. The browse route turns this
            // into its error response, which the picker already reports.
            log.warn("Could not list Docker volumes", {}, wrapError(new Error(message)));
            throw new Error(message);
        });
    },

    /**
     * Answers one question: does this volume already exist?
     *
     * The only caller that matters is the restore's "empty or occupied" badge, and for a
     * volume that badge means "am I about to overwrite something". Counting what is inside
     * would take a container run for a label nobody reads a number off, so an existing volume
     * reports one entry and an absent one reports none. The collection never comes through
     * here - it uses `downloadDirectory`.
     */
    async list(config, remotePath): Promise<FileInfo[]> {
        const volume = remotePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").split("/")[0];
        if (!volume) return [];

        return withEngine<FileInfo[]>(config, async (engine) => {
            const found = await engine.inspectVolume(volume);
            if (!found) return [];
            return [{ name: volume, path: volume, size: 0, lastModified: new Date(0), isDirectory: true }];
        }, () => []);
    },

    /**
     * Native, because the generic path lists a tree and then fetches each file - which for a
     * volume is a round trip per file through the Docker API. One tar stream instead, the
     * same reason Rsync brings its own.
     */
    downloadDirectory(config, remotePath, localPath, excludePatterns, onProgress, onLog, options) {
        return downloadVolume(config, remotePath, localPath, excludePatterns, onProgress, onLog, options);
    },

    /**
     * Holds one connection and one helper container per target volume for the whole restore.
     *
     * Never throws: `createDestinationSessions` reads a failed `openSession` as "this adapter
     * cannot hold a session" and falls back to calling `upload()` per file, which here would
     * empty the target volume again before every single write. Connection problems surface
     * on the first write instead, reported against a file.
     */
    openSession(config, onLog) {
        return Promise.resolve(openDockerRestoreSession(config, onLog));
    },

    /**
     * Refuses outside a session, on purpose.
     *
     * Writing one file into a volume means stopping its containers, emptying it and creating
     * a helper - work that belongs to the restore as a whole, not to a file. Doing it here
     * would make the per-file fallback path destructive rather than merely slow.
     */
    async upload(): Promise<boolean> {
        throw new Error(
            "A Docker volume can only be restored through a restore session. If this appeared during a restore, "
            + "the connection to the Docker daemon could not be opened."
        );
    },

    // `createSymlink` is deliberately absent, which is how an adapter says it cannot store
    // symbolic links - the restore then reports them as skipped rather than failed, the same
    // as every other destination that cannot hold one.
    //
    // Not because the daemon refuses outright: a link pointing inside its own volume does
    // restore. But a link's target is a path inside whichever container mounts the volume
    // later, which is a different place from the one it was written in - an absolute target
    // means something else there, and a relative one that leaves the volume is rejected by
    // the daemon. Restoring the ones that happen to work would leave a user unable to tell
    // which of their links survived.

    async download(): Promise<boolean> {
        throw new Error("A Docker volume is collected as a directory, not as a single file.");
    },

    async delete(): Promise<boolean> {
        throw new Error("DBackup does not delete Docker volumes.");
    },
};
