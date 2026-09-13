import type { Writable } from "stream";
import type { HostProcess } from "@/lib/transport/types";

/**
 * Wait until a dump tool has exited and its stdout has been flushed into the
 * file, then let the exit code decide the outcome.
 *
 * The two events race. A tool that fails at connect time closes stdout before
 * the exit code arrives, so the write stream finishes first. Settling on
 * finish alone reported that as a successful dump and shipped a 0 byte file
 * to every destination, where retention then pruned real backups around it.
 * Both events have to settle here before the code is even looked at.
 */
export async function awaitDumpProcess(
    proc: HostProcess,
    writeStream: Writable,
    label: string,
): Promise<void> {
    const written = new Promise<void>((resolve, reject) => {
        writeStream.on("error", reject);
        writeStream.on("finish", resolve);
    });

    let exit: { code: number | null; signal?: string };
    try {
        [exit] = await Promise.all([proc.exit(), written]);
    } catch (error) {
        writeStream.destroy();
        throw error;
    }

    if (exit.code !== 0) {
        writeStream.destroy();
        throw new Error(
            `${label} exited with code ${exit.code ?? "null"}${exit.signal ? ` (signal: ${exit.signal})` : ""}`,
        );
    }
}
