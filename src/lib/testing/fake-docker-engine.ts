import { Readable } from "node:stream";
import { pack } from "tar-stream";
import type { ContainerDetail, ContainerInfo, DockerEngine, VolumeInfo } from "@/lib/adapters/storage/docker/engine/types";

/**
 * An in-memory Docker daemon for unit tests.
 *
 * Typed as `DockerEngine` on purpose: adding a method to the port has to break this file at
 * compile time rather than leave every test running against a stale fake. This is the pay-off
 * the port was introduced for - the grouping, the stop bookkeeping and the orphan recovery
 * are all testable against fourteen plain methods instead of a mock reproducing dockerode's
 * `getVolume(...).remove()` and `container.getArchive()`.
 */

export interface FakeContainer {
    id: string;
    name: string;
    running: boolean;
    /** Volumes this container holds. */
    volumes: string[];
    labels?: Record<string, string>;
    image?: string;
    /** Where the container mounts each of its volumes, `/<volume>` when not given. */
    mountPaths?: Record<string, string>;
    /** Folders of the host it mounts, as the destinations inside it. */
    binds?: string[];
}

export interface FakeDockerOptions {
    volumes?: string[];
    containers?: FakeContainer[];
    /** Labels and creation time of a volume, by name. */
    volumeDetails?: Record<string, { labels?: Record<string, string>; createdAt?: string }>;
    /** What `volumeSizes` measures, in bytes. */
    sizes?: Record<string, number>;
    /** Throws instead of doing the thing, keyed by method name. */
    failOn?: Partial<Record<keyof DockerEngine, Error>>;
    /** File counts per volume. `null` stands for a helper that could not be run to count. */
    entryCounts?: Record<string, number> | null;
    /**
     * What `exportPath` serves, per volume. Turned into a real tar stream, prefixed the way
     * a real daemon prefixes it - with the basename of the requested path - so the extractor
     * is tested against the shape it actually meets rather than an idealised one.
     */
    volumeContents?: Record<string, FakeVolumeEntry[]>;
}

export interface FakeVolumeEntry {
    /** Path inside the volume, without the mount prefix. */
    path: string;
    content?: string;
    type?: "file" | "directory" | "symlink" | "link" | "block-device";
    linkname?: string;
    mode?: number;
    uid?: number;
    gid?: number;
    mtime?: Date;
}

export interface FakeDockerCalls {
    /** Every mutation in order, so a test can assert on sequence and not just on counts. */
    order: string[];
    stopped: string[];
    started: string[];
    created: Array<{ id: string; volumes: string[]; image: string; labels: Record<string, string> }>;
    removed: string[];
    exported: Array<{ containerId: string; path: string }>;
    emptied: string[];
    closed: number;
}

export interface FakeDockerEngine extends DockerEngine {
    readonly calls: FakeDockerCalls;
    /** Current state, for assertions about what the daemon ended up like. */
    readonly containers: FakeContainer[];
}

