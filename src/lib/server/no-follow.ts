import { constants, createReadStream, type ReadStream } from "fs";

/**
 * Flags that open a local file for reading without following a symbolic link as its last part.
 *
 * `O_NOFOLLOW` makes the open fail with `ELOOP` on a link, `O_NONBLOCK` keeps a named pipe from
 * waiting for a writer, and on a regular file it changes nothing. A platform without them reads
 * as before, the checks around the open stay in place there. Used by the readers of a file a
 * storage wrote, see `src/lib/adapters/storage/common/downloaded-file.ts`. A collected file of a
 * directory source has its own reader with the same flags, `src/lib/archive/collected-file.ts`.
 */
export const READ_NO_FOLLOW = readNoFollowFlags();

function readNoFollowFlags(): number {
    try {
        return (constants?.O_RDONLY ?? 0) | (constants?.O_NOFOLLOW ?? 0) | (constants?.O_NONBLOCK ?? 0);
    } catch {
        // A test that replaces `fs` and leaves `constants` out throws on reading it.
        return 0;
    }
}

/**
 * A read stream of a local file that never follows a link as its last part, see `READ_NO_FOLLOW`.
 * Node opens the stream with `fs.open`, which takes the flags as a number too, while the types of
 * the stream options name only a string.
 */
export function createNoFollowReadStream(filePath: string, options: { start?: number; end?: number; highWaterMark?: number } = {}): ReadStream {
    return createReadStream(filePath, { ...options, flags: READ_NO_FOLLOW as unknown as string });
}

/** Whether an error of an open says the path was a symbolic link: `ELOOP` on Linux and macOS, `EMLINK` on FreeBSD. */
export function isLinkRefusal(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === "ELOOP" || code === "EMLINK";
}
