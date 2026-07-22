/**
 * Low-level TAR block handling for the seekable archive format.
 *
 * Two capabilities live here that the high-level tar-stream API cannot provide:
 *
 * 1. **Exact payload offsets.** The archive index records where every entry's bytes start,
 *    and those offsets have to be byte-exact or a ranged restore silently returns garbage.
 *    Counting bytes as tar-stream emits them does not work: under backpressure an entry's
 *    `finish` event fires well before its bytes reach a downstream counter, which measures
 *    offsets that are wrong and can even go negative. Walking the finished file's headers
 *    is exact regardless of buffering, and costs one 512-byte read per member because the
 *    payloads are seeked over rather than read.
 * 2. **Appending the index member.** The index can only be built once every data offset is
 *    known, so it is written after the walk. Its name is a fixed short ASCII string, which
 *    makes a hand-written ustar header trivially correct - no PAX case to worry about.
 *
 * The walker is also what the Recovery Kit uses to locate the embedded index when the
 * sidecar is missing.
 */

import fs from "fs/promises";
import { TAR_BLOCK_SIZE, paddedSize } from "./format";

/** Two zero blocks mark end-of-archive. */
export const TAR_TRAILER = Buffer.alloc(TAR_BLOCK_SIZE * 2);

export interface TarMemberLocation {
    /** Member name, resolved through any PAX extended header. */
    name: string;
    /** Byte offset of the member's payload. */
    offset: number;
    /** Payload size in bytes. */
    size: number;
}

function readString(block: Buffer, start: number, length: number): string {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString("utf-8");
}

function readOctal(block: Buffer, start: number, length: number): number {
    const text = readString(block, start, length).trim();
    if (text.length === 0) return 0;
    const value = parseInt(text, 8);
    return Number.isNaN(value) ? 0 : value;
}

/**
 * Extracts the `path` value from a PAX extended header payload.
 * Records are `"<len> <key>=<value>\n"`.
 */
function parsePaxPath(payload: Buffer): string | null {
    const text = payload.toString("utf-8");
    let cursor = 0;
    while (cursor < text.length) {
        const space = text.indexOf(" ", cursor);
        if (space === -1) break;
        const recordLength = parseInt(text.slice(cursor, space), 10);
        if (!Number.isFinite(recordLength) || recordLength <= 0) break;
        const record = text.slice(space + 1, cursor + recordLength);
        const eq = record.indexOf("=");
        if (eq !== -1 && record.slice(0, eq) === "path") {
            return record.slice(eq + 1).replace(/\n$/, "");
        }
        cursor += recordLength;
    }
    return null;
}

/**
 * Walks a TAR file's headers and returns the location of every real member.
 *
 * Payloads are seeked over, so cost scales with member count rather than archive size.
 * PAX extended headers (emitted by tar-stream for names that do not fit the ustar layout)
 * are consumed and applied to the member that follows them, and never reported themselves.
 *
 * @param filePath - Path to the archive
 * @param stopAt - Optional member name to stop at, returned as the final element. Lets the
 * Recovery Kit locate the index without walking an entire multi-terabyte archive twice.
 */
export async function walkTarHeaders(filePath: string, stopAt?: string): Promise<TarMemberLocation[]> {
    const handle = await fs.open(filePath, "r");
    try {
        const stats = await handle.stat();
        const members: TarMemberLocation[] = [];
        const block = Buffer.alloc(TAR_BLOCK_SIZE);
        let position = 0;
        let pendingPaxPath: string | null = null;

        while (position + TAR_BLOCK_SIZE <= stats.size) {
            const { bytesRead } = await handle.read(block, 0, TAR_BLOCK_SIZE, position);
            if (bytesRead < TAR_BLOCK_SIZE) break;

            // A zero block marks end-of-archive.
            if (block.every((byte) => byte === 0)) break;

            const size = readOctal(block, 124, 12);
            const typeFlag = String.fromCharCode(block[156]);
            const dataOffset = position + TAR_BLOCK_SIZE;

            if (typeFlag === "x" || typeFlag === "X") {
                // PAX extended header - its payload names the member that follows.
                const payload = Buffer.alloc(size);
                await handle.read(payload, 0, size, dataOffset);
                pendingPaxPath = parsePaxPath(payload);
                position = dataOffset + paddedSize(size);
                continue;
            }

            if (typeFlag === "L") {
                // GNU long name - the payload is the name itself.
                const payload = Buffer.alloc(size);
                await handle.read(payload, 0, size, dataOffset);
                pendingPaxPath = payload.toString("utf-8").replace(/\0+$/, "");
                position = dataOffset + paddedSize(size);
                continue;
            }

            let name = pendingPaxPath ?? readString(block, 0, 100);
            if (pendingPaxPath === null) {
                const prefix = readString(block, 345, 155);
                if (prefix.length > 0) name = `${prefix}/${name}`;
            }
            pendingPaxPath = null;

            members.push({ name, offset: dataOffset, size });
            if (stopAt !== undefined && name === stopAt) break;

            position = dataOffset + paddedSize(size);
        }

        return members;
    } finally {
        await handle.close();
    }
}

/**
 * Builds a 512-byte ustar header.
 *
 * Only used for members whose name is a short ASCII constant, where the ustar layout
 * always applies and no PAX extension is needed. Callers must not pass arbitrary paths.
 */
export function buildUstarHeader(name: string, size: number): Buffer {
    if (Buffer.byteLength(name, "utf-8") > 100) {
        throw new Error(`Cannot build a ustar header for '${name}': names over 100 bytes need a PAX extension`);
    }

    const header = Buffer.alloc(TAR_BLOCK_SIZE);
    header.write(name, 0, 100, "utf-8");
    header.write("000644 \0", 100, 8, "utf-8");           // mode
    header.write("000000 \0", 108, 8, "utf-8");           // uid
    header.write("000000 \0", 116, 8, "utf-8");           // gid
    header.write(size.toString(8).padStart(11, "0") + " ", 124, 12, "utf-8");
    header.write("00000000000 ", 136, 12, "utf-8");       // mtime, fixed for reproducibility
    header.write("        ", 148, 8, "utf-8");            // checksum placeholder, spaces
    header.write("0", 156, 1, "utf-8");                   // typeflag: regular file
    header.write("ustar\0", 257, 6, "utf-8");
    header.write("00", 263, 2, "utf-8");

    // Checksum is the unsigned sum of all header bytes with the checksum field as spaces.
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");

    return header;
}

/** Zero padding that follows a payload of the given size. */
export function tarPadding(size: number): Buffer {
    return Buffer.alloc(paddedSize(size) - size);
}
