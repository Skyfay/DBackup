import { Writable } from "stream";
import type { StorageReadOptions } from "@/lib/core/interfaces";

/**
 * Bounds on what `read()` and `readBytes()` of a storage adapter take into memory.
 *
 * The server of a destination may belong to a customer, and every tenant reads through the one
 * process they share. A `.meta.json` of a few gigabytes would otherwise be buffered whole, by the
 * hourly listing of every destination among others, so every read stops at a limit and fails with
 * `FileTooLargeError` past it, before the rest of the file is transferred.
 */

/**
 * What a read takes when its caller names no limit. A `.meta.json` holds the names of the databases
 * of one backup and a few fields per database, so even a server with thousands of databases stays
 * far below it.
 */
export const SIDECAR_READ_LIMIT = 8 * 1024 * 1024;

/**
 * A file of a destination larger than the read that asked for it takes. A plain `Error`, since the
 * adapters that throw it are loaded by suites that replace the module of the error classes.
 */
export class FileTooLargeError extends Error {
    public readonly code = "FILE_TOO_LARGE";
    public readonly limit: number;

    constructor(limit: number) {
        super(`The file is larger than the ${limit} bytes DBackup reads of it`);
        this.name = "FileTooLargeError";
        this.limit = limit;
    }
}

export function isFileTooLarge(error: unknown): error is FileTooLargeError {
    return error instanceof FileTooLargeError;
}

/** The limit of a read, `SIDECAR_READ_LIMIT` when the caller names none. */
export function readLimitOf(options?: StorageReadOptions): number {
    const limit = options?.maxBytes;
    return typeof limit === "number" && Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : SIDECAR_READ_LIMIT;
}

/** Refuses a file whose size the server reported up front, before any of it is transferred. */
export function assertReadSize(size: number | null | undefined, limit: number): void {
    if (typeof size === "number" && Number.isFinite(size) && size > limit) throw new FileTooLargeError(limit);
}

/**
 * Collects a stream into memory, at most `limit` bytes. The first chunk past the limit destroys the
 * stream, so the transfer stops there, and the call fails with `FileTooLargeError`.
 */
export function collectCapped(stream: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let settled = false;
        const finish = (error: Error | null) => {
            if (settled) return;
            settled = true;
            stream.removeListener("data", onData);
            if (error) reject(error);
            else resolve(Buffer.concat(chunks, total));
        };
        const onData = (chunk: Buffer | string) => {
            const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
            total += bytes.length;
            if (total > limit) {
                finish(new FileTooLargeError(limit));
                const destroyable = stream as NodeJS.ReadableStream & { destroy?: (error?: Error) => void };
                if (typeof destroyable.destroy === "function") destroyable.destroy();
                return;
            }
            chunks.push(bytes);
        };
        stream.on("data", onData);
        stream.once("end", () => finish(null));
        stream.once("error", (error: Error) => finish(error));
        stream.once("close", () => finish(settled ? null : new Error("The stream closed before it ended")));
    });
}

/**
 * A sink that keeps at most `limit` bytes, for a protocol client that writes into a stream of its
 * caller. Past the limit the sink fails with `FileTooLargeError`, which aborts the transfer.
 */
export function cappedSink(limit: number): { sink: Writable; bytes: () => Buffer; overflowed: () => boolean } {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;
    const sink = new Writable({
        write(chunk: Buffer, _encoding, done) {
            total += chunk.length;
            if (total > limit) {
                overflow = true;
                done(new FileTooLargeError(limit));
                return;
            }
            chunks.push(chunk);
            done();
        },
    });
    // The overflow reaches the caller through `overflowed()` and the failed transfer, so the error
    // event of the sink never goes unheard, whatever the client listens to.
    sink.on("error", () => undefined);
    return { sink, bytes: () => Buffer.concat(chunks), overflowed: () => overflow };
}

/** The text of a read, null for a file that is not there. */
export function textOf(bytes: Buffer | null): string | null {
    return bytes ? bytes.toString("utf-8") : null;
}
