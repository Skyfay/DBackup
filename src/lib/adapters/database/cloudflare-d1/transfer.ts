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

/**
 * What an import uploads: SQL text put ahead of a file, the file, and SQL put after it. Streamed
 * from all three, so the dump is never written a second time to disk.
 */
export interface ImportBody {
    filePath: string;
    prefix?: string;
    suffix?: string;
}

/**
 * A NUL character of a text value as SQL that keeps it. The export of Cloudflare writes it raw into
 * the string literal, and the import reads the file only up to that byte: it runs the statements
 * before it, skips the rest without an error and reports the import complete. A NUL byte of a dump
 * only ever stands inside a single-quoted text value (a BLOB is written as hex, a name cannot hold
 * one), so closing the literal around `char(0)` writes the same value.
 */
const NUL_AS_SQL = Buffer.from("'||char(0)||'", "utf8");

function withoutNul(chunk: Buffer): Buffer {
    if (!chunk.includes(0)) return chunk;
    const parts: Buffer[] = [];
    let start = 0;
    for (let at = chunk.indexOf(0); at !== -1; at = chunk.indexOf(0, start)) {
        parts.push(chunk.subarray(start, at), NUL_AS_SQL);
        start = at + 1;
    }
    parts.push(chunk.subarray(start));
    return Buffer.concat(parts);
}

function streamOf(body: ImportBody): Readable {
    return Readable.from((async function* () {
        if (body.prefix) yield Buffer.from(body.prefix, "utf8");
        for await (const chunk of fs.createReadStream(body.filePath)) yield withoutNul(chunk as Buffer);
        if (body.suffix) yield Buffer.from(body.suffix, "utf8");
    })());
}

/** The MD5 in hex, the `etag` the import of D1 asks for, and the size of an import body as it is uploaded. */
export async function measure(body: ImportBody): Promise<{ etag: string; size: number }> {
    const hash = createHash("md5");
    let size = 0;
    for await (const chunk of streamOf(body)) {
        hash.update(chunk as Buffer);
        size += (chunk as Buffer).length;
    }
    return { etag: hash.digest("hex"), size };
}

/**
 * Streams an import body to a presigned URL with PUT, as Wrangler does. R2 answers the MD5 of what it
 * got as the ETag, which has to be the one the import was started with.
 */
export async function uploadFrom(url: URL, body: ImportBody, etag: string, size: number): Promise<void> {
    const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Length": String(size) },
        body: Readable.toWeb(streamOf(body)) as unknown as BodyInit,
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
