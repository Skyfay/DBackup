import crypto from "crypto";
import fs from "fs/promises";
import { constants, type Stats } from "fs";
import type { FileHandle } from "fs/promises";
import { PassThrough, pipeline } from "stream";
import { inside } from "@/lib/server/real-path";
import { CollectedPathError, resolveCollectedPath } from "./collected-paths";

/**
 * Reads a collected file of a directory source, and only a regular file inside the collection folder.
 *
 * The listing of a source names the files, see `collected-paths.ts`, and the collection lays them
 * into the folder of the run. Whatever ended up there is read only through `openCollectedFile`:
 * a symbolic link is never followed (a link of the source is packed from its target string), a
 * device, a named pipe or a socket is refused before it is opened, and a file whose real path leads
 * out of the folder, through a folder of the collection that is a link, is refused too. The hash of
 * the collection and the archive writer both read through it, so a link swapped in between the
 * two is not followed either.
 */

/**
 * `O_NOFOLLOW` refuses a link as the last part of the path, `O_NONBLOCK` keeps a named pipe swapped
 * in after the check from waiting for a writer. Platforms without them are covered by the checks
 * of the opened handle below.
 */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** What a path is, for the run log, when it is no regular file. */
function kindOf(stats: Stats): string {
    if (stats.isSymbolicLink()) return "a symbolic link";
    if (stats.isDirectory()) return "a folder";
    if (stats.isBlockDevice() || stats.isCharacterDevice()) return "a device";
    if (stats.isFIFO()) return "a named pipe";
    if (stats.isSocket()) return "a socket";
    return "no regular file";
}

/**
 * The real path of the file a handle reads. Linux names it under `/proc/self/fd`, whatever happened
 * to the path since it was opened. Elsewhere the path is resolved again and has to still lead to the
 * file the handle holds.
 */
async function openedPath(handle: FileHandle, target: string, relativePath: string): Promise<string> {
    if (process.platform === "linux") {
        const named = await fs.readlink(`/proc/self/fd/${handle.fd}`).catch(() => null);
        if (named?.startsWith("/")) return named;
    }
    const real = await fs.realpath(target);
    const [now, opened] = await Promise.all([fs.stat(real), handle.stat()]);
    if (now.dev !== opened.dev || now.ino !== opened.ino) {
        throw new CollectedPathError(relativePath, "the file changed while it was read");
    }
    return real;
}

/**
 * Opens a collected file for reading.
 *
 * @param root The collection folder of the source.
 * @param relativePath The name of the file as the source listed it.
 * @throws CollectedPathError when the name or what lies there may not be read, any other error of
 * the file system as it is.
 */
export async function openCollectedFile(root: string, relativePath: string): Promise<FileHandle> {
    const target = resolveCollectedPath(root, relativePath);
    const realRoot = await fs.realpath(root);

    // Looked at without following first, since opening a device can act on it.
    const before = await fs.lstat(target);
    if (!before.isFile()) throw new CollectedPathError(relativePath, `it is ${kindOf(before)}`);

    let handle: FileHandle;
    try {
        handle = await fs.open(target, OPEN_FLAGS);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // ELOOP on Linux and macOS, EMLINK on FreeBSD: the name became a link after the look above.
        if (code === "ELOOP" || code === "EMLINK") throw new CollectedPathError(relativePath, "it is a symbolic link");
        throw error;
    }

    try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
            throw new CollectedPathError(relativePath, "the file changed while it was read");
        }
        if (!inside(await openedPath(handle, target, relativePath), realRoot)) {
            throw new CollectedPathError(relativePath, "it leads out of the collection folder");
        }
        return handle;
    } catch (error) {
        await handle.close().catch(() => { });
        throw error;
    }
}

/** Runs `fn` on an open collected file and closes it afterwards. */
async function withCollectedFile<T>(root: string, relativePath: string, fn: (handle: FileHandle) => Promise<T>): Promise<T> {
    const handle = await openCollectedFile(root, relativePath);
    try {
        return await fn(handle);
    } finally {
        await handle.close().catch(() => { });
    }
}

/** The size of a collected file. */
export function collectedFileSize(root: string, relativePath: string): Promise<number> {
    return withCollectedFile(root, relativePath, async (handle) => (await handle.stat()).size);
}

/** The whole content of a collected file. */
export function readCollectedFile(root: string, relativePath: string): Promise<Buffer> {
    return withCollectedFile(root, relativePath, (handle) => handle.readFile());
}

/**
 * The whole content of a collected file of at most `maxBytes`, for the small files the archive
 * bundles, or null for a larger one. The size comes from the opened file, never from the listing
 * of the source, and the read takes one byte past the limit at most, so a file that grew since it
 * was hashed is never read whole into memory.
 */
export function readSmallCollectedFile(root: string, relativePath: string, maxBytes: number): Promise<Buffer | null> {
    return withCollectedFile(root, relativePath, async (handle) => {
        if ((await handle.stat()).size > maxBytes) return null;
        const buffer = Buffer.alloc(maxBytes + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
            if (bytesRead === 0) break;
            length += bytesRead;
        }
        return length > maxBytes ? null : buffer.subarray(0, length);
    });
}

/** What the hash of a collected file found: its SHA-256 and how many bytes it holds. */
export interface CollectedFileHash {
    checksum: string;
    /** The bytes read for the hash, the size of the file as it lies here, whatever the listing said. */
    size: number;
}

/** The SHA-256 and the real size of a collected file, read in pieces of 1 MB. */
export function hashCollectedFile(root: string, relativePath: string): Promise<CollectedFileHash> {
    return withCollectedFile(root, relativePath, (handle) => new Promise<CollectedFileHash>((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        let size = 0;
        const stream = handle.createReadStream({ highWaterMark: 1024 * 1024, autoClose: false });
        stream.on("data", (chunk: Buffer | string) => {
            size += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
            hash.update(chunk);
        });
        stream.on("end", () => resolve({ checksum: hash.digest("hex"), size }));
        stream.on("error", reject);
    }));
}

/**
 * The content of a collected file as a stream, opened through `openCollectedFile` once it is read.
 * A refusal or a failed read surfaces as an error of the stream.
 */
export function streamCollectedFile(root: string, relativePath: string): NodeJS.ReadableStream {
    const out = new PassThrough();
    openCollectedFile(root, relativePath).then(
        // The read stream closes the handle when it ends or fails.
        (handle) => pipeline(handle.createReadStream(), out, () => { /* surfaced on out */ }),
        (error: unknown) => out.destroy(error instanceof Error ? error : new Error(String(error))),
    );
    return out;
}
