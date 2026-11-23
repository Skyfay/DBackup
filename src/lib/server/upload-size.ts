/** Room for the boundaries and the headers of a multipart form around its one file. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/** The largest body a form with one file of at most `maxFileBytes` takes, the form around it included. */
export function formLimitFor(maxFileBytes: number): number {
    return maxFileBytes + FORM_OVERHEAD_BYTES;
}

/** What `readFormWithin` read: the form, or none, as one too large or one that is no form. */
export type UploadedForm = { form: FormData; tooLarge: false } | { form: null; tooLarge: boolean };

/** Stops the read of a body once it passed the limit, whatever its headers announced. */
class BodyTooLargeError extends Error {}

/**
 * The form of an upload, read only while its body stays within `maxBodyBytes`. A body that
 * announces more is refused before a byte is read. One without a Content-Length, sent in chunks,
 * is counted as it arrives and cut off past the limit, so neither ever lands in memory in full.
 */
export async function readFormWithin(req: Request, maxBodyBytes: number): Promise<UploadedForm> {
    const announced = req.headers.get("content-length");
    if (announced !== null && Number(announced) > maxBodyBytes) return { form: null, tooLarge: true };
    if (!req.body) return { form: null, tooLarge: false };

    let read = 0;
    const counted = req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            read += chunk.byteLength;
            // Erroring the stream also cancels the body, so the rest of it is never read.
            if (read > maxBodyBytes) controller.error(new BodyTooLargeError());
            else controller.enqueue(chunk);
        },
    }));
    try {
        const form = await new Response(counted, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
        return { form, tooLarge: false };
    } catch {
        return { form: null, tooLarge: read > maxBodyBytes };
    }
}
