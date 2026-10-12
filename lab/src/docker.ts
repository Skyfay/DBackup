/**
 * Docker and Compose on the host the lab runs on. Every call names the docker context of that
 * host, so the same code drives the Docker of this machine and a remote one. The lab is one
 * Compose project of three files, whose services reach each other by name.
 */

import { spawn } from "child_process";
import path from "path";
import { GROUPS, REPO_ROOT, isThisMachine, type DockerHost, type LabConfig } from "./config";
import { mssqlBackupDir } from "./engines/mssql";

export const PROJECT = "dbackup-lab";

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
    /** Stops the command after this long and returns code 124, like timeout(1). */
    timeoutMs?: number;
}

export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            env: { ...process.env, ...options.env },
            stdio: [options.input !== undefined ? "pipe" : "ignore", options.inherit ? "inherit" : "pipe", options.inherit ? "inherit" : "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = options.timeoutMs
            ? setTimeout(() => {
                timedOut = true;
                child.kill("SIGKILL");
            }, options.timeoutMs)
            : undefined;
        child.stdout?.on("data", (chunk) => { stdout += chunk; });
        child.stderr?.on("data", (chunk) => { stderr += chunk; });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (timedOut) resolve({ code: 124, stdout, stderr: stderr || `no answer within ${Math.round(options.timeoutMs! / 1000)}s` });
            else resolve({ code: code ?? 1, stdout, stderr });
        });
        if (options.input !== undefined) child.stdin?.end(options.input);
    });
}

/** Like `run`, but a command that is not installed gives code 127 instead of throwing. */
export async function attempt(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    try {
        return await run(command, args, options);
    } catch (error) {
        return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
    }
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

/** The arguments of `docker compose` for the lab. The full profile names every service, whichever profile started them. */
export function composeArgs(host: DockerHost, profile: "core" | "full", args: string[]): string[] {
    // e2e.yml holds DBackup itself and what else only the end-to-end tests start, under the profile e2e.
    const files = [...GROUPS, "e2e"].flatMap((name) => ["-f", path.join(REPO_ROOT, "lab", "compose", `${name}.yml`)]);
    const profiles = profile === "full" ? ["--profile", "core", "--profile", "full"] : ["--profile", "core"];
    return dockerArgs(host, ["compose", "-p", PROJECT, ...files, ...profiles, ...args]);
}

/**
 * The group the .bak files of SQL Server get, from the setgid folder they are written to: the
 * group of this user when the lab runs here, so `pnpm dev` reads them as well, and 1001 on a
 * remote host, the group DBackup runs under in its image.
 */
export function mssqlBackupGroup(config: LabConfig): number {
    return isThisMachine(config.docker) && process.getgid ? process.getgid() : 1001;
}

/** The variables the Compose files read. */
export function composeEnv(config: LabConfig): Record<string, string> {
    return {
        LAB_MSSQL_BACKUP_DIR: mssqlBackupDir(config),
        LAB_MSSQL_GID: String(mssqlBackupGroup(config)),
        LAB_FTP_ADDRESS: config.docker.address,
    };
}

/** Runs `docker compose` for the lab, on its Docker host. */
export function compose(config: LabConfig, args: string[], options: RunOptions & { profile?: "core" | "full" } = {}): Promise<RunResult> {
    const { profile = "full", ...rest } = options;
    return run("docker", composeArgs(config.docker, profile, args), { ...rest, env: { ...composeEnv(config), ...rest.env } });
}

/** Runs a shell command in a service of the lab. */
export function execIn(config: LabConfig, service: string, command: string, input?: string, timeoutMs?: number): Promise<RunResult> {
    return compose(config, ["exec", "-T", service, "sh", "-c", command], { input, timeoutMs });
}
