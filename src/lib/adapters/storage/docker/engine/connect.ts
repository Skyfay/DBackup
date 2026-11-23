/**
 * Builds a DockerEngine on top of an ExecutionHost.
 *
 * This is the entire transport story of the adapter. Something hands back a stream to the
 * daemon as reachable from that host, and nothing here or anywhere above needs to know what
 * kind - no local listener, no port, no `host.kind` check. Which of the two pipes is used
 * is decided in `reach.ts`, once per connection.
 */

import { createHost, resolveTransport, type ExecutionHost } from "@/lib/transport";
import { DEFAULT_DOCKER_SOCKET } from "@/lib/adapters/definitions/storage";
import { createDockerodeEngine } from "./dockerode-engine";
import { createReacher } from "./reach";
import type { DockerEngine } from "./types";

/** Re-exported so the adapter's own modules do not each reach into the definitions. */
export { DEFAULT_DOCKER_SOCKET as DEFAULT_SOCKET_PATH } from "@/lib/adapters/definitions/storage";

export interface DockerConnection {
    engine: DockerEngine;
    /** Closes the engine and disposes the transport underneath it. Idempotent. */
    close: () => Promise<void>;
}

/**
 * Opens a connection to the daemon a config points at.
 *
 * The host is created here rather than handed in because storage adapters are not given one:
 * `upload`, `list` and `downloadDirectory` take a config and nothing else. Whatever is
 * created here therefore has to be closed by whoever called, which is what the session
 * above this exists to guarantee.
 *
 * The spec comes from `resolveTransport` without a resolver of its own, so the standard
 * `connectionMode` convention reads the config, and the reach policy of the tenant goes onto
 * the SSH spec: for a tenant that blocks the local network the SSH host is dialed at an
 * address checked at connect time, like by every other host, see `withReach` in
 * `transport/spec.ts`. Never `standardTransport` directly, which leaves the policy behind.
 */
export function connectDocker(
    config: Record<string, unknown>,
    onLog?: (message: string) => void,
): DockerConnection {
    const host: ExecutionHost = createHost(resolveTransport({ id: "docker-volume" }, config));
    const socketPath = typeof config.socketPath === "string" && config.socketPath.length > 0
        ? config.socketPath
        : DEFAULT_DOCKER_SOCKET;

    const reacher = createReacher(host, socketPath, (reason) => {
        // Said, not silent. Which of the two routes a connection took explains a whole class
        // of later behaviour - the fallback needs the Docker CLI on the target - and finding
        // that out from a stack trace is an hour nobody should spend.
        onLog?.(
            `Could not forward the Docker socket, so the Docker CLI on that host is used instead `
            + `(it runs there, not here). ${reason}`
        );
    });

    const engine = createDockerodeEngine({
        // One connection per request, as dockerode asks for. Over SSH each is a channel on
        // the one already-open connection, so this costs a channel and not a handshake.
        connect: () => reacher.open(),
        label: `${host.label} ${socketPath}`,
        onClose: () => host.dispose(),
    });

    return { engine, close: () => engine.close() };
}
