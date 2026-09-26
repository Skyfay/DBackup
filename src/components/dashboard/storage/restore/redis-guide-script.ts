/**
 * The commands of the Redis and Valkey restore guide, as one script and as steps by hand.
 *
 * Redis reads a dump only while it starts, so DBackup cannot restore one over the network like
 * the other engines. The guide writes the commands instead, filled in with where Redis runs and
 * the one-time download link, in Bash for Linux and Docker and in PowerShell for Windows. The
 * script checks everything that would make Redis start without the dump before it changes
 * anything, since redis-cli exits with 0 even when Redis says no.
 */
import { bashAof, bashScript, bashSteps } from "./redis-guide-bash";
import type { GuideCode, GuideStep, RedisEngine, RedisGuideInput, RedisHost } from "./redis-guide-common";
import { powershellAof, powershellScript, powershellSteps } from "./redis-guide-powershell";

export type { GuideCode, GuideMark, GuideStep, RedisEngine, RedisGuideInput, RedisHost } from "./redis-guide-common";

export const HOST_DEFAULTS: Record<RedisHost, Record<RedisEngine, { target: string; dataDir: string }>> = {
    docker: { Redis: { target: "redis", dataDir: "/data" }, Valkey: { target: "valkey", dataDir: "/data" } },
    compose: { Redis: { target: "redis", dataDir: "/data" }, Valkey: { target: "valkey", dataDir: "/data" } },
    service: { Redis: { target: "redis-server", dataDir: "/var/lib/redis" }, Valkey: { target: "valkey-server", dataDir: "/var/lib/valkey" } },
    windows: { Redis: { target: "Redis", dataDir: "C:\\Program Files\\Redis" }, Valkey: { target: "Valkey", dataDir: "C:\\Program Files\\Valkey" } },
};

/** Where the commands run, as the name above their code. */
export function hostPlace(host: RedisHost, engine: RedisEngine): string {
    return {
        docker: "on the Docker host",
        compose: "in the folder of the compose file",
        service: `on the ${engine} host`,
        windows: `in PowerShell on the ${engine} host`,
    }[host];
}

export function codeLanguage(host: RedisHost): "bash" | "powershell" {
    return host === "windows" ? "powershell" : "bash";
}

/** The file name of the script, after the job the backup belongs to. */
export function scriptFileName(job: string, host: RedisHost): string {
    const slug = job.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `restore-${slug || "redis"}.${host === "windows" ? "ps1" : "sh"}`;
}

/** How to run the script, for the line under it. */
export function runHint(input: RedisGuideInput, fileName: string): string {
    if (input.host === "windows") {
        return `Paste it into PowerShell as an administrator on the ${input.engine} host, or save it and run powershell -ExecutionPolicy Bypass -File ${fileName}.`;
    }
    const where = { docker: "on the Docker host", compose: "in the folder of the compose file", service: `on the ${input.engine} host` }[input.host];
    return `Paste it into a shell ${where}, or save it there and run bash ${fileName}${input.host === "service" ? " as a user with sudo rights" : ""}.`;
}

/** The whole restore as one script, which stops before it changes anything Redis would not read. */
export function redisScript(input: RedisGuideInput): GuideCode {
    return input.host === "windows" ? powershellScript(input) : bashScript(input);
}

/** The same restore one step at a time, every value filled in. */
export function redisSteps(input: RedisGuideInput): GuideStep[] {
    return input.host === "windows" ? powershellSteps(input) : bashSteps(input);
}

/**
 * The commands for a Redis that writes an append only file: a copy of the file, since it is the
 * only full copy of what Redis holds, and the switch that writes a new one from the restored
 * data. Turning the file off for the restart in between depends on where Redis gets its
 * settings, so the guide says it in words.
 */
export function redisAofCommands(input: RedisGuideInput): { keep: GuideCode; turnOn: GuideCode[] } {
    return input.host === "windows" ? powershellAof(input) : bashAof(input);
}
