import { Readable } from "stream";
// Type-only, like in `s3.ts`: the unit suites replace the SDK with a factory of command classes.
import type { S3Client } from "@aws-sdk/client-s3";
import { collectCapped, isFileTooLarge } from "@/lib/adapters/storage/common/read-limit";

/**
 * The most bytes of an answer the SDK reads into memory itself: the body of an error, of any status
 * of 300 or more, and the body of an answer without payload, like that of PutObject, DeleteObject or
 * HeadObject, which it reads to discard. Both are a few hundred bytes of XML from a real server, and
 * so is the payload of CreateMultipartUpload and CompleteMultipartUpload. The SDK reads each of them
 * whole, without any bound, and the server may belong to a customer.
 */
export const S3_MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * The most bytes of one ListObjectsV2 answer. A page of 1000 keys of the longest key S3 allows,
 * 1024 bytes, with their XML is about 1.5 MB. The SDK reads the whole answer into memory before it
 * parses it, also from a server that ignores `MaxKeys` and answers a page of millions.
 */
export const S3_MAX_LISTING_PAGE_BYTES = 16 * 1024 * 1024;

/** The commands whose successful answer is no body the SDK reads, but a stream its caller bounds. */
const STREAMED_COMMANDS = new Set(["GetObjectCommand"]);

/** The commands whose successful answer may be larger than `S3_MAX_RESPONSE_BYTES`, and their bound. */
const LARGER_ANSWERS: Readonly<Record<string, number>> = { ListObjectsV2Command: S3_MAX_LISTING_PAGE_BYTES };

/** An answer of an S3 server past the bytes DBackup reads of it. */
export class S3ResponseTooLargeError extends Error {
    public readonly limit: number;

    constructor(what: string, limit: number) {
        super(`The S3 server sent more than the ${limit} bytes DBackup reads in its answer to ${what}.`);
        this.name = "S3ResponseTooLargeError";
        this.limit = limit;
    }
}

type ResponseMiddleware = Parameters<S3Client["middlewareStack"]["add"]>[0];

/** What a middleware of the deserialize step sees of the answer. */
interface RawResponse {
    statusCode?: number;
    headers?: Record<string, string>;
    body?: unknown;
}

/** The body of a response as a Node stream, whether the handler underneath handed a Node or a web stream. */
export function nodeStreamOf(body: unknown): NodeJS.ReadableStream | null {
    if (body && typeof (body as { getReader?: unknown }).getReader === "function") {
        return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
    }
    if (body && typeof (body as { pipe?: unknown }).pipe === "function") return body as NodeJS.ReadableStream;
    return null;
}

/**
 * A middleware of the deserialize step that reads the body of an answer up to the bound
 * `limitOf` gives it, before the SDK does, and fails the request with the error of `refuse` past
 * it. Added at the priority `low`, it runs inside the deserializer and inside the S3 check of an
 * error inside a 200, which reads the whole body too, so the transfer stops at the first chunk past
 * the bound. An answer that announces a length past the bound is refused before its body is read,
 * except the answer to a HEAD request, whose length is that of the object and comes without a body.
 * The body it read goes on as a buffer, which the SDK parses as it parses any other.
 *
 * @param limitOf - The bound of an answer of this status to the command named, null to leave it alone
 * @param refuse - The error for an answer past its bound
 */
export function bodySizeLimit(
    limitOf: (status: number, commandName: string) => number | null,
    refuse: (limit: number, status: number, commandName: string) => Error
): ResponseMiddleware {
    return ((next: (args: unknown) => Promise<{ response: unknown }>, context: { commandName?: string }) => async (args: unknown) => {
        const result = await next(args);
        const response = result.response as RawResponse | undefined;
        if (!response) return result;
        const status = response.statusCode ?? 0;
        const commandName = context?.commandName ?? "";
        const limit = limitOf(status, commandName);
        if (limit === null) return result;
        if (response.body instanceof Uint8Array) {
            if (response.body.byteLength > limit) throw refuse(limit, status, commandName);
            return result;
        }
        const stream = nodeStreamOf(response.body);
        if (!stream) return result;
        const announced = response.headers?.["content-length"];
        const method = (args as { request?: { method?: string } } | undefined)?.request?.method;
        if (method !== "HEAD" && announced !== undefined && Number(announced) > limit) {
            (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
            throw refuse(limit, status, commandName);
        }
        try {
            response.body = await collectCapped(stream, limit);
        } catch (error) {
            throw isFileTooLarge(error) ? refuse(limit, status, commandName) : error;
        }
        return result;
    }) as unknown as ResponseMiddleware;
}

/** The bound of an answer to any command of the client, null for a successful GetObject. */
export function responseLimitOf(status: number, commandName: string): number | null {
    const success = status >= 200 && status < 300;
    if (success && STREAMED_COMMANDS.has(commandName)) return null;
    if (success && Object.hasOwn(LARGER_ANSWERS, commandName)) return LARGER_ANSWERS[commandName];
    return S3_MAX_RESPONSE_BYTES;
}

/**
 * Bounds what the client reads of every answer, for every command it sends, those of
 * `@aws-sdk/lib-storage` included: `S3_MAX_RESPONSE_BYTES` for an error and for an answer the SDK
 * reads itself, `S3_MAX_LISTING_PAGE_BYTES` for a page of ListObjectsV2. A successful GetObject is
 * left to its caller, which reads its stream with a bound of its own (`collectCapped`, the archive
 * readers). Every client of the S3 adapter gets this from `S3ClientFactory.create`.
 */
export function limitResponseBodies(client: S3Client): S3Client {
    client.middlewareStack.add(
        bodySizeLimit(responseLimitOf, (limit, status, commandName) =>
            new S3ResponseTooLargeError(`${commandName.replace(/Command$/, "") || "a request"} (status ${status})`, limit)),
        { step: "deserialize", priority: "low", name: "dbackupResponseSizeLimit" }
    );
    return client;
}
