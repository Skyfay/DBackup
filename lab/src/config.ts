/**
 * The configuration of the dev lab: who the first user is, where backups go, which Docker host
 * runs the lab and which native servers it has. Read from `DBACKUP_LAB_CONFIG`, then
 * `~/.config/dbackup/lab.json`, then the example in the repository, which runs everything on
 * this machine.
 */

import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { z } from "zod";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const EXAMPLE_CONFIG = path.join(REPO_ROOT, "lab", "lab.config.example.json");
export const USER_CONFIG = path.join(os.homedir(), ".config", "dbackup", "lab.json");

/** The parts of the lab, one Compose file each, all in one Compose project. */
export const GROUPS = ["databases", "storage", "notify"] as const;
export type Group = (typeof GROUPS)[number];

const SshSchema = z.object({
    user: z.string().min(1),
    port: z.number().int().positive().optional(),
    /** The password, or `env:NAME`. A NetBird SSH server takes any, so it may stay out there. */
    password: z.string().min(1).optional(),
}).strict();

const ConfigSchema = z.object({
    admin: z.object({
        name: z.string().min(1),
        email: z.string().email(),
        /** The password, or `env:NAME` to read it from an environment variable. */
        password: z.string().min(1),
    }).strict(),
    /** Where Local backups go, a folder per workspace below it. Defaults to `.lab-storage` in the repository. */
    storageRoot: z.string().min(1).optional(),
    /** `core` runs the oldest and newest version of each engine, `full` every version. */
    profile: z.enum(["core", "full"]).optional(),
    /** The Docker host of the whole lab. This machine when left out. */
    docker: z.object({
        /** The docker context of the host, `default` for the Docker of this machine. */
        context: z.string().min(1),
        /** The address DBackup reaches the published ports under. Prefer IPv4, names may resolve to IPv6 first. */
        address: z.string().min(1),
        /** How DBackup logs in to the host itself, to fetch the backups of SQL Server from a remote host. */
        ssh: SshSchema.optional(),
    }).strict().optional(),
    /**
     * Plain servers with the databases installed from their packages, set up by
     * `pnpm lab:provision <name>`. The seed adds their databases as sources in SSH mode.
     */
    native: z.record(z.string(), z.object({
        address: z.string().min(1),
        /** A login that may run the setup as root. */
        ssh: SshSchema.optional(),
        /** The OpenSSH login of the sources, a user without root like on a real server. */
        login: SshSchema,
    }).strict()).optional(),
}).strict();

export interface SshLogin {
    user: string;
    port: number;
    password: string;
}

/** The Docker host the lab runs on. */
export interface DockerHost {
    /** For messages, the context or "this machine". */
    name: string;
    docker: string;
    address: string;
    ssh?: SshLogin;
}

/** A server without Docker whose databases come from its packages. */
export interface NativeHost {
    name: string;
    address: string;
    /** The root login of `lab:provision` and `lab:status`. */
    ssh?: SshLogin;
    login: SshLogin;
}

export interface LabConfig {
    /** The file it came from, for messages. */
    source: string;
    admin: { name: string; email: string; password: string };
    storageRoot: string;
    profile: "core" | "full";
    docker: DockerHost;
    natives: NativeHost[];
}

/** A NetBird SSH server takes any password, so a host that only has one of those needs none in the config. */
const ANY_PASSWORD = "lab-unused-password";

function sshLogin(ssh: z.infer<typeof SshSchema>, defaultPort: number): SshLogin {
    return { user: ssh.user, port: ssh.port ?? defaultPort, password: ssh.password ? resolveSecret(ssh.password) : ANY_PASSWORD };
}

export const isThisMachine = (host: DockerHost) => host.docker === "default";

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
    if (raw && typeof raw === "object" && ("hosts" in raw || "place" in raw)) {
        throw new Error(`The lab config ${source} still has hosts and place. The lab runs on one Docker host now: put it under "docker" and native servers under "native", see docs/developer-guide/reference/dev-lab.md.`);
    }
    const result = ConfigSchema.safeParse(raw);
    if (!result.success) {
        const problems = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
        throw new Error(`The lab config ${source} is not valid:\n  ${problems.join("\n  ")}`);
    }
    const config = result.data;
    const docker = config.docker ?? { context: "default", address: "127.0.0.1" };

    return {
        source,
        admin: { ...config.admin, password: resolveSecret(config.admin.password) },
        storageRoot: path.resolve(config.storageRoot ?? path.join(REPO_ROOT, ".lab-storage")),
        profile: config.profile ?? "core",
        docker: {
            name: docker.context === "default" ? "this machine" : docker.context,
            docker: docker.context,
            address: docker.address,
            ssh: docker.ssh ? sshLogin(docker.ssh, 22) : undefined,
        },
        natives: Object.entries(config.native ?? {}).map(([name, host]) => ({
            name,
            address: host.address,
            ssh: host.ssh ? sshLogin(host.ssh, 22) : undefined,
            login: sshLogin(host.login, 22),
        })),
    };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
    const file = findConfigFile(env);
    return parseConfig(JSON.parse(readFileSync(file, "utf8")), file);
}
