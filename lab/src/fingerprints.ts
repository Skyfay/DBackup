/**
 * Reads a database in a container of the lab with the tools of its engine, outside of DBackup,
 * and drops one again. The commands are in the engine files, this runs them in the container.
 */

import type { LabConfig, SshLogin } from "./config";
import { execIn } from "./docker";
import { engineOf } from "./engines";
import { SQLITE } from "./engines/sqlite";
import type { Clients, Engine, Run } from "./engines/types";

/** Runs shell commands in a service of the lab. A command that fails throws, with `what` it was. */
export function runIn(config: LabConfig, service: string, what: string): Run {
    return async (command, input) => {
        const result = await execIn(config, service, command, input, 120_000);
        if (result.code !== 0) throw new Error(`${what} in ${service} failed: ${(result.stderr || result.stdout).trim()}`);
        return result.stdout;
    };
}

/** The clients of an engine in its container, or those of a native server as root when `native` names its login. */
function clientsOf(engine: Engine, native?: SshLogin): Clients {
    const spec = engineOf(engine);
    if (!native) return spec.clients;
    if (!spec.native) throw new Error(`${spec.name} does not run on native servers`);
    return spec.native.clients(native);
}

/** What a database in a service holds, as the tools of its engine read it. */
export function fingerprintIn(config: LabConfig, engine: Engine | "sqlite", service: string, location: string, native?: SshLogin): Promise<string> {
    const run = runIn(config, service, `Reading ${location}`);
    if (engine === "sqlite") return SQLITE.fingerprint(run, location);
    const spec = engineOf(engine);
    if (!spec.fingerprint) throw new Error(`No fingerprint for ${spec.name}`);
    return spec.fingerprint(run, location, clientsOf(engine, native));
}

/** Drops a database in a service, and does nothing when it is not there. */
export async function dropIn(config: LabConfig, engine: Engine | "sqlite", service: string, location: string, native?: SshLogin): Promise<void> {
    const run = runIn(config, service, `Dropping ${location}`);
    if (engine === "sqlite") return SQLITE.drop(run, location);
    const spec = engineOf(engine);
    if (!spec.drop) throw new Error(`No way to drop a database of ${spec.name}`);
    await spec.drop(run, location, clientsOf(engine, native));
}