export function createFakeDockerEngine(options: FakeDockerOptions = {}): FakeDockerEngine {
    const containers: FakeContainer[] = (options.containers ?? []).map((c) => ({ ...c }));
    const volumes = new Set(options.volumes ?? []);
    let created = 0;

    const calls: FakeDockerCalls = {
        order: [], stopped: [], started: [], created: [], removed: [], exported: [], emptied: [], closed: 0,
    };

    const failIfAsked = (method: keyof DockerEngine) => {
        const failure = options.failOn?.[method];
        if (failure) throw failure;
    };

    const toInfo = (c: FakeContainer): ContainerInfo => ({
        id: c.id, name: c.name, running: c.running, labels: c.labels ?? {},
    });

    const toVolume = (name: string): VolumeInfo => {
        const details = options.volumeDetails?.[name];
        return { name, driver: "local", labels: details?.labels ?? {}, ...(details?.createdAt ? { createdAt: details.createdAt } : {}) };
    };

    const engine: FakeDockerEngine = {
        label: "fake://docker",
        calls,
        containers,

        async version() {
            failIfAsked("version");
            return { version: "27.0.0", apiVersion: "1.46" };
        },

        async listVolumes(): Promise<VolumeInfo[]> {
            failIfAsked("listVolumes");
            return [...volumes].map(toVolume);
        },

        async inspectVolume(name) {
            failIfAsked("inspectVolume");
            return volumes.has(name) ? toVolume(name) : null;
        },

        async createVolume(name) {
            failIfAsked("createVolume");
            calls.order.push(`createVolume:${name}`);
            volumes.add(name);
        },

        async emptyVolume(name) {
            failIfAsked("emptyVolume");
            calls.order.push(`emptyVolume:${name}`);
            calls.emptied.push(name);
        },

        async containersUsingVolume(name) {
            failIfAsked("containersUsingVolume");
            return containers.filter((c) => c.volumes.includes(name)).map(toInfo);
        },

        async listContainers(): Promise<ContainerDetail[]> {
            failIfAsked("listContainers");
            return containers.map((c) => ({
                ...toInfo(c),
                image: c.image ?? "alpine:latest",
                mounts: [
                    ...c.volumes.map((volume) => ({ type: "volume", volume, destination: c.mountPaths?.[volume] ?? `/${volume}` })),
                    ...(c.binds ?? []).map((destination) => ({ type: "bind", destination })),
                ],
            }));
        },

        async volumeSizes() {
            failIfAsked("volumeSizes");
            return new Map(Object.entries(options.sizes ?? {}));
        },

        async stopContainer(id) {
            failIfAsked("stopContainer");
            calls.order.push(`stop:${id}`);
            calls.stopped.push(id);
            const container = containers.find((c) => c.id === id);
            if (container) container.running = false;
        },

        async startContainer(id) {
            failIfAsked("startContainer");
            calls.order.push(`start:${id}`);
            calls.started.push(id);
            const container = containers.find((c) => c.id === id);
            if (container) container.running = true;
        },

        async ensureImage(name) {
            failIfAsked("ensureImage");
            calls.order.push(`ensureImage:${name}`);
        },

        async createMountContainer(mounted, image, labels) {
            failIfAsked("createMountContainer");
            const id = `helper-${++created}`;
            calls.order.push(`create:${id}`);
            calls.created.push({ id, volumes: [...mounted], image, labels });
            containers.push({ id, name: id, running: false, volumes: [...mounted], labels });
            return id;
        },

        async countEntriesPerVolume(containerId) {
            failIfAsked("countEntriesPerVolume");
            calls.order.push(`count:${containerId}`);
            if (options.entryCounts === null) return null;
            const container = containers.find((c) => c.id === containerId);
            return new Map((container?.volumes ?? []).map((v) => [v, options.entryCounts?.[v] ?? 0]));
        },

        async removeMountContainer(id) {
            failIfAsked("removeMountContainer");
            calls.order.push(`remove:${id}`);
            calls.removed.push(id);
            const index = containers.findIndex((c) => c.id === id);
            if (index >= 0) containers.splice(index, 1);
        },

        async findLabelledContainers(labelKey) {
            failIfAsked("findLabelledContainers");
            return containers.filter((c) => c.labels?.[labelKey] !== undefined).map(toInfo);
        },

        async exportPath(containerId, path) {
            failIfAsked("exportPath");
            calls.exported.push({ containerId, path });

            const volume = path.slice(path.lastIndexOf("/") + 1);
            const contents = options.volumeContents?.[volume];
            if (!contents) return Readable.from([]);

            const tar = pack();
            // Every member carries the basename of the requested path, exactly as a real
            // daemon returns it. Getting this wrong in the fake would hide the one thing the
            // extractor has to do.
            tar.entry({ name: `${volume}/`, type: "directory", mtime: new Date(0) });
            for (const entry of contents) {
                tar.entry(
                    {
                        name: `${volume}/${entry.path}`,
                        type: entry.type ?? "file",
                        ...(entry.linkname !== undefined ? { linkname: entry.linkname } : {}),
                        ...(entry.mode !== undefined ? { mode: entry.mode } : {}),
                        ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
                        ...(entry.gid !== undefined ? { gid: entry.gid } : {}),
                        mtime: entry.mtime ?? new Date(0),
                    },
                    entry.content ?? "",
                );
            }
            tar.finalize();
            return tar;
        },

        async importPath() {
            failIfAsked("importPath");
        },

        async close() {
            calls.closed++;
        },
    };

    return engine;
}
