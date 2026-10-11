/**
 * The configuration of the dev lab: who the first user is, where backups go and which host runs
 * which part of the lab. Read from `DBACKUP_LAB_CONFIG`, then `~/.config/dbackup/lab.json`, then
 * the example in the repository, which runs everything on this machine.
 */

import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { z } from "zod";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const EXAMPLE_CONFIG = path.join(REPO_ROOT, "lab", "lab.config.example.json");
export const USER_CONFIG = path.join(os.homedir(), ".config", "dbackup", "lab.json");

/** The parts of the lab, one Compose file each. */
export const GROUPS = ["databases", "storage", "notify"] as const;
export type Group = (typeof GROUPS)[number];

const SshSchema = z.object({
    user: z.string().min(1),
    port: z.number().int().positive().optional(),
    /** The password, or `env:NAME`. A NetBird SSH server takes any, so it may stay out there. */
    password: z.string().min(1).optional(),
});

const HostSchema = z.object({
    /** The docker context of the host, `default` for the Docker of this machine. A host without one runs no containers. */
    docker: z.string().min(1).optional(),
    /** The address DBackup reaches the published ports under. Prefer IPv4, names may resolve to IPv6 first. */
    address: z.string().min(1),
    /** How DBackup logs in to the host itself, for the backups of SQL Server on a remote Docker host. */
    ssh: SshSchema.optional(),
    /**
     * A plain server with the databases installed from its packages, set up by
     * `pnpm lab:provision <host>`. The seed adds its databases as sources in SSH mode.
     */
    native: z.object({
        /** The OpenSSH login for the sources, a user without root like on a real server. */
        ssh: SshSchema,
    }).optional(),
});

const ConfigSchema = z.object({
    admin: z.object({
        name: z.string().min(1),
        email: z.string().email(),
        /** The password, or `env:NAME` to read it from an environment variable. */
        password: z.string().min(1),
    }),
    /** Where Local backups go, a folder per workspace below it. Defaults to `.lab-storage` in the repository. */
    storageRoot: z.string().min(1).optional(),
    /** `core` runs the oldest and newest version of each engine, `full` every version. */
    profile: z.enum(["core", "full"]).optional(),
    hosts: z.record(z.string(), HostSchema).optional(),
    /** Which host runs each part of the lab, by the name it has under `hosts`. */
    place: z.object({
        databases: z.string().optional(),
        storage: z.string().optional(),
        notify: z.string().optional(),
    }).optional(),
});

export interface SshLogin {
    user: string;
    port: number;
    password: string;
}

export interface Host {
    name: string;
    docker?: string;
    address: string;
    ssh?: SshLogin;
    native?: { ssh: SshLogin };
}

/** A NetBird SSH server takes any password, so a host that only has one of those needs none in the config. */
const ANY_PASSWORD = "lab-unused-password";

function sshLogin(ssh: z.infer<typeof SshSchema>, defaultPort: number): SshLogin {
    return { user: ssh.user, port: ssh.port ?? defaultPort, password: ssh.password ? resolveSecret(ssh.password) : ANY_PASSWORD };
}

/** A host that runs containers. */
export type DockerHost = Host & { docker: string };

export interface LabConfig {
    /** The file it came from, for messages. */
    source: string;
    admin: { name: string; email: string; password: string };
    storageRoot: string;
    profile: "core" | "full";
    hosts: Record<string, Host>;
    /** Where each part runs. Always a host with a docker context. */
    place: Record<Group, DockerHost>;
}

const LOCAL_HOST = { docker: "default", address: "127.0.0.1" };

/** `env:NAME` reads the variable NAME, anything else is the value itself. */
export function resolveSecret(value: string): string {
    if (!value.startsWith("env:")) return value;
    const name = value.slice(4);
    const resolved = process.env[name];
    if (!resolved) throw new Error(`The lab config reads ${name} from the environment, but it is not set.`);
    return resolved;
}

/** The first config file that exists. */
export function findConfigFile(env: NodeJS.ProcessEnv = process.env): string {
    const candidates = [env.DBACKUP_LAB_CONFIG, USER_CONFIG, EXAMPLE_CONFIG].filter((file): file is string => !!file);
    const found = candidates.find((file) => existsSync(file));
    if (!found) throw new Error(`No lab config found. Looked at ${candidates.join(", ")}.`);
    return found;
}

/** Checks a parsed config file and fills in the defaults. */
export function parseConfig(raw: unknown, source: string): LabConfig {
    const result = ConfigSchema.safeParse(raw);
    if (!result.success) {
        const problems = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
        throw new Error(`The lab config ${source} is not valid:\n  ${problems.join("\n  ")}`);
    }
    const config = result.data;

    const hosts: Record<string, Host> = { local: { name: "local", ...LOCAL_HOST } };
    for (const [name, host] of Object.entries(config.hosts ?? {})) {
        hosts[name] = {
            name,
            docker: host.docker,
            address: host.address,
            ssh: host.ssh ? sshLogin(host.ssh, 22) : undefined,
            native: host.native ? { ssh: sshLogin(host.native.ssh, 22) } : undefined,
        };
    }

    const place = {} as Record<Group, DockerHost>;
    for (const group of GROUPS) {
        const name = config.place?.[group] ?? "local";
        const host = hosts[name];
        if (!host) throw new Error(`The lab config ${source} places ${group} on "${name}", which is not under hosts.`);
        if (!host.docker) throw new Error(`The lab config ${source} places ${group} on "${name}", which has no docker context.`);
        place[group] = { ...host, docker: host.docker };
    }

    return {
        source,
        admin: { ...config.admin, password: resolveSecret(config.admin.password) },
        storageRoot: path.resolve(config.storageRoot ?? path.join(REPO_ROOT, ".lab-storage")),
        profile: config.profile ?? "core",
        hosts,
        place,
    };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
    const file = findConfigFile(env);
    return parseConfig(JSON.parse(readFileSync(file, "utf8")), file);
}
