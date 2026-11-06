import type { ExecutionHost } from "@/lib/transport";
import { AdapterError } from "@/lib/logging/errors";
import { NO_LOCAL_INFILE, runsBesideDBackup } from "./args";

/**
 * The client options that keep a dump from acting on the machine the client runs on. A dump comes
 * from the storage of its tenant, which may have written it itself, and in direct mode the client
 * runs beside DBackup's own data. The mysql and mariadb clients read lines of a dump as commands of
 * their own, outside of quotes and at any place of a line:
 *
 * - `system` and `\!` run a shell command.
 * - `source` and `\.` read a file of that machine and run it, so its lines come back in the errors
 *   of the server, which the log of the restore shows.
 * - `tee` and `\T` write the output to a file of that machine, `pager`, `\P`, `edit` and `\e` run
 *   another program.
 * - `LOAD DATA LOCAL INFILE` sends a file of that machine to the server.
 *
 * `--binary-mode` turns off every client command but `charset` and `delimiter` while the client reads
 * a file. Checked with MariaDB 10.11 and 11.8 and MySQL 8.0: a command comes back as an unknown
 * command, its line goes to the server as text and fails there, which ends the restore. A dump of mysqldump or mariadb-dump needs no other command, its
 * `DELIMITER` lines keep working, and the line of a newer mariadb-dump that turns the sandbox on is
 * read as a comment. `--sandbox` (MariaDB 10.5.25, 10.6.18, 10.11.8, 11.4.2) and
 * `--skip-system-command` (MySQL 8.0.40, 8.4.3) turn the shell commands off a second time.
 * `--local-infile=0` keeps the files of the machine away from the server.
 *
 * The help of the client says which options it knows. A filter of the dump stream cannot do the same
 * reliably, since a backslash command works anywhere outside of quotes, not only at the start of a
 * line, and only the parser of the client knows where its quotes end.
 */

/** What someone reads whose client beside DBackup cannot be locked down. */
export const UNLOCKED_CLIENT_REFUSED = "cannot turn off the shell and file commands a dump may hold, and it would run them on the server DBackup runs on, so the restore was not started. "
    + "Install MariaDB client 10.5.25, 10.6.18, 10.11.8, 11.4.2 or newer, or MySQL client 8.0.40, 8.4.3 or newer, or run the DBackup Docker image, which ships one.";

/** Whether the help of a client lists an option, at the start of a line rather than in the words of another one. */
const knows = (help: string, option: string) => new RegExp(`^\\s*${option}\\b`, "m").test(help);

/** The first line of the version of a client, for the message that refuses it. */
async function versionOf(host: ExecutionHost, mysqlBin: string): Promise<string> {
    try {
        const result = await host.exec([mysqlBin, "--version"]);
        const line = result.stdout.trim().split("\n")[0]?.trim();
        return result.code === 0 && line ? line : `${mysqlBin}, version unknown`;
    } catch {
        return `${mysqlBin}, version unknown`;
    }
}

/**
 * The options that lock the client down, see the module. A client beside DBackup (direct mode) that
 * knows neither `--sandbox` nor `--system-command`, or no `--binary-mode`, is refused before it reads
 * the dump. Over SSH the client runs on the server of the connection, which belongs to whoever set
 * the connection up, so an older client there restores with whatever of the lock it knows, as before.
 *
 * @throws AdapterError in direct mode for a client that cannot be locked down, naming its version.
 */
export async function lockedDownClientArgs(host: ExecutionHost, mysqlBin: string): Promise<string[]> {
    const args = [NO_LOCAL_INFILE];
    let help = "";
    try {
        const result = await host.exec([mysqlBin, "--help"]);
        if (result.code === 0) help = result.stdout;
    } catch {
        // A client that cannot describe itself knows none of the options below.
    }
    const binary = knows(help, "--binary-mode");
    if (binary) args.push("--binary-mode");
    const shell = knows(help, "--sandbox") ? "--sandbox" : knows(help, "--system-command") ? "--skip-system-command" : null;
    if (shell) args.push(shell);
    if ((!binary || !shell) && runsBesideDBackup(host)) {
        throw new AdapterError("mysql", "restore", `The client ${await versionOf(host, mysqlBin)} ${UNLOCKED_CLIENT_REFUSED}`);
    }
    return args;
}
