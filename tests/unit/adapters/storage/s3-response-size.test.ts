// @vitest-environment node
/**
 * The SDK reads the whole body of an error, and the body of an answer without payload to discard
 * it, before it hands anything back, without any bound. The server of an S3 destination may belong
 * to a customer, so every client of the adapter reads those bodies only up to a bound. The SDK runs
 * for real here, with a request handler in place of the network, so the order of its middlewares
 * is what is tested: the bound has to read the body before the deserializer does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "stream";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import {
    limitResponseBodies,
    S3ResponseTooLargeError,
    S3_MAX_RESPONSE_BYTES,
} from "@/lib/adapters/storage/s3-response-limit";
import { S3GenericAdapter } from "@/lib/adapters/storage/s3";

interface FakeRequest {
    method: string;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
}
interface FakeAnswer {
    status: number;
    headers?: Record<string, string>;
    /** Chunks of the body, endless when the generator never returns. */
    chunks?: () => Iterable<Buffer>;
}

/** What the fake server answers to the request, swapped per test. */
let answer: (request: FakeRequest) => FakeAnswer = () => ({ status: 200 });
const served = { bytes: 0, requests: [] as string[] };

/** Drains a request body, so a stream the SDK sends ends as it would on the network. */
async function drain(body: unknown): Promise<void> {
    if (body && typeof (body as { pipe?: unknown }).pipe === "function") {
        for await (const _chunk of body as AsyncIterable<unknown>) { /* discarded */ }
    }
}

const handle = vi.fn(async (request: FakeRequest) => {
    await drain(request.body);
    served.requests.push(`${request.method} ${Object.keys(request.query ?? {}).sort().join(",")}`);
    const { status, headers = {}, chunks = () => [] } = answer(request);
    const body = Readable.from((function* () {
        for (const chunk of chunks()) {
            served.bytes += chunk.length;
            yield chunk;
        }
    })(), { objectMode: false });
    return { response: { statusCode: status, headers: { "content-type": "application/xml", ...headers }, body } };
});

// The adapter builds its clients itself, so the class it imports gets the fake handler.
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
    class FakeNetworkS3Client extends actual.S3Client {
        constructor(config: ConstructorParameters<typeof actual.S3Client>[0]) {
            super({ ...config, requestHandler: { handle: (request: unknown) => handle(request as FakeRequest) } as never });
        }
    }
    return { ...actual, S3Client: FakeNetworkS3Client };
});

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const CHUNK = Buffer.alloc(16 * 1024, 0x20);
/** A body that never ends. */
const endless = () => (function* () {
    yield Buffer.from("<Error><Code>InternalError</Code><Message>");
    for (;;) yield CHUNK;
})();
const bodyOf = (bytes: Buffer) => () => [bytes];

/** The bound and the chunk that crossed it, plus what the stream buffered ahead. */
const WITHIN_BOUND = S3_MAX_RESPONSE_BYTES + 128 * 1024;

const client = () => limitResponseBodies(new S3Client({
    region: "us-east-1",
    endpoint: "http://s3.example.test",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
}));

const KEY = { Bucket: "bucket", Key: "job/backup.tar" };

beforeEach(() => {
    served.bytes = 0;
    served.requests = [];
    handle.mockClear();
    answer = () => ({ status: 200 });
});

