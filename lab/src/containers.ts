/**
 * What state the services of the lab are in, and in words why one is not running. Shared by
 * `lab:up`, which reports what did not come up, and `lab:status`.
 */

import type { Group, LabConfig } from "./config";
import { DATABASES, NOTIFY, STORAGE, databasesOf, type Engine } from "./catalog";
import { compose, dockerArgs, run } from "./docker";

/** A service the lab expects in a group, with the port DBackup reaches it on. */
export interface ExpectedService {
    service: string;
    port: number;
    engine?: Engine;
}

export interface ServiceState {
    /** running, exited, created, restarting. A service without a container has no state. */
    state: string;
    /** healthy, unhealthy, starting, or empty when the service has no healthcheck. */
    health: string;
    exitCode: number;
    /** The name of the container, for what only `docker inspect` tells. */
    container: string;
}

/** The services of a group a profile starts, plus those an earlier full start left there. */
export function expectedServices(group: Group, profile: "core" | "full", present: Iterable<string> = []): ExpectedService[] {
    if (group === "databases") {
        const started = new Set(present);
        return DATABASES
            .filter((database) => databasesOf(profile).includes(database) || started.has(database.service))
            .map((database) => ({ service: database.service, port: database.port, engine: database.engine }));
    }
    if (group === "storage") return Object.values(STORAGE).map((entry) => ({ service: entry.service, port: entry.port }));
    return [
        { service: NOTIFY.mailpit.service, port: NOTIFY.mailpit.uiPort },
        { service: NOTIFY.ntfy.service, port: NOTIFY.ntfy.port },
        { service: NOTIFY.gotify.service, port: NOTIFY.gotify.port },
        { service: NOTIFY.webhook.service, port: NOTIFY.webhook.port },
    ];
}

/** The state of every container of the lab, by service. Throws when Docker on its host does not answer. */
export async function serviceStates(config: LabConfig): Promise<Map<string, ServiceState>> {
    const result = await compose(config, ["ps", "--all", "--format", "json"], { timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error(result.stderr.trim().split("\n").pop() || `docker compose ps failed with ${result.code}`);
    const states = new Map<string, ServiceState>();
    for (const line of result.stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        const entry = JSON.parse(line) as { Service: string; Name: string; State: string; Health?: string; ExitCode?: number };
        states.set(entry.Service, { state: entry.State, health: entry.Health ?? "", exitCode: entry.ExitCode ?? 0, container: entry.Name });
    }
    return states;
}

export const isUp = (state: ServiceState | undefined) => state?.state === "running" && state.health !== "unhealthy";

/**
 * Why a container stopped, from its exit code and the last line it logged. Exit code 132 is an
 * illegal instruction: MongoDB 5 and later need AVX, which a virtual machine with a generic CPU
 * model does not have. Exit code 137 is a kill, by the kernel for lack of memory or by Docker for
 * a container that did not stop in time, like on a shutdown of the host.
 */
export function explainExit(engine: Engine | undefined, exitCode: number, lastLog: string, outOfMemory = false): string {
    if (exitCode === 132 && engine === "mongodb") return "the CPU has no AVX, which MongoDB 5 and later need. Give the VM the CPU type of its host";
    if (exitCode === 137) return outOfMemory ? "killed for lack of memory" : "killed after it did not stop in time, as on a shutdown of the host";
    return lastLog ? `exit ${exitCode}: ${lastLog}` : `exit ${exitCode}`;
}

/** Whether the kernel killed a container for lack of memory. */
async function outOfMemory(config: LabConfig, container: string): Promise<boolean> {
    const result = await run("docker", dockerArgs(config.docker, ["inspect", "--format", "{{.State.OOMKilled}}", container]), { timeoutMs: 15_000 });
    return result.stdout.trim() === "true";
}

/** The last line a service logged, for the reason it stopped. */
export async function lastLogLine(config: LabConfig, service: string): Promise<string> {
    const result = await compose(config, ["logs", "--tail", "5", "--no-log-prefix", service], { timeoutMs: 15_000 });
    const lines = `${result.stdout}\n${result.stderr}`.split("\n").map((line) => line.trim()).filter(Boolean);
    const last = lines.pop() ?? "";
    return last.length > 160 ? `${last.slice(0, 157)}...` : last;
}

/** One line on a service that is not up, with the reason when it stopped. */
export async function describeDown(config: LabConfig, expected: ExpectedService, state: ServiceState | undefined): Promise<string> {
    if (!state) return "not started";
    if (state.state === "running") return state.health ? `running, ${state.health}` : "running";
    if (state.state === "exited") {
        const killedForMemory = state.exitCode === 137 && await outOfMemory(config, state.container);
        return explainExit(expected.engine, state.exitCode, await lastLogLine(config, expected.service), killedForMemory);
    }
    return state.state;
}
