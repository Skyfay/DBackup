import { spawn } from "child_process";

/**
 * Runs the Samba tools with the password in the environment instead of the argument vector.
 *
 * samba-client puts `--password <secret>` into the argv of smbclient, where every user of the
 * machine reads it in the process table, and a failed call echoes it in its message. smbclient and
 * rpcclient read the password from the `PASSWD` variable as well (Samba's own credentials handling,
 * checked against Samba 4.17 as the image ships it), so the password goes there and never into argv.
 * `-N` must not be passed with it, since it sets an empty password over the one of `PASSWD`.
 */

/** A failed call of smbclient, with its output like samba-client's execa failure carried it. */
export interface SmbclientFailure extends Error {
    /** stdout and stderr in the order smbclient wrote them. */
    all: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

/** The environment of a Samba tool: that of DBackup, with the password in `PASSWD` when there is one. */
export function sambaEnv(password: string | undefined): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    // One the environment of DBackup happens to carry is never sent to a share as its password.
    delete env.PASSWD;
    delete env.PASSWD_FD;
    delete env.PASSWD_FILE;
    if (password) env.PASSWD = password;
    return env;
}

/** Drops the one trailing line break, like execa did for samba-client. */
function stripFinalNewline(text: string): string {
    return text.replace(/\r?\n$/, "");
}

/**
 * Runs smbclient with `args` and answers its output, stdout and stderr together in the order it
 * wrote them, the way samba-client read it. stdin is closed, so a missing password fails at once
 * instead of waiting for a prompt.
 */
export function runSmbclient(args: string[], options: { cwd?: string; password?: string; signal?: AbortSignal } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        // An aborted signal kills smbclient, like a read that passed its limit, see `read-limit.ts`.
        const child = spawn("smbclient", args, {
            cwd: options.cwd || undefined,
            env: sambaEnv(options.password),
            stdio: ["ignore", "pipe", "pipe"],
            ...(options.signal ? { signal: options.signal } : {}),
        });
        const all: Buffer[] = [];
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => {
            stdout.push(chunk);
            all.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr.push(chunk);
            all.push(chunk);
        });
        child.once("error", reject);
        child.once("close", (code) => {
            const output = stripFinalNewline(Buffer.concat(all).toString("utf8"));
            if (code === 0) {
                resolve(output);
                return;
            }
            const failure = new Error(`smbclient failed with exit code ${code}: ${output}`) as SmbclientFailure;
            failure.all = output;
            failure.stdout = stripFinalNewline(Buffer.concat(stdout).toString("utf8"));
            failure.stderr = stripFinalNewline(Buffer.concat(stderr).toString("utf8"));
            failure.exitCode = code;
            reject(failure);
        });
    });
}
