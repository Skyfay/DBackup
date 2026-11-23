import type { ExecutionHost } from "@/lib/transport";
import type { MySQLConfig, MariaDBConfig } from "@/lib/adapters/definitions";
import type { DumpClient } from "./dump-content";
import { AdapterError } from "@/lib/logging/errors";
import { validPort } from "@/lib/adapters/command-values";
import { PASSWORD_LINE_BREAK, fitsOptionFile } from "./option-file";

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
 * This and `runsBesideDBackup` are the one place in the adapter that varies by
 * transport, and they do so deliberately rather than by accident.
 */
function forcesTcp(host: ExecutionHost): boolean {
    return runsBesideDBackup(host);
}

/**
 * Whether the client runs on the server DBackup runs on, direct mode, rather than on the SSH server.
 * Besides TCP this decides whether a restore with a client that cannot be locked down fails closed,
 * since a shell command or a local file a dump names would run or be read beside DBackup's own
 * data there, see `lockedDownClientArgs`.
 */
export function runsBesideDBackup(host: ExecutionHost): boolean {
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
        // A port stored by an earlier version may be text, so it is checked like every other port.
        "-P", String(validPort(config.port, "mysql", 3306)),
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
 * Run `fn` with the argument prefix that authenticates the client. Every caller puts the prefix
 * right after the binary, since the tools read `--defaults-file` and `--no-defaults` only as their
 * first argument.
 *
 * The password goes into a 0600 defaults-file on the execution host rather than
 * onto the command line, so it never shows up in that host's process list. The tool then reads
 * that file and none of the option files of the machine, like a `~/.my.cnf`.
 *
 * Without a password no file is created. In direct mode the prefix is `--no-defaults` then, so a
 * tool beside DBackup never takes a password, a host or any other option from an option file of
 * the server DBackup runs on and sends it to the server of the connection. Over SSH the prefix
 * stays empty: the option files there belong to whoever runs that server, and a login without a
 * password in DBackup may rely on the `~/.my.cnf` of its SSH user.
 *
 * Replaces the withLocalMyCnf / withRemoteMyCnf pair, which were the same
 * function written twice.
 *
 * @throws AdapterError for a password with a line break or a NUL, see `assertOptionFileValue`.
 */
export async function withAuthArgs<T>(
    host: ExecutionHost,
    password: string | undefined,
    fn: (authArgs: string[]) => Promise<T>,
): Promise<T> {
    if (!password) {
        return fn(runsBesideDBackup(host) ? ["--no-defaults"] : []);
    }

    assertOptionFileValue(password);
    // .my.cnf quoting: backslashes and double quotes need escaping.
    const escaped = password.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return host.withTempFile(
        { content: `[client]\npassword="${escaped}"\n`, mode: 0o600, suffix: ".cnf" },
        (cnfPath) => fn([`--defaults-file=${cnfPath}`]),
    );
}

/**
 * Refuses a value for the option file with a CR, an LF or a NUL, see `option-file.ts`. Refused
 * rather than written as an escape, since no login holds one on purpose and the tools of different
 * versions read the escapes of a value differently. Checked here right before the file is written
 * as well as on save, since a stored config or a saved login may predate that check. Never names
 * the value.
 *
 * @throws AdapterError saying so.
 */
export function assertOptionFileValue(value: string): void {
    if (!fitsOptionFile(value)) throw new AdapterError("mysql", "login", PASSWORD_LINE_BREAK);
}

/**
 * Keeps the server of a connection from reading files of the machine the mysql or mariadb client
 * runs on. A server may answer any query, the `SELECT 1` of a connection test too, with a request
 * for a local file (`LOAD DATA LOCAL INFILE`), and the server of a connection is whatever its
 * tenant typed in. Every call of the client puts it right after the login prefix, the restore
 * through `lockedDownClientArgs`. mysqladmin and the dump tools never send a local file and do not
 * know the option.
 */
export const NO_LOCAL_INFILE = "--local-infile=0";

/** Binary candidates, MariaDB's names first since they are the ones DBackup ships. */
export const MYSQL_CLIENT = ["mariadb", "mysql"] as const;
export const MYSQL_ADMIN = ["mariadb-admin", "mysqladmin"] as const;
export const MYSQL_DUMP = ["mariadb-dump", "mysqldump"] as const;
