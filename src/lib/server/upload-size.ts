/** Room for the boundaries and the headers of a multipart form around its one file. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/**
 * Whether a request announces a body larger than a form with one file of at most `maxFileBytes`,
 * so a route refuses it before it reads the form into memory.
 */
export function bodyTooLarge(headers: Headers, maxFileBytes: number): boolean {
    return Number(headers.get("content-length") ?? 0) > maxFileBytes + FORM_OVERHEAD_BYTES;
}
