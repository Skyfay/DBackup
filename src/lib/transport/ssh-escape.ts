import type { ExecOptions } from "./types";

/**
 * Shell quoting for the SSH transport.
 *
 * This is the single place in the codebase that turns an argv array into a
 * command string. Adapters always hand over `string[]`, so a quoting bug can
 * only exist here, where one test suite covers it, instead of at every call site.
 */

/**
 * Wrap a value in single quotes so the remote shell treats it as one literal
 * argument.
 *
 * Inside single quotes every byte is literal, including backslashes, newlines,
 * `$`, and backticks. The only character that needs handling is the single
 * quote itself: close the string, emit an escaped quote, reopen.
 *
 *   a'b  ->  'a'\''b'
 */
export function shellEscape(value: string): string {
    if (value.includes("\0")) {
        // A NUL byte cannot survive a shell command line. Failing loudly beats
        // silently truncating an argument at the NUL.
        throw new Error("Argument contains a NUL byte and cannot be passed to a remote shell.");
    }
    return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Render environment values as `export K='v'` lines for a file the remote shell sources.
 *
 * The values never go into the command string itself. That string is the argument of
 * the remote login shell (`sh -c`, or `su - root -c` on NetBird), so anything in it shows
 * up in `ps` on the target for as long as the command runs. Returns null when nothing
 * is left to export.
 */
export function renderEnvFile(env: ExecOptions["env"] = {}): string | null {
    const exports = envExports(env);
    return exports.length > 0 ? exports.map((line) => `${line}\n`).join("") : null;
}

/** One `export K='v'` per value that is set, the name checked. A value may hold a newline, inside its quotes. */
function envExports(env: ExecOptions["env"] = {}): string[] {
    const exports: string[] = [];
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined || value === "") continue;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            throw new Error(`Invalid environment variable name: ${key}`);
        }
        exports.push(`export ${key}=${shellEscape(value)}`);
    }
    return exports;
}

/**
 * Render an argv array plus execution options into a single command string for
 * `ssh2.exec`.
 *
 * Layout is `. ENV_FILE && rm -f ENV_FILE && cd DIR && argv < STDIN_FILE`:
 *   - the environment comes from a 0600 file written by the caller (see
 *     `renderEnvFile`), never from the command string, so secrets stay out of the
 *     remote process list
 *   - the file is removed right after it is sourced and before the command starts,
 *     so a command that fails, hangs or is killed leaves nothing behind. When the
 *     shell never gets that far, the caller removes it
 *   - every step is joined with `&&`, so the command never runs without its
 *     environment or in the wrong directory
 *
 * `inlineEnv` is the last resort of a target where no file could be written, see
 * `SshHost.writeEnvFile`. Its values become `export K='v'; ` in front of the command,
 * as before the file, where the process list of the target shows them.
 */
export function buildRemoteCommand(
    argv: string[],
    options: Pick<ExecOptions, "cwd" | "stdinFile"> & { envFile?: string; inlineEnv?: ExecOptions["env"] } = {},
): string {
    if (argv.length === 0) {
        throw new Error("Cannot build a remote command from an empty argv array.");
    }

    let command = argv.map(shellEscape).join(" ");

    if (options.stdinFile) {
        command += ` < ${shellEscape(options.stdinFile)}`;
    }

    if (options.cwd) {
        command = `cd ${shellEscape(options.cwd)} && ${command}`;
    }

    if (options.envFile) {
        const file = shellEscape(options.envFile);
        command = `. ${file} && rm -f ${file} && ${command}`;
    } else if (options.inlineEnv) {
        // Joined with `; ` so they apply even if `cd` fails, as before the file.
        const exports = envExports(options.inlineEnv);
        if (exports.length > 0) command = `${exports.join("; ")}; ${command}`;
    }

    return command;
}