describe("an S3 answer the SDK reads itself", () => {
    it.each([
        ["an error of GetObject", 500, () => new GetObjectCommand(KEY)],
        ["an error of PutObject", 500, () => new PutObjectCommand({ ...KEY, Body: "data" })],
        ["an error of HeadObject", 403, () => new HeadObjectCommand(KEY)],
        ["a successful PutObject", 200, () => new PutObjectCommand({ ...KEY, Body: "data" })],
        ["a successful DeleteObject", 200, () => new DeleteObjectCommand(KEY)],
    ])("is refused at the bound when %s never ends", async (_case, status, command) => {
        answer = () => ({ status, chunks: endless });

        await expect(client().send(command() as never)).rejects.toBeInstanceOf(S3ResponseTooLargeError);

        expect(served.bytes).toBeGreaterThan(S3_MAX_RESPONSE_BYTES);
        expect(served.bytes).toBeLessThan(WITHIN_BOUND);
        // An answer that is too large is no passing failure, so the SDK does not ask again.
        expect(handle).toHaveBeenCalledOnce();
    });

    it("that announces a length past the bound is refused before its body is read", async () => {
        answer = () => ({ status: 500, headers: { "content-length": String(64 * 1024 * 1024) }, chunks: endless });

        await expect(client().send(new DeleteObjectCommand(KEY))).rejects.toBeInstanceOf(S3ResponseTooLargeError);
        expect(served.bytes).toBe(0);
    });

    it("still says what the server said when the error is short", async () => {
        answer = () => ({
            status: 404,
            chunks: bodyOf(Buffer.from("<Error><Code>NoSuchKey</Code><Message>gone</Message></Error>")),
        });

        await expect(client().send(new GetObjectCommand(KEY))).rejects.toMatchObject({ name: "NoSuchKey" });
    });

    it("of HeadObject keeps the size of the object, which is far past the bound", async () => {
        answer = () => ({ status: 200, headers: { "content-length": String(50 * 1024 * 1024 * 1024), "x-amz-meta-dbackup-sha256": "abc" } });

        const head = await client().send(new HeadObjectCommand(KEY));

        expect(head.ContentLength).toBe(50 * 1024 * 1024 * 1024);
        expect(head.Metadata).toEqual({ "dbackup-sha256": "abc" });
    });
});

describe("a backup on S3", () => {
    let workDir: string;
    const config = {
        endpoint: "http://s3.example.test",
        region: "us-east-1",
        bucket: "bucket",
        accessKeyId: "test",
        secretAccessKey: "test",
        forcePathStyle: true,
        pathPrefix: "",
    };

    beforeEach(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3-response-size-"));
    });
    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true });
    });

    it("downloads in full, far past the bound of an answer the SDK reads", async () => {
        const payload = Buffer.alloc(3 * S3_MAX_RESPONSE_BYTES, 0x61);
        answer = () => ({ status: 200, headers: { "content-length": String(payload.length) }, chunks: bodyOf(payload) });
        const target = path.join(workDir, "backup.tar");

        expect(await S3GenericAdapter.download(config as never, "job/backup.tar", target)).toBe(true);
        expect((await fs.stat(target)).size).toBe(payload.length);
    });

    it("uploads as before", async () => {
        const local = path.join(workDir, "backup.tar");
        await fs.writeFile(local, Buffer.alloc(64 * 1024, 0x62));
        answer = () => ({ status: 200, headers: { etag: '"e1"' } });

        expect(await S3GenericAdapter.upload(config as never, local, "job/backup.tar")).toBe(true);
        expect(served.requests).toEqual(["PUT x-id"]);
    });

    it("fails an upload whose answer never ends, and a delete too, without buffering it", async () => {
        const local = path.join(workDir, "backup.tar");
        await fs.writeFile(local, "data");
        answer = () => ({ status: 200, chunks: endless });

        expect(await S3GenericAdapter.upload(config as never, local, "job/backup.tar")).toBe(false);
        expect(await S3GenericAdapter.delete!(config as never, "job/backup.tar")).toBe(false);
        expect(served.bytes).toBeLessThan(2 * WITHIN_BOUND);
    });

    it("uploads in several parts through lib-storage", async () => {
        const xml = (body: string) => bodyOf(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${body}`));
        answer = (request) => {
            const query = request.query ?? {};
            if (request.method === "POST" && "uploads" in query) {
                return { status: 200, chunks: xml("<InitiateMultipartUploadResult><Bucket>bucket</Bucket><Key>job/backup.tar</Key><UploadId>u1</UploadId></InitiateMultipartUploadResult>") };
            }
            if (request.method === "PUT" && "partNumber" in query) {
                return { status: 200, headers: { etag: `"p${String(query.partNumber)}"` } };
            }
            if (request.method === "POST" && "uploadId" in query) {
                return { status: 200, chunks: xml('<CompleteMultipartUploadResult><Bucket>bucket</Bucket><Key>job/backup.tar</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>') };
            }
            return { status: 500, chunks: xml("<Error><Code>Unexpected</Code></Error>") };
        };

        const upload = new Upload({
            client: client(),
            partSize: 5 * 1024 * 1024,
            queueSize: 2,
            params: { ...KEY, Body: Buffer.alloc(11 * 1024 * 1024, 0x63) },
        });
        const result = await upload.done();

        expect(result).toMatchObject({ ETag: '"done"' });
        expect(served.requests.filter((r) => r.startsWith("PUT"))).toHaveLength(3);
    });
});
