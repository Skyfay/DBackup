import { getErrorMessage } from "@/lib/logging/errors";
import { connectDocker } from "./engine/connect";
import type { DockerEngine } from "./engine/types";

/**
 * Runs one operation against a freshly opened connection, and always closes it.
 *
 * Every call here is a standalone one - a connection test, a health check, a volume listing
 * for the job form. A backup instead holds one connection per prepared group, for as long as
 * that group's volumes are being read. See session.ts.
 */
export async function withEngine<T>(
    config: Record<string, unknown>,
    fn: (engine: DockerEngine) => Promise<T>,
    onError: (message: string) => T,
): Promise<T> {
    const connection = connectDocker(config);
    try {
        return await fn(connection.engine);
    } catch (e: unknown) {
        return onError(describeFailure(e));
    } finally {
        await connection.close().catch(() => { });
    }
}

/**
 * Turns a connection failure into something an operator can act on.
 *
 * The raw errors here are unusually unhelpful: a missing socket surfaces as ENOENT on a path
 * nobody typed, and a daemon that is simply not running looks identical to one that is not
 * mounted into the container.
 */
function describeFailure(e: unknown): string {
    const message = getErrorMessage(e);
    const code = (e as { code?: string }).code;

    if (code === "ENOENT" || message.includes("ENOENT")) {
        return `${message}. The Docker socket was not found. Running DBackup in a container means mounting it, for example -v /var/run/docker.sock:/var/run/docker.sock.`;
    }
    if (code === "EACCES" || message.includes("EACCES")) {
        return `${message}. The Docker socket exists but is not readable by the user DBackup runs as.`;
    }
    if (code === "ECONNREFUSED") {
        return `${message}. Nothing is listening on the Docker socket - the daemon is most likely not running.`;
    }
    return message;
}
