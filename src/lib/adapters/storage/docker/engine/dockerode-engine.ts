/**
 * The one file that talks to dockerode.
 *
 * A lint guard holds that line. Without it the client leaks back into the rest of the
 * adapter within a couple of changes, which is not a guess: `shellEscape` spread across
 * eighteen adapter files exactly that way.
 */

import Docker from "dockerode";
import type { Duplex } from "node:stream";
import http from "node:http";

import type { ContainerInfo, DockerEngine, VolumeInfo } from "./types";
import { COUNT_COMMAND } from "../temp-container";

/** Where the mounted volumes appear inside a helper container. */
export const MOUNT_ROOT = "/vol";

/**
 * Reads `<volume> <count>` lines out of the helper's output.
 *
 * Container logs are multiplexed - each line is preceded by aneight-byte frame header - so
 * the control bytes are stripped rather than parsed. A line that does not fit the shape is
 * dropped: this is a progress denominator, and a wrong one is worse than none.
 */
function parseCounts(raw: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const line of raw.replace(/[\x00-\x08\x0b-\x1f]/g, "").split("\n")) {
        const match = /^(.+)\s+(\d+)$/.exec(line.trim());
        if (match) counts.set(match[1].trim(), Number(match[2]));
    }
    return counts;
}

/**
 * An http.Agent whose connections come from somewhere else entirely.
 *
 * This is what lets one dockerode client work over a local socket and over SSH without the
 * adapter knowing which: the ExecutionHost hands back a stream, and the agent hands it to
 * Node's HTTP client as if it had dialled it itself. Verified against a Duplex with none of
 * net.Socket's own methods, which is what an ssh2 channel looks like from here.
 */
class HostAgent extends http.Agent {
    constructor(private readonly open: () => Promise<Duplex>) {
        // Connections are not reused. Docker hijacks the socket for streaming endpoints, so
        // a pooled one can come back in a state the next request cannot use.
        super({ keepAlive: false });
    }

    // Node's declaration says this returns a socket synchronously or delivers one to the
    // callback. Ours can only be awaited, so it takes the callback path and returns nothing -
    // which is why the return type has to be widened rather than matched.
    createConnection(
        _options: http.ClientRequestArgs,
        callback?: (err: Error | null, stream: Duplex) => void,
    ): Duplex | null | undefined {
        this.open().then(
            (stream) => callback?.(null, stream),
            (err: Error) => callback?.(err, undefined as unknown as Duplex),
        );
        return undefined;
    }
}

export interface DockerodeEngineOptions {
    /** Opens a fresh connection to the daemon socket. Called once per request. */
    connect: () => Promise<Duplex>;
    /** Loggable endpoint description. Never contains credentials. */
    label: string;
    /** Closed when the engine is. Lets the caller tear down whatever backs `connect`. */
    onClose?: () => Promise<void>;
}

