import fs from "fs";
import { createHash } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { AdapterError } from "@/lib/logging/errors";

/**
 * Moving a dump between this machine and the R2 bucket Cloudflare keeps exports and imports in.
 *
 * The export and the import of D1 answer with a presigned URL of R2. The URL comes from an answer
 * of the API, so before anything is sent to it or read from it, it has to be HTTPS on R2 itself
 * (`<bucket>.r2.cloudflarestorage.com`, or `<bucket>.eu.r2.cloudflarestorage.com` for a database in
 * the EU). An answer that points anywhere else is refused, so a tampered or broken answer cannot
 * make DBackup send a dump or fetch something from a host of its choosing. Redirects are refused
 * for the same reason. The signature in the query is an access right, so the URL is never logged,
 * only its host.
 */

const R2_HOST = /^(?:[a-z0-9-]+\.)+r2\.cloudflarestorage\.com$/i;

/** A transfer of a dump may take long, but not forever. */
const TRANSFER_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/** The presigned URL, refused unless it is HTTPS on R2. */
export function signedUrlOf(value: unknown, operation: string): URL {
    let url: URL;
    try {
        url = new URL(String(value));
    } catch {
        throw new AdapterError("cloudflare-d1", operation, "Cloudflare answered without a valid transfer URL.");
    }
    if (url.protocol !== "https:" || !R2_HOST.test(url.hostname) || url.port !== "" || url.username || url.password) {
        throw new AdapterError("cloudflare-d1", operation, `Cloudflare answered with a transfer URL on ${url.hostname || "no host"}, which is not R2. Refusing to use it.`);
    }
    return url;
}

/** Streams the file behind a presigned URL to `destinationPath`. Answers its size. */
export async function downloadTo(url: URL, destinationPath: string): Promise<number> {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS) }).catch(() => null);
    if (!response?.ok || !response.body) {
        throw new AdapterError("cloudflare-d1", "export", `Downloading the export from ${url.hostname} failed${response ? ` with ${response.status}` : ""}.`);
    }
    await pipeline(Readable.fromWeb(response.body as WebReadableStream), fs.createWriteStream(destinationPath));
    return (await fs.promises.stat(destinationPath)).size;
}

/** The MD5 of a file in hex, the `etag` the import of D1 asks for. */
export async function md5Of(filePath: string): Promise<string> {
    const hash = createHash("md5");
    await pipeline(fs.createReadStream(filePath), hash);
    return hash.digest("hex");
}

/**
 * Streams a file to a presigned URL with PUT, as Wrangler does. R2 answers the MD5 of what it got as
 * the ETag, which has to be the one the import was started with.
 */
export async function uploadFrom(url: URL, filePath: string, etag: string): Promise<void> {
    const { size } = await fs.promises.stat(filePath);
    const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Length": String(size) },
        body: Readable.toWeb(fs.createReadStream(filePath)) as unknown as BodyInit,
        duplex: "half",
        redirect: "error",
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    } as RequestInit & { duplex: "half" }).catch(() => null);
    if (!response?.ok) {
        throw new AdapterError("cloudflare-d1", "import", `Uploading the dump to ${url.hostname} failed${response ? ` with ${response.status}` : ""}.`);
    }
    const answered = (response.headers.get("etag") ?? "").replace(/^"|"$/g, "");
    if (answered !== etag) {
        throw new AdapterError("cloudflare-d1", "import", "The upload of the dump arrived damaged (its MD5 does not match). Run the restore again.");
    }
}
