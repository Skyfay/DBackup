import { spawn, type ChildProcess } from "child_process";
import type { LogLevel, LogType } from "@/lib/core/logs";

/**
 * Starting the rsync program itself. It runs from an argument list without a shell, so a path
 * or file name is one argument whatever characters it holds. The npm package `rsync` this
 * replaces put everything into one `sh -c` command and escaped spaces and quotes, but not `;`,
 * `|`, `&` or a line break.
 */

type OnLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

/**
 * Strips sensitive data (passwords, keys, key paths) from command strings for safe logging.
 * IMPORTANT: Never log raw commands - always sanitize first.
 */
export function sanitizeCommand(cmd: string): string {
    return cmd
        .replace(/sshpass\s+-e\s+/g, "sshpass -e ")
        .replace(/sshpass\s+-p\s+'[^']*'/g, "sshpass -p '***'")
        .replace(/sshpass\s+-p\s+"[^"]*"/g, 'sshpass -p "***"')
        .replace(/sshpass\s+-p\s+\S+/g, "sshpass -p ***")
        .replace(/-i\s+\/[^\s]+/g, "-i ***")
        .replace(/SSHPASS=[^\s]+/g, "SSHPASS=***");
}

/**
 * How long a cancelled transfer is given to end itself before it is killed outright.
 *
 * SIGTERM lets rsync finish the file it is writing and close the SSH session, which is what
 * keeps `--partial` data usable and the remote socket from being left half-open. A transfer
 * blocked on a socket whose other end is gone never gets to handle the signal at all, so
 * without the escalation a cancel would wait out the TCP timeout instead of the grace period.
 */
export const ABORT_GRACE_MS = 5000;

/** The options of a connection, with its SSH command, and the environment that carries a password for sshpass. */
export interface RsyncCommand {
    args: string[];
    env?: NodeJS.ProcessEnv;
}

export interface RsyncTransfer {
    source: string;
    destination: string;
    /** Options of this one transfer, like the file list of a directory. */
    extra?: string[];
}

/** The lines of an output chunk, trimmed, without the empty ones. A chunk regularly carries several. */
function linesOf(data: Buffer): string[] {
    return data.toString().split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Runs one rsync transfer. stdout goes to `onLog` as info, stderr as warnings, sanitized.
 *
 * With a signal, the transfer is killable: rsync has no way to be asked to stop, so the
 * process is ended. Without one, nothing changes - a transfer runs to completion.
 */
export function runRsync(command: RsyncCommand, transfer: RsyncTransfer, onLog?: OnLog, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);

        let killTimer: NodeJS.Timeout | undefined;
        // Declared before the process starts, so the handler can be installed first. The kill
        // path is the one place that must not throw on a process that does not exist yet.
        let child: ChildProcess | undefined;
        // The cancel rejects at once and the process reports its end later, or a failed start
        // reports an error and then closes. Only the first of them decides the outcome.
        let settled = false;
        let lastError = "";

        /** Drops the handler and the escalation timer the cancel path installs. */
        const release = () => {
            signal?.removeEventListener("abort", onAbort);
            // The process ended on its own, so there is nothing left to escalate against.
            // A SIGKILL past this point would land on whatever reused the process id.
            if (killTimer) clearTimeout(killTimer);
        };

        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve();
        };

        const onAbort = () => {
            // SIGTERM first, so rsync closes the file it is writing and ends its SSH session.
            child?.kill("SIGTERM");
            killTimer = setTimeout(() => child?.kill("SIGKILL"), ABORT_GRACE_MS);
            // Unreferenced so a run already on its way out is not held open by a timer that
            // only exists for a process which has most likely already gone.
            killTimer.unref?.();

            // Rejected right here rather than waiting for the process to report its own
            // death. A cancel has to take effect now, and a child that cannot be reached at
            // all would otherwise leave the run waiting on a transfer nobody will hear from
            // again - which is the whole failure this exists to end.
            if (!settled) {
                settled = true;
                reject(signal!.reason);
            }
        };

        // Installed before the transfer starts, so a cancel arriving while rsync is being
        // spawned is not lost. The handler tolerates a child that does not exist yet.
        signal?.addEventListener("abort", onAbort, { once: true });

        // `--` ends the options, so a path that starts with a dash stays a path.
        const args = [...command.args, ...(transfer.extra ?? []), "--", transfer.source, transfer.destination];
        try {
            child = spawn("rsync", args, { env: command.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
            release();
            return finish(new Error(sanitizeCommand(error instanceof Error ? error.message : String(error))));
        }

        child.stdout?.on("data", (data: Buffer) => {
            if (!onLog) return;
            for (const line of linesOf(data)) onLog(line, "info", "storage");
        });

        child.stderr?.on("data", (data: Buffer) => {
            for (const line of linesOf(data)) {
                lastError = line;
                if (onLog) onLog(sanitizeCommand(`stderr: ${line}`), "warning", "storage");
            }
        });

        child.on("error", (error: NodeJS.ErrnoException) => {
            release();
            finish(new Error(error.code === "ENOENT" ? "rsync is not installed on this server." : sanitizeCommand(error.message)));
        });

        child.on("close", (code: number | null, exitSignal: NodeJS.Signals | null) => {
            release();
            // A transfer killed by the cancel exits with a signal. The promise already carries
            // the cancellation, so `finish` stays quiet instead of reporting a refused source.
            if (code === 0) return finish();
            const reason = lastError ? `: ${sanitizeCommand(lastError)}` : "";
            finish(new Error(code === null ? `rsync was stopped by ${exitSignal}${reason}` : `rsync exited with code ${code}${reason}`));
        });
    });
}
