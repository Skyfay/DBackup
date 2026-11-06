import type { RedisConfig } from "@/lib/adapters/definitions";
import type { ExecOptions } from "@/lib/transport";

/**
 * Argument builders for redis-cli.
 *
 * There used to be two of these: a raw one for direct mode and a `shellEscape`d
 * one for SSH, and the SSH caller then appended `--tls` and `-n` a second time
 * on top of what the builder had already added. This is the single raw version.
 * Escaping here would double-escape over SSH.
 */

type AnyRedisConfig = RedisConfig & { username?: string; password?: string; tls?: boolean };

export function buildConnectionArgs(config: AnyRedisConfig): string[] {
    const args = ["-h", config.host, "-p", String(config.port)];

    if (config.username) {
        args.push("--user", config.username);
    }
    if (config.tls) {
        args.push("--tls");
    }
    if (config.database !== undefined && config.database !== 0) {
        // The index of a database is a whole number. A restore target or a stored value of
        // another kind would reach redis-cli as something else than the value of -n.
        if (!/^\d+$/.test(String(config.database))) {
            throw new Error(`The Redis database ${String(config.database)} is no index. Use a whole number like 0.`);
        }
        args.push("-n", String(config.database));
    }

    return args;
}

/**
 * The password of a redis-cli call, as `REDISCLI_AUTH` in its environment. Never `-a` in argv,
 * which every user of the machine that runs the client reads in the process list and which an SSH
 * connection writes into the remote command. redis-cli sends it with the user of `--user`, and an
 * environment value prints no warning. Every redis-cli call passes these options.
 */
export function redisCliOptions(config: { password?: string }): ExecOptions {
    return config.password ? { env: { REDISCLI_AUTH: config.password } } : {};
}

/** Replace the password with stars for anything that gets logged. */
export function maskSecrets(argv: string[], password?: string): string {
    return argv.map(arg => (password && arg === password ? "******" : arg)).join(" ");
}

export const REDIS_CLI = ["redis-cli"] as const;
