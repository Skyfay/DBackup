/**
 * Byte sources for reading archives.
 *
 * The reader never learns whether it is talking to a local temp file or to a remote
 * storage adapter. That separation is what lets file-level restore use HTTP range requests
 * where an adapter supports them, and fall back to a sequential scan where it does not,
 * without either path leaking into the format logic.
 */

import fs from "fs/promises";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { ArchiveByteSource } from "./types";

/** Reads an entire stream into a buffer. */
export async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

/** An empty range (end < start) is legal and yields no bytes - zero-length files hit this. */
function isEmptyRange(start: number, end: number): boolean {
    return end < start;
}

/** Byte source over a local file. */
export async function localFileSource(filePath: string): Promise<ArchiveByteSource> {
    const stats = await fs.stat(filePath);
    return {
        size: stats.size,
        // createReadStream's `end` is inclusive, matching the interface contract.
        read: async (start: number, end: number) =>
            isEmptyRange(start, end) ? Readable.from([]) : createReadStream(filePath, { start, end }),
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
