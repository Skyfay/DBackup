import type { ExecutionHost } from "@/lib/transport";
import type { MySQLConfig, MariaDBConfig } from "@/lib/adapters/definitions";
import type { DumpClient } from "./dump-content";

/**
 * Argument builders for the MySQL and MariaDB client tools.
 *
 * There used to be two of these: a raw one for direct mode and a `shellEscape`d
 * one for SSH. Quoting is now the transport's job, so everything here returns
 * RAW argv. Escaping a value in this file would double-escape it over SSH and
 * turn the host into the literal string `'127.0.0.1'`.
 */

type AnyMySQLConfig = (MySQLConfig | MariaDBConfig) & { user?: string; disableSsl?: boolean };

/**
 * Whether the client should be forced onto TCP.
 *
 * Direct mode runs the client inside the DBackup container, where the server's
 * unix socket does not exist, so TCP is mandatory. Over SSH the client runs on
 * the database host, where the socket is the documented path: the setup guide
 * tells users to grant `'dbackup'@'localhost'` precisely because the connection
 * is local to the SSH session. Forcing TCP there would break those grants and
 * any socket-based auth plugin.
 *
 * This is the one place in the adapter that varies by transport, and it does so
 * deliberately rather than by accident.
 */
function forcesTcp(host: ExecutionHost): boolean {
    return host.kind === "direct";
}

/**
 * Connection flags shared by mysql, mysqladmin and mysqldump.
 *
 * `client` is the tool that runs, from `dumpClientOf`, which decides how TLS is turned off.
 * Without it the flag is MariaDB's, the client of the Docker image. `includeSsl` is off for the
 * dump and restore paths, where the dialect appends the flag itself.
 */
export function buildConnectionArgs(
    config: AnyMySQLConfig,
    host: ExecutionHost | undefined,
    options: { user?: string; includeSsl?: boolean; client?: DumpClient } = {},
): string[] {
    const args = [
        "-h", config.host || "127.0.0.1",
        "-P", String(config.port || 3306),
        "-u", options.user || config.user,
    ];
    if (!host || forcesTcp(host)) {
        args.push("--protocol=tcp");
    }
    if ((options.includeSsl ?? true) && config.disableSsl) {
        args.push(options.client?.sslOff ?? "--skip-ssl");
    }
    return args;
}

/**
 * Run `fn` with the argument prefix that authenticates the client.
 *
 * The password goes into a 0600 defaults-file on the execution host rather than
 * onto the command line, so it never shows up in that host's process list. When
 * there is no password no file is created and the prefix is empty.
 *
 * Replaces the withLocalMyCnf / withRemoteMyCnf pair, which were the same
 * function written twice.
 */
export async function withAuthArgs<T>(
    host: ExecutionHost,
    password: string | undefined,
    fn: (authArgs: string[]) => Promise<T>,
): Promise<T> {
    if (!password) {
        return fn([]);
    }

    // .my.cnf quoting: backslashes and double quotes need escaping.
    const escaped = password.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return host.withTempFile(
        { content: `[client]\npassword="${escaped}"\n`, mode: 0o600, suffix: ".cnf" },
        (cnfPath) => fn([`--defaults-file=${cnfPath}`]),
    );
}

/** Binary candidates, MariaDB's names first since they are the ones DBackup ships. */
export const MYSQL_CLIENT = ["mariadb", "mysql"] as const;
export const MYSQL_ADMIN = ["mariadb-admin", "mysqladmin"] as const;
export const MYSQL_DUMP = ["mariadb-dump", "mysqldump"] as const;
