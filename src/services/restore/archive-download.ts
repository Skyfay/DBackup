/**
 * Downloads out of a seekable archive: one database dump on its own, or any selection of
 * files and dumps as a tar.gz.
 *
 * A single dump is served as the dump itself, decrypted and decompressed, fetched by byte
 * range. Downloading one database out of a server holding hundreds therefore reads that
 * database's bytes from the destination and nothing else.
 */

import path from "path";
import crypto from "crypto";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { Transform, TransformCallback } from "stream";
import { pipeline } from "stream/promises";
import { openArchiveEntry } from "@/lib/archive/reader";
import { hashingStream } from "@/lib/archive/hashing";
import { databaseDownloadFileName } from "@/lib/archive/dump-names";
import { entryKey, type IndexDatabaseLine } from "@/lib/archive/types";
import { ValidationError } from "@/lib/logging/errors";
import type { KeyOverride } from "@/services/backup/key-resolution";
import { downloadShape, resolveContents } from "./archive-selection";
import { describeSelection, openArchiveForRestore, streamFileRestore, type FileRestoreInput, type FileRestorePlan } from "./file-restore";

export interface ArchiveDownload {
    stream: NodeJS.ReadableStream;
    fileName: string;
    contentType: string;
    /** Known for a single dump, whose plaintext size the index records. */
    contentLength?: number;
}

/**
 * Passes bytes through while hashing them, holding the last chunk back until the digest has
 * been checked.
 *
 * A single dump is sent with its exact Content-Length, so a client that received every byte
 * would accept the file even if the stream errored afterwards. Holding the final chunk means
 * a mismatch leaves the response short, and the client sees a failed download instead of a
 * corrupt dump that looks complete.
 */
export function verifyingStream(expectedSha256?: string): Transform {
    const hash = crypto.createHash("sha256");
    let held: Buffer | null = null;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
            hash.update(chunk);
            const release = held;
            held = chunk;
            callback(null, release ?? undefined);
        },
        flush(callback: TransformCallback) {
            const digest = hash.digest("hex");
            if (expectedSha256 && digest !== expectedSha256) {
                callback(new Error("Database dump does not match its recorded checksum - the archive is corrupt"));
                return;
            }
            if (held) this.push(held);
            callback();
        },
    });
}

/** The archive's name without its extension, for naming a tar.gz of its contents. */
function archiveStem(file: string): string {
    return path.basename(file).replace(/\.[^.]+$/, "");
}

/**
 * Name of the tar.gz a selection downloads as. Decided by the request alone, so the prepare
 * step and the download it hands off to always agree.
 */
function tarDownloadName(file: string, input: FileRestoreInput): string {
    const filesOnly = (input.selections?.length ?? 0) > 0 && (input.databases?.length ?? 0) === 0;
    return `${archiveStem(file)}-${filesOnly ? "files" : "contents"}.tar.gz`;
}

/**
 * Resolves a download without starting it, for the prepare step.
 *
 * Validating here is what makes a prepared link safe to hand to the browser: an unknown
 * database or a broken chain fails as a readable message instead of halfway into a download.
 */
export async function planArchiveDownload(
    input: FileRestoreInput
): Promise<FileRestorePlan & { fileName: string; contentType: string }> {
    const archive = await openArchiveForRestore(input.storageConfigId, input.file, input.keyOverride);
    try {
        const plan = describeSelection(archive, input);
        if (plan.fileCount === 0 && plan.databaseCount === 0) {
            throw new ValidationError("Nothing matched the selection", { field: "selections" });
        }
        if (plan.output === "dump") {
            const [database] = resolveContents(archive.index, input).databases;
            return { ...plan, fileName: databaseDownloadFileName(input.file, database.name, database.format), contentType: "application/octet-stream" };
        }
        return { ...plan, fileName: tarDownloadName(input.file, input), contentType: "application/gzip" };
    } finally {
        await archive.dispose();
    }
}

/** Opens a download of the request, streamed and ready to hand to a response. */
export async function openArchiveDownload(input: FileRestoreInput): Promise<ArchiveDownload> {
    if (downloadShape(input) === "tar") {
        const stream = await streamFileRestore(input);
        return { stream, fileName: tarDownloadName(input.file, input), contentType: "application/gzip" };
    }

    const archive = await openArchiveForRestore(input.storageConfigId, input.file, input.keyOverride);
    try {
        const [database] = resolveContents(archive.index, input).databases;
        const entry = archive.index.entries.get(entryKey(undefined, database.n));
        if (!entry) throw new Error(`Archive index is inconsistent: database '${database.name}' has no entry`);

        const content = await openArchiveEntry(archive.source, archive.manifest, entry, archive.masterKey);
        const verified = verifyingStream(database.h);
        // The archive stays open for as long as the response reads from it, and is released
        // on every way the stream can end, including a client that disconnects midway.
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            void archive.dispose();
        };
        verified.on("end", release);
        verified.on("close", release);
        verified.on("error", release);
        pipeline(content, verified).catch(() => { /* surfaced on verified */ });

        return {
            stream: verified,
            fileName: databaseDownloadFileName(input.file, database.name, database.format),
            contentType: "application/octet-stream",
            contentLength: database.s,
        };
    } catch (e: unknown) {
        await archive.dispose();
        throw e;
    }
}

/**
 * Picks the database a decrypted download of a whole backup means.
 *
 * Without a name that is only unambiguous for a backup holding exactly one database and no
 * files, which is every single-database job. Anything else has to say which one.
 */
function pickDatabase(databases: IndexDatabaseLine[], hasDirectories: boolean, name?: string): IndexDatabaseLine {
    if (name) {
        const line = databases.find((d) => d.name === name);
        if (!line) throw new ValidationError(`This backup does not contain the database: ${name}`, { field: "database" });
        return line;
    }
    if (databases.length === 1 && !hasDirectories) return databases[0];

    throw new ValidationError(
        databases.length === 0
            ? "This backup holds no database dump. Download its contents as a .tar.gz instead."
            : `This backup holds ${databases.length} database(s)${hasDirectories ? " and files" : ""}. Name the database to download, or download the contents as a .tar.gz.`,
        { field: "database" }
    );
}

/**
 * Writes one decrypted, decompressed dump to a local file.
 *
 * This is what a decrypted download of a seekable archive resolves to, including a wget link,
 * which needs the finished file on disk before it can send a Content-Length. A dump that fails
 * its checksum is deleted rather than left for the caller to serve.
 */
export async function writeDatabaseDump(
    params: { storageConfigId: string; file: string; database?: string; keyOverride?: KeyOverride },
    localPath: string
): Promise<{ fileName: string }> {
    const archive = await openArchiveForRestore(params.storageConfigId, params.file, params.keyOverride);
    try {
        const database = pickDatabase(archive.index.databases, archive.index.directories.length > 0, params.database);
        const entry = archive.index.entries.get(entryKey(undefined, database.n));
        if (!entry) throw new Error(`Archive index is inconsistent: database '${database.name}' has no entry`);

        let digest: string | undefined;
        await pipeline(
            await openArchiveEntry(archive.source, archive.manifest, entry, archive.masterKey),
            hashingStream((d) => { digest = d; }),
            createWriteStream(localPath)
        );
        if (database.h && digest !== database.h) {
            await fs.unlink(localPath).catch(() => { });
            throw new Error(`Database dump '${database.name}' does not match its recorded checksum - the archive is corrupt`);
        }

        return { fileName: databaseDownloadFileName(params.file, database.name, database.format) };
    } finally {
        await archive.dispose();
    }
}
