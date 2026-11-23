/**
 * A ZIP writer that stores its entries as they are, without compression, and streams them.
 *
 * Built for the download of an older encrypted backup with its `.meta.json` beside it: the backup
 * is ciphertext, which no compression shrinks, and it may be many gigabytes. AdmZip read the whole
 * file into memory and deflated it on the event loop, which stopped every request of every tenant
 * for as long as that took. Here a file is read twice as a stream, once for its CRC-32 and once
 * into the ZIP, so the sizes and the checksum stand in the local header and no data descriptor is
 * needed. An entry or an archive past 4 GB gets the ZIP64 fields every current unzip tool reads.
 */

import { createWriteStream } from "fs";
import fs from "fs/promises";
import { crc32 } from "zlib";
import { once } from "events";
import { createNoFollowReadStream } from "@/lib/server/no-follow";

/** One member of the ZIP: a local file, read without following a link, or bytes in memory. */
export type StoreZipEntry = { name: string; file: string } | { name: string; data: Buffer };

const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
/** General purpose flag bit 11: the name is UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const VERSION_PLAIN = 20;
const VERSION_ZIP64 = 45;

interface WrittenEntry {
    name: Buffer;
    crc: number;
    size: number;
    offset: number;
}

/** MS-DOS time and date of a moment, the only timestamp a plain ZIP header holds. */
function dosDateTime(date: Date): { time: number; date: number } {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
}

/** CRC-32 and size of an entry, a file read as a stream without following a link. */
async function measure(entry: StoreZipEntry): Promise<{ crc: number; size: number }> {
    if ("data" in entry) return { crc: crc32(entry.data), size: entry.data.length };
    let crc = 0;
    let size = 0;
    for await (const chunk of createNoFollowReadStream(entry.file)) {
        crc = crc32(chunk as Buffer, crc);
        size += (chunk as Buffer).length;
    }
    return { crc, size };
}

/** A ZIP64 extra field holding the given 64-bit values, in the order the format asks for them. */
function zip64Extra(values: number[]): Buffer {
    const extra = Buffer.alloc(4 + values.length * 8);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(values.length * 8, 2);
    values.forEach((value, i) => extra.writeBigUInt64LE(BigInt(value), 4 + i * 8));
    return extra;
}

/**
 * Writes `entries` into a new ZIP at `destination`, each stored without compression.
 *
 * A file entry is read without following a link and has to keep its size between the two reads,
 * or the write fails rather than producing a ZIP whose header lies. The destination is replaced
 * when it exists, like `AdmZip.writeZip` did. On a failure the partial file is removed.
 */
