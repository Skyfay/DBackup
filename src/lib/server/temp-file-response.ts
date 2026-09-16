import fs from "fs";
import fsPromises from "fs/promises";
import { NextResponse } from "next/server";
import { attachmentDisposition } from "@/lib/server/content-disposition";

/**
 * Streams a temp file to the browser as a download and deletes it afterwards.
 *
 * The file is removed once it was sent, when reading it fails, and when the browser cancels
 * the download. The last case matters most for large files, which are the ones people abort.
 */
export function tempFileDownloadResponse(tempFile: string, fileName: string, contentType: string): NextResponse {
    const { size } = fs.statSync(tempFile);
    const fileStream = fs.createReadStream(tempFile);
    const removeTempFile = () => {
        fsPromises.unlink(tempFile).catch(() => { });
    };

    const body = new ReadableStream({
        start(controller) {
            fileStream.on("data", (chunk: Buffer | string) => controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
            fileStream.on("end", () => {
                controller.close();
                removeTempFile();
            });
            fileStream.on("error", (err) => {
                controller.error(err);
                removeTempFile();
            });
        },
        cancel() {
            fileStream.destroy();
            removeTempFile();
        },
    });

    return new NextResponse(body, {
        headers: {
            "Content-Disposition": attachmentDisposition(fileName),
            "Content-Type": contentType,
            "Content-Length": String(size),
        },
    });
}
