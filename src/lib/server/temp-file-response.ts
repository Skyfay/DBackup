import fs from "fs";
import fsPromises from "fs/promises";
import { attachmentDisposition } from "@/lib/server/content-disposition";
import { isLinkRefusal, READ_NO_FOLLOW } from "@/lib/server/no-follow";

/**
 * Streams a temp file to the browser as a download and deletes it afterwards.
 *
 * The file is removed once it was sent, when reading it fails, and when the browser cancels
 * the download. The last case matters most for large files, which are the ones people abort.
 */
export function tempFileDownloadResponse(
    tempFile: string,
    fileName: string,
    contentType: string,
    /** Hands the caller the stream of the file, for one that has to know when it ended or broke off. */
    onStream?: (stream: fs.ReadStream) => void
): Response {
    // Opened without following a link and checked on the handle, so a temp file a storage left as
    // a link to a file of this server is never sent, see `downloaded-file.ts`.
    let fd: number;
    try {
        fd = fs.openSync(tempFile, READ_NO_FOLLOW);
    } catch (error) {
        fsPromises.unlink(tempFile).catch(() => { });
        throw isLinkRefusal(error) ? new Error("The downloaded file is a symbolic link and is not sent") : error;
    }
    const stats = fs.fstatSync(fd);
    if (!stats.isFile()) {
        fs.closeSync(fd);
        fsPromises.rm(tempFile, { recursive: true, force: true }).catch(() => { });
        throw new Error("The downloaded file is no regular file and is not sent");
    }
    const { size } = stats;
    const fileStream = fs.createReadStream(tempFile, { fd });
    onStream?.(fileStream);
    const removeTempFile = () => {
        fsPromises.unlink(tempFile).catch(() => { });
    };

    // Pulled one chunk at a time, so a client that reads slowly holds back the reads of the file
    // instead of leaving a backup of gigabytes in the memory of the process every tenant shares.
    // The read stream keeps at most its own buffer of 64 KB ahead, the body at most one chunk.
    const chunks: AsyncIterator<Buffer | string> = fileStream[Symbol.asyncIterator]();
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const next = await chunks.next();
                if (next.done) {
                    controller.close();
                    removeTempFile();
                    return;
                }
                controller.enqueue(typeof next.value === "string" ? Buffer.from(next.value) : next.value);
            } catch (err) {
                controller.error(err);
                removeTempFile();
            }
        },
        cancel() {
            fileStream.destroy();
            removeTempFile();
        },
    });

    return new Response(body, {
        headers: {
            "Content-Disposition": attachmentDisposition(fileName),
            "Content-Type": contentType,
            "Content-Length": String(size),
        },
    });
}
