/**
 * Byte sources for reading archives.
 *
 * The reader never learns whether it is talking to a local temp file or to a remote
 * storage adapter. That separation is what lets file-level restore use HTTP range requests
 * where an adapter supports them, and fall back to a sequential scan where it does not,
 * without either path leaking into the format logic.
 */

import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { ArchiveByteSource } from "./types";
import { DamagedBackupError } from "./limits";
import { createNoFollowReadStream } from "@/lib/server/no-follow";

/**
 * Reads an entire stream into a buffer.
 *
 * @param limit - The most bytes taken. A stream that carries more fails the read with a
 *   `DamagedBackupError` at that point, so content of a backup never grows the memory past it.
 */
export async function readAll(stream: NodeJS.ReadableStream, limit?: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of stream) {
        length += (chunk as Buffer).length;
        // Leaving the loop by a throw destroys the stream, so nothing more is read or inflated.
        if (limit !== undefined && length > limit) {
            throw new DamagedBackupError(`an entry holds more than the ${limit} bytes it may`);
        }
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

/** An empty range (end < start) is legal and yields no bytes - zero-length files hit this. */
function isEmptyRange(start: number, end: number): boolean {
    return end < start;
}

/**
 * Byte source over a local file, which has to be a regular file. The archive may be a download of
 * a storage a customer controls, so a link is never followed, neither by the look at its size nor
 * by a read, see `downloaded-file.ts`.
 */
export async function localFileSource(filePath: string): Promise<ArchiveByteSource> {
    const stats = await fs.lstat(filePath);
    if (!stats.isFile()) throw new Error(`The archive ${path.basename(filePath)} is no regular file`);
    return {
        size: stats.size,
        // createReadStream's `end` is inclusive, matching the interface contract.
        read: async (start: number, end: number) =>
            isEmptyRange(start, end) ? Readable.from([]) : createNoFollowReadStream(filePath, { start, end }),
    };
}

/** Byte source over an in-memory buffer. Used by tests and by small cached archives. */
export function bufferSource(buffer: Buffer): ArchiveByteSource {
    return {
        size: buffer.length,
        read: async (start: number, end: number) =>
            isEmptyRange(start, end) ? Readable.from([]) : Readable.from([buffer.subarray(start, end + 1)]),
    };
}