export async function writeStoreZip(destination: string, entries: readonly StoreZipEntry[]): Promise<void> {
    const out = createWriteStream(destination);
    // Kept here, so an error of the file between two awaits fails the next write rather than the process.
    let failure: unknown;
    out.on("error", (error) => { failure ??= error; });
    let offset = 0;
    const write = async (chunk: Buffer) => {
        if (failure) throw failure;
        offset += chunk.length;
        if (!out.write(chunk)) await once(out, "drain");
    };
    const { time, date } = dosDateTime(new Date());
    const written: WrittenEntry[] = [];

    try {
        await once(out, "open");
        for (const entry of entries) {
            const name = Buffer.from(entry.name, "utf8");
            if (name.length > MAX_16) throw new Error("A name in the ZIP is too long");
            const { crc, size } = await measure(entry);
            const localOffset = offset;
            const zip64 = size >= MAX_32;

            const extra = zip64 ? zip64Extra([size, size]) : Buffer.alloc(0);
            const header = Buffer.alloc(30);
            header.writeUInt32LE(0x04034b50, 0);
            header.writeUInt16LE(zip64 ? VERSION_ZIP64 : VERSION_PLAIN, 4);
            header.writeUInt16LE(FLAG_UTF8, 6);
            header.writeUInt16LE(METHOD_STORE, 8);
            header.writeUInt16LE(time, 10);
            header.writeUInt16LE(date, 12);
            header.writeUInt32LE(crc >>> 0, 14);
            header.writeUInt32LE(zip64 ? MAX_32 : size, 18);
            header.writeUInt32LE(zip64 ? MAX_32 : size, 22);
            header.writeUInt16LE(name.length, 26);
            header.writeUInt16LE(extra.length, 28);
            await write(Buffer.concat([header, name, extra]));

            if ("data" in entry) {
                await write(entry.data);
            } else {
                let copied = 0;
                for await (const chunk of createNoFollowReadStream(entry.file)) {
                    copied += (chunk as Buffer).length;
                    if (copied > size) break;
                    await write(chunk as Buffer);
                }
                if (copied !== size) throw new Error("A file changed while it was written into the ZIP");
            }
            written.push({ name, crc, size, offset: localOffset });
        }

        const centralStart = offset;
        for (const entry of written) {
            const sizes64 = entry.size >= MAX_32;
            const offset64 = entry.offset >= MAX_32;
            const values = [...(sizes64 ? [entry.size, entry.size] : []), ...(offset64 ? [entry.offset] : [])];
            const extra = values.length > 0 ? zip64Extra(values) : Buffer.alloc(0);
            const version = values.length > 0 ? VERSION_ZIP64 : VERSION_PLAIN;

            const header = Buffer.alloc(46);
            header.writeUInt32LE(0x02014b50, 0);
            header.writeUInt16LE(version, 4);
            header.writeUInt16LE(version, 6);
            header.writeUInt16LE(FLAG_UTF8, 8);
            header.writeUInt16LE(METHOD_STORE, 10);
            header.writeUInt16LE(time, 12);
            header.writeUInt16LE(date, 14);
            header.writeUInt32LE(entry.crc >>> 0, 16);
            header.writeUInt32LE(sizes64 ? MAX_32 : entry.size, 20);
            header.writeUInt32LE(sizes64 ? MAX_32 : entry.size, 24);
            header.writeUInt16LE(entry.name.length, 28);
            header.writeUInt16LE(extra.length, 30);
            // Comment length, disk number, internal attributes stay 0.
            // External attributes: a regular file readable by its owner and group (0o640 << 16).
            header.writeUInt32LE((0o100640 << 16) >>> 0, 38);
            header.writeUInt32LE(offset64 ? MAX_32 : entry.offset, 42);
            await write(Buffer.concat([header, entry.name, extra]));
        }
        const centralSize = offset - centralStart;

        const needs64 = centralStart >= MAX_32 || centralSize >= MAX_32 || written.length >= MAX_16;
        if (needs64) {
            const record64Offset = offset;
            const record = Buffer.alloc(56);
            record.writeUInt32LE(0x06064b50, 0);
            record.writeBigUInt64LE(BigInt(44), 4);
            record.writeUInt16LE(VERSION_ZIP64, 12);
            record.writeUInt16LE(VERSION_ZIP64, 14);
            record.writeBigUInt64LE(BigInt(written.length), 24);
            record.writeBigUInt64LE(BigInt(written.length), 32);
            record.writeBigUInt64LE(BigInt(centralSize), 40);
            record.writeBigUInt64LE(BigInt(centralStart), 48);
            const locator = Buffer.alloc(20);
            locator.writeUInt32LE(0x07064b50, 0);
            locator.writeBigUInt64LE(BigInt(record64Offset), 8);
            locator.writeUInt32LE(1, 16);
            await write(Buffer.concat([record, locator]));
        }

        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(needs64 ? MAX_16 : written.length, 8);
        end.writeUInt16LE(needs64 ? MAX_16 : written.length, 10);
        end.writeUInt32LE(needs64 ? MAX_32 : centralSize, 12);
        end.writeUInt32LE(needs64 ? MAX_32 : centralStart, 16);
        await write(end);

        out.end();
        await once(out, "finish");
    } catch (error) {
        out.destroy();
        await fs.unlink(destination).catch(() => { });
        throw error;
    }
}
