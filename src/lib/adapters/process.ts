import { ChildProcess } from "child_process";

/**
 * Wraps a child process in a Promise that resolves on successful exit (code 0)
 * and rejects on error or non-zero exit code.
 * Also handles forwarding stderr to a log function.
 */
export function waitForProcess(
    child: ChildProcess,
    processName: string,
    onLog?: (msg: string) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (onLog && child.stderr) {
            child.stderr.on('data', (data) => {
                onLog(data.toString());
            });
        }

        child.on('error', (err) => {
            reject(new Error(`Failed to start ${processName}: ${err.message}`));
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${processName} exited with code ${code}`));
            }
        });
    });
}
