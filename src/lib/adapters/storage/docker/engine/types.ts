/**
 * What DBackup needs from a container runtime, in DBackup's words.
 *
 * Everything above this line talks volumes, containers and archives. Everything below it -
 * exactly one file, `dockerode-engine.ts` - talks to dockerode. Without that seam the client
 * would be reached for from all eleven files of this adapter, which is structurally the same
 * spread that made the old SSH mode unmaintainable, just with a different library.
 *
 * The two reasons the seam earns its keep are not "the agent will need a second
 * implementation" - it almost certainly will not, since an agent can expose the same API
 * socket over its own channel and `ExecutionHost.connectSocket` already covers that:
 *
 *  - The logic worth testing (grouping, refcounts, orphan recovery) is testable against a
 *    fake with fourteen methods, instead of a mock reproducing `getVolume(...).remove()`
 *    and `container.getArchive()`.
 *  - If reading a volume ever has to work differently, it is a swap rather than a rewrite.
 *
 * If this ever collapses into `type DockerEngine = Dockerode`, it is worthless and should
 * be deleted rather than kept for the shape of it.
 */

export interface VolumeInfo {
    name: string;
    /** Volume driver, "local" for anything Docker manages itself. */
    driver: string;
    /** Host path the volume's contents live at. Only the local driver reports one. */
    mountpoint?: string;
    labels: Record<string, string>;
    /** When Docker created it, as an ISO string. Missing where the driver does not say. */
    createdAt?: string;
}

export interface ContainerInfo {
    id: string;
    /** Leading slash stripped, as a user would write it. */
    name: string;
    /** True only for a container that is actually running now. */
    running: boolean;
    labels: Record<string, string>;
}

/** One mount of a container: a volume, a folder of the host, or one of the rarer kinds. */
export interface ContainerMount {
    /** "volume" or "bind", or whatever else Docker calls the kind. */
    type: string;
    /** The volume, for a volume mount. */
    volume?: string;
    /** Where the container sees it. */
    destination: string;
}

/** A container with its image and everything it mounts, for the volume picker of the job form. */
export interface ContainerDetail extends ContainerInfo {
    image: string;
    mounts: ContainerMount[];
}

export interface DockerEngine {
    /** Loggable description of the endpoint. Never contains credentials. */
    readonly label: string;

    version(): Promise<{ version: string; apiVersion: string }>;

    listVolumes(): Promise<VolumeInfo[]>;
    inspectVolume(name: string): Promise<VolumeInfo | null>;
    createVolume(name: string): Promise<void>;
    /**
     * Removes everything inside a volume without removing the volume itself.
     *
     * Needs a startable image with a shell, unlike everything else here: the archive
     * endpoints can write into a volume but not delete from one, so emptying is the single
     * operation that cannot be done with a container that is only created.
     */
    emptyVolume(name: string, helperImage: string): Promise<void>;

    /** Every container referencing the volume, running or not. */
    containersUsingVolume(name: string): Promise<ContainerInfo[]>;
    /** Every container of the host, running or not, with its mounts. One call for all of them. */
    listContainers(): Promise<ContainerDetail[]>;
    /**
     * The bytes each volume holds, from `docker system df`.
     *
     * Slow on a big host, since the daemon walks every volume to answer, which is why it is a
     * call of its own rather than part of the volume list. A volume the daemon could not
     * measure, like one of another driver, is left out.
     */
    volumeSizes(): Promise<Map<string, number>>;
    stopContainer(id: string): Promise<void>;
    startContainer(id: string): Promise<void>;

    /**
     * Creates - but does not start - a container with the given volumes mounted under
     * `/vol/<name>`, carrying our labels so a run killed before cleanup can be found again.
     *
     * Not starting it is deliberate and verified: the archive endpoints read and write a
     * created container's mounts without a process ever running in it, so this needs no
     * shell, no entrypoint and no image that could fail to start.
     */
    /**
     * Makes sure an image is present locally, pulling it only if it is not.
     *
     * Without this the very first backup on a host fails on a missing helper image, which is
     * a guaranteed first-run failure for a setting most people will never change. A host with
     * no internet still fails, with the same message it would have given anyway.
     */
    ensureImage(name: string): Promise<void>;

    createMountContainer(volumes: string[], image: string, labels: Record<string, string>): Promise<string>;

    /**
     * Runs the helper once to count what each mounted volume holds, for a progress
     * denominator.
     *
     * Measured at roughly 160 ms for 20,000 files against a three-second export of the same
     * volume - it walks directory entries rather than reading data, so it costs a few percent
     * of the transfer it is describing. The helper stays readable afterwards: a container
     * that has run and exited exports exactly like one that never started.
     *
     * Returns null rather than throwing when the count cannot be had - an image with no
     * shell, or one that refuses to start. Progress is worth a few percent, never a failed
     * backup, so the caller falls back to reporting a count without a total.
     */
    countEntriesPerVolume(containerId: string): Promise<Map<string, number> | null>;
    removeMountContainer(id: string): Promise<void>;
    /** Containers carrying a label key, for finding what an interrupted run left behind. */
    findLabelledContainers(labelKey: string): Promise<ContainerInfo[]>;

    /**
     * Tar stream of a path inside a container.
     *
     * Every member is prefixed with the basename of the requested path, so a caller reading
     * `/vol/data` gets `data/...` and has to strip one leading component. Modes, owners and
     * symlinks come through intact.
     */
    exportPath(containerId: string, path: string): Promise<NodeJS.ReadableStream>;
    /**
     * Unpacks a tar stream into a path inside a container, applying the modes and owners in
     * its headers.
     *
     * The stream must come from our own packer. A tar produced by a host tool can carry
     * extended attributes the daemon cannot apply, and it fails the whole call over one -
     * macOS `bsdtar` stamps `com.apple.provenance` onto every file, which is exactly how
     * that was found.
     */
    importPath(containerId: string, path: string, tar: NodeJS.ReadableStream): Promise<void>;

    /** Idempotent. Closes the connection and anything holding it open. */
    close(): Promise<void>;
}
