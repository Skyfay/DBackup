import type { RedisConfig } from "@/lib/adapters/definitions";

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
    if (config.password) {
        // redis-cli takes the password on the command line. It stays visible in
        // the process list on whichever machine runs the client, which is a
        // pre-existing limitation of this adapter rather than something the
        // transport introduced.
        //
        // --no-auth-warning suppresses the "Using a password with -a is
        // insecure" line that would otherwise pollute every stderr stream. The
        // table browser already passed it; now every redis-cli call does.
        args.push("-a", config.password, "--no-auth-warning");
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

/** Replace the password with stars for anything that gets logged. */
export function maskSecrets(argv: string[], password?: string): string {
    return argv.map(arg => (password && arg === password ? "******" : arg)).join(" ");
}

export const REDIS_CLI = ["redis-cli"] as const;
