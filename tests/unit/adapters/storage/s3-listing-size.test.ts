// @vitest-environment node
/**
 * The answer of one ListObjectsV2 page is read only up to a bound. The SDK runs for real here, with a
 * request handler in place of the network, so the order of its middlewares is what is tested: the
 * S3 check of an error inside a 200 reads the whole body too, and must not get it before the bound.
 */
import { describe, it, expect, vi } from "vitest";
import { Readable } from "stream";
import { S3Client } from "@aws-sdk/client-s3";
import { sendListPage, S3_LISTING_MAX_KEYS } from "@/lib/adapters/storage/s3-listing";
import { ListingTooLargeError } from "@/lib/adapters/storage/common/listing-limits";

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bucket</Name><Prefix></Prefix><KeyCount>2</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>';
const contents = (key: string) => `<Contents><Key>${key}</Key><LastModified>2026-10-27T04:00:00.000Z</LastModified><Size>1</Size></Contents>`;

/** A server that answers with the chunks of `chunks`, counting the bytes the client pulled. */
function serverOf(chunks: () => Iterable<string>, headers: Record<string, string> = {}) {
    const served = { bytes: 0, query: {} as Record<string, unknown> };
    const handle = vi.fn(async (request: { query?: Record<string, unknown> }) => {
        served.query = request.query ?? {};
        const body = Readable.from((function* () {
            for (const chunk of chunks()) {
                served.bytes += Buffer.byteLength(chunk);
                yield Buffer.from(chunk);
            }
        })(), { objectMode: false });
        return { response: { statusCode: 200, headers: { "content-type": "application/xml", ...headers }, body } };
    });
    const client = new S3Client({
        region: "us-east-1",
        endpoint: "http://s3.example.test",
        forcePathStyle: true,
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
        requestHandler: { handle } as never,
    });
    return { client, served, handle };
}

describe("a ListObjectsV2 page", () => {
    it("of a server that keeps to the protocol lists as before, asking for 1000 keys", async () => {
        const { client, served } = serverOf(() => [XML_HEAD, contents("a.tar"), contents("b.tar"), "</ListBucketResult>"]);

        const page = await sendListPage(client, { Bucket: "bucket", Prefix: "" });

        expect(page.Contents?.map((object) => object.Key)).toEqual(["a.tar", "b.tar"]);
        expect(served.query["max-keys"]).toBe(String(S3_LISTING_MAX_KEYS));
    });

    it("that never ends is refused at the bound, and the transfer stops there", async () => {
        const maxBytes = 64 * 1024;
        const { client, served, handle } = serverOf(function* () {
            yield XML_HEAD;
            for (let i = 0; ; i++) yield contents(`backup-${i}.tar`);
        });

        await expect(sendListPage(client, { Bucket: "bucket", Prefix: "" }, maxBytes)).rejects.toBeInstanceOf(ListingTooLargeError);

        // The bound and the one chunk that crossed it, plus what the stream buffered ahead.
        expect(served.bytes).toBeLessThan(maxBytes + 32 * 1024);
        // A page that is too large is no passing failure, so the SDK does not ask again.
        expect(handle).toHaveBeenCalledOnce();
    });

    it("that announces a length past the bound is refused before its body is read", async () => {
        const { client, served } = serverOf(
            () => [XML_HEAD, contents("a.tar"), "</ListBucketResult>"],
            { "content-length": String(64 * 1024 * 1024) }
        );

        await expect(sendListPage(client, { Bucket: "bucket", Prefix: "" }, 1024 * 1024)).rejects.toBeInstanceOf(ListingTooLargeError);
        expect(served.bytes).toBe(0);
    });
});
