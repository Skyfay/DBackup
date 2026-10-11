/**
 * Docker and Compose on the host a part of the lab runs on. Every call names the docker context
 * of that host, so the same code drives the Docker of this machine and a remote one.
 */

import { spawn } from "child_process";
import path from "path";
import { REPO_ROOT, type DockerHost, type Group } from "./config";

/** The network every part of the lab joins on a host, so the SSH host reaches the databases by name. */
export const NETWORK = "dbackup-lab";

export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface RunOptions {
    /** Sent to the standard input of the command. */
    input?: string;
    env?: Record<string, string>;
    /** Shows the output live instead of collecting it. */
    inherit?: boolean;
}

export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            env: { ...process.env, ...options.env },
            stdio: [options.input !== undefined ? "pipe" : "ignore", options.inherit ? "inherit" : "pipe", options.inherit ? "inherit" : "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => { stdout += chunk; });
        child.stderr?.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
        if (options.input !== undefined) child.stdin?.end(options.input);
    });
}

/** Runs a command and fails with its output when it does not succeed. */
export async function runOrThrow(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    const result = await run(command, args, options);
    if (result.code !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed with ${result.code}\n${result.stderr || result.stdout}`);
    }
    return result;
}

export function dockerArgs(host: DockerHost, args: string[]): string[] {
    return ["--context", host.docker, ...args];
}

/** The arguments of `docker compose` for one part of the lab. */
export function composeArgs(host: DockerHost, group: Group, profile: "core" | "full", args: string[]): string[] {
    const file = path.join(REPO_ROOT, "lab", "compose", `${group}.yml`);
    const profiles = profile === "full" ? ["--profile", "core", "--profile", "full"] : ["--profile", "core"];
    return dockerArgs(host, ["compose", "-p", `dbackup-lab-${group}`, "-f", file, ...profiles, ...args]);
}

export async function ensureNetwork(host: DockerHost): Promise<void> {
    const inspect = await run("docker", dockerArgs(host, ["network", "inspect", NETWORK]));
    if (inspect.code !== 0) await runOrThrow("docker", dockerArgs(host, ["network", "create", NETWORK]));
}
