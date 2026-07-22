/**
 * Serialization for the archive index.
 *
 * Wire shape: NDJSON -> gzip -> (sealed with the archive's index subkey when encrypted).
 *
 * NDJSON rather than a JSON array because the index scales with file count, not data size:
 * half a million files is roughly 80 MB of JSON, and `JSON.parse` on that needs about a
 * gigabyte of heap. One object per line streams in constant memory instead.
 */

import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createGzip, createGunzip } from "zlib";
import { createInterface } from "readline";
import { openEntry, sealEntry, INDEX_ORDINAL } from "@/lib/crypto/entry-cipher";
import { ArchiveIndex, IndexEntryLine, IndexLine } from "./types";

/** Crypto parameters for the index, omitted for unencrypted archives. */
export interface IndexSealing {
    indexKey: Buffer;
    noncePrefix: Buffer;
}

/**
 * Serializes index lines to their on-disk representation.
 *
 * @param lines - Header line first, then entries, databases, directories and files
 * @param sealing - Present when the archive is encrypted
 */
export async function serializeIndex(lines: IndexLine[], sealing?: IndexSealing): Promise<Buffer> {
    const source = Readable.from(
        (function* () {
            for (const line of lines) yield `${JSON.stringify(line)}\n`;
        })()
    );

    const stages: NodeJS.ReadWriteStream[] = [createGzip()];
    if (sealing) {
        stages.push(sealEntry(sealing.indexKey, sealing.noncePrefix, INDEX_ORDINAL));
    }

    const chunks: Buffer[] = [];
    await pipeline(source, ...(stages as [NodeJS.ReadWriteStream]), async function* (result) {
        for await (const chunk of result) chunks.push(chunk as Buffer);
    });

    return Buffer.concat(chunks);
}

/**
 * Parses an index from its on-disk representation.
 *
 * A tampered or wrong-key index surfaces as a thrown authentication error rather than
 * partial output, so a caller can never act on a half-decrypted file list.
 *
 * @param bytes - Raw index bytes, from the sidecar or the archive's index member
 * @param sealing - Present when the archive is encrypted
 */
export async function parseIndex(bytes: Buffer, sealing?: IndexSealing): Promise<ArchiveIndex> {
    const stages: NodeJS.ReadWriteStream[] = [];
    if (sealing) {
        stages.push(openEntry(sealing.indexKey, sealing.noncePrefix, INDEX_ORDINAL));
    }
    stages.push(createGunzip());

    const index: ArchiveIndex = {
        header: { k: "h", v: 2, createdAt: "", archive: "" },
        entries: new Map<number, IndexEntryLine>(),
        databases: [],
        directories: [],
        files: [],
    };

    let sawHeader = false;

    await pipeline(
        Readable.from([bytes]),
        ...(stages as [NodeJS.ReadWriteStream]),
        async function* (decoded) {
            const reader = createInterface({ input: decoded as NodeJS.ReadableStream, crlfDelay: Infinity });
            for await (const line of reader) {
                if (line.length === 0) continue;
                const parsed = JSON.parse(line) as IndexLine;
                switch (parsed.k) {
                    case "h":
                        index.header = parsed;
                        sawHeader = true;
                        break;
                    case "e":
                        index.entries.set(parsed.n, parsed);
                        break;
                    case "db":
                        index.databases.push(parsed);
                        break;
                    case "d":
                        index.directories.push(parsed);
                        break;
                    case "f":
                        index.files.push(parsed);
                        break;
                }
            }
        }
    );

    if (!sawHeader) {
        throw new Error("Archive index is missing its header line");
    }

    return index;
}

/** Flattens a parsed index back into lines, preserving the canonical order. */
export function indexToLines(index: ArchiveIndex): IndexLine[] {
    return [
        index.header,
        ...[...index.entries.values()].sort((a, b) => a.n - b.n),
        ...index.databases,
        ...index.directories,
        ...index.files,
    ];
}