export function createDockerodeEngine(options: DockerodeEngineOptions): DockerEngine {
    const agent = new HostAgent(options.connect);
    // host and port are never dialled - the agent decides where a connection goes. They only
    // have to be present so docker-modem can build a request URL.
    const docker = new Docker({ agent, protocol: "http", host: "localhost", port: 80 } as never);
    let closed = false;

    const toVolume = (raw: {
        Name: string; Driver: string; Mountpoint?: string; Labels?: Record<string, string> | null; CreatedAt?: string;
    }): VolumeInfo => ({
        name: raw.Name,
        driver: raw.Driver,
        ...(raw.Mountpoint ? { mountpoint: raw.Mountpoint } : {}),
        labels: raw.Labels ?? {},
        ...(raw.CreatedAt ? { createdAt: raw.CreatedAt } : {}),
    });

    const toContainer = (raw: {
        Id: string; Names?: string[]; State?: string; Labels?: Record<string, string> | null;
    }): ContainerInfo => ({
        id: raw.Id,
        // Docker reports names with a leading slash, which no user ever types.
        name: (raw.Names?.[0] ?? raw.Id).replace(/^\//, ""),
        running: raw.State === "running",
        labels: raw.Labels ?? {},
    });

    return {
        label: options.label,

        async version() {
            const v = await docker.version();
            return { version: v.Version, apiVersion: v.ApiVersion };
        },

        async listVolumes() {
            const result = await docker.listVolumes();
            return (result.Volumes ?? []).map(toVolume);
        },

        async inspectVolume(name) {
            try {
                return toVolume(await docker.getVolume(name).inspect());
            } catch (e: unknown) {
                // Absent is an answer, not a failure - the restore asks precisely to find
                // out whether it is creating or overwriting.
                if ((e as { statusCode?: number }).statusCode === 404) return null;
                throw e;
            }
        },

        async createVolume(name) {
            await docker.createVolume({ Name: name });
        },

        async emptyVolume(name, helperImage) {
            // The one operation needing a process: the archive endpoints write into a volume
            // but cannot delete from one. The globs cover dotfiles, which a bare `*` misses -
            // and a half-emptied data directory is worse than one left alone.
            //
            // Built from the primitives rather than `docker.run`, and deliberately without
            // `AutoRemove`. dockerode's run does create, attach, start, then wait - and with
            // AutoRemove the daemon deletes the container the moment `rm -rf` exits, so a
            // `wait` that arrives afterwards gets "no such container". On a local socket that
            // gap is microseconds and it almost always wins; over SSH without socket
            // forwarding every one of those calls is its own process on the target, and the
            // wait loses every time. Reproduced at 0 of 3 with 400 ms per request.
            // The image is already known to be present: the restore checks it before it stops
            // anything, which is the only path that reaches here.
            const container = await docker.createContainer({
                Image: helperImage,
                Cmd: ["sh", "-c", `rm -rf ${MOUNT_ROOT}/..?* ${MOUNT_ROOT}/.[!.]* ${MOUNT_ROOT}/* 2>/dev/null; exit 0`],
                HostConfig: { Binds: [`${name}:${MOUNT_ROOT}`] },
            });

            try {
                await container.start();
                const result = await container.wait();
                if (result?.StatusCode !== 0) {
                    throw new Error(`Could not empty volume '${name}': helper exited with ${result?.StatusCode}`);
                }
            } finally {
                // Ours to remove now that the daemon does not. A failure here leaves an exited
                // container behind, which costs nothing and must not mask the real outcome.
                await container.remove({ force: true }).catch(() => { });
            }
        },

        async containersUsingVolume(name) {
            const list = await docker.listContainers({
                all: true,
                filters: { volume: [name] },
            });
            return list.map(toContainer);
        },

        async listContainers() {
            const list = await docker.listContainers({ all: true });
            return list.map((raw) => ({
                ...toContainer(raw),
                image: raw.Image,
                mounts: (raw.Mounts ?? []).map((mount) => ({
                    type: mount.Type,
                    ...(mount.Type === "volume" && mount.Name ? { volume: mount.Name } : {}),
                    destination: mount.Destination,
                })),
            }));
        },

        async volumeSizes() {
            // Dialled by hand because dockerode's df() sends no query, and type=volume spares
            // the daemon measuring images and build cache nobody asked about. A daemon older
            // than API 1.42 ignores the filter and measures everything, which is slower and
            // gives the same answer.
            const data = await new Promise<{ Volumes?: Array<{ Name: string; UsageData?: { Size?: number } | null }> | null }>((resolve, reject) => {
                docker.modem.dial(
                    { path: "/system/df?", method: "GET", options: { type: "volume" }, statusCodes: { 200: true, 400: "bad parameter", 500: "server error" } },
                    (err: unknown, result: unknown) => (err ? reject(err) : resolve(result as never)),
                );
            });
            const sizes = new Map<string, number>();
            for (const volume of data.Volumes ?? []) {
                const size = volume.UsageData?.Size;
                // -1 is Docker for "not measured", which is what a volume of another driver gets.
                if (typeof size === "number" && size >= 0) sizes.set(volume.Name, size);
            }
            return sizes;
        },

        async stopContainer(id) {
            try {
                await docker.getContainer(id).stop();
            } catch (e: unknown) {
                // 304 is "already stopped". Reaching that state is what was asked for.
                if ((e as { statusCode?: number }).statusCode === 304) return;
                throw e;
            }
        },

        async startContainer(id) {
            try {
                await docker.getContainer(id).start();
            } catch (e: unknown) {
                if ((e as { statusCode?: number }).statusCode === 304) return;
                throw e;
            }
        },

        async ensureImage(name) {
            try {
                await docker.getImage(name).inspect();
                return;
            } catch (e: unknown) {
                if ((e as { statusCode?: number }).statusCode !== 404) throw e;
            }
            const stream = await docker.pull(name);
            await new Promise<void>((resolve, reject) => {
                // The progress stream has to be drained or the pull never finishes. Nothing
                // in it is worth reporting for an image this small.
                docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
            });
        },

        async createMountContainer(volumes, image, labels) {
            const container = await docker.createContainer({
                Image: image,
                // Run at most once, to count. The export works whether or not it ever ran.
                Cmd: COUNT_COMMAND,
                Labels: labels,
                HostConfig: { Binds: volumes.map((name) => `${name}:${MOUNT_ROOT}/${name}`) },
            });
            return container.id;
        },

        async countEntriesPerVolume(containerId) {
            try {
                const container = docker.getContainer(containerId);
                await container.start();
                const result = await container.wait();
                if (result?.StatusCode !== 0) return null;

                const raw = await container.logs({ stdout: true, stderr: false });
                return parseCounts(raw.toString("utf8"));
            } catch {
                // An image with no shell, one that refuses to start, a daemon that says no.
                // None of those are worth failing a backup for.
                return null;
            }
        },

        async removeMountContainer(id) {
            await docker.getContainer(id).remove({ force: true, v: false });
        },

        async findLabelledContainers(labelKey) {
            const list = await docker.listContainers({ all: true, filters: { label: [labelKey] } });
            return list.map(toContainer);
        },

        async exportPath(containerId, path) {
            return await docker.getContainer(containerId).getArchive({ path });
        },

        async importPath(containerId, path, tar) {
            await docker.getContainer(containerId).putArchive(tar, { path });
        },

        async close() {
            if (closed) return;
            closed = true;
            agent.destroy();
            await options.onClose?.();
        },
    };
}
