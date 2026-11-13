import { createFakeHost, type FakeHost, type FakeHostOptions } from "@/lib/testing/fake-host";

/** The start of the help of a client, as `mysql --help` prints its options. */
export const clientHelp = (...options: string[]) =>
    `Usage: mysql [OPTIONS] [database]\n${options.map((option) => `  ${option}    Some words`).join("\n")}\n`;

/** What a MariaDB client of the Docker image lists, and what a MySQL 8 client lists instead. */
export const MARIADB_HELP = clientHelp("--binary-mode", "--default-character-set=name", "--sandbox");
export const MYSQL_HELP = clientHelp("--binary-mode", "--default-character-set=name", "--system-command");

/**
 * A fake host whose client answers `--help`, which a call with a name of a request asks first, see
 * `queryClientArgs`. Every other call goes to `onExec` of the test as before.
 */
export function clientHost(options: FakeHostOptions = {}, help = MARIADB_HELP): FakeHost {
    return createFakeHost({
        ...options,
        onExec: (argv, execOptions) => argv.includes("--help") ? { stdout: help, code: 0 } : options.onExec?.(argv, execOptions),
    });
}

/** The calls that talk to the server, without the questions that tell the client apart. */
export const statements = (host: FakeHost) =>
    host.calls.exec.filter((argv) => !argv.includes("--help") && !argv.includes("--version"));
