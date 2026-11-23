import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
// Type-only, like in `s3.ts`: the unit suites replace the SDK with a factory of command classes.
import type { ListObjectsV2CommandInput, ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { ListingTooLargeError } from "@/lib/adapters/storage/common/listing-limits";
import { bodySizeLimit, S3_MAX_LISTING_PAGE_BYTES, S3_MAX_RESPONSE_BYTES } from "@/lib/adapters/storage/s3-response-limit";

export { S3_MAX_LISTING_PAGE_BYTES };

/** The keys one ListObjectsV2 page asks for, the most S3 answers with anyway. */
export const S3_LISTING_MAX_KEYS = 1000;

function tooLarge(maxBytes: number): ListingTooLargeError {
    return new ListingTooLargeError(
        `The S3 server answered one page of a listing with more than ${maxBytes} bytes, which no server that keeps to ${S3_LISTING_MAX_KEYS} keys a page sends.`
    );
}

/**
 * One ListObjectsV2 page, at most `S3_LISTING_MAX_KEYS` keys and `maxBytes` of answer. Every listing
 * of the S3 adapter goes through this. The bound sits on the command too, beside the one every
 * client of the adapter carries (`limitResponseBodies`), so a caller may name a smaller one. An
 * error is bounded like any other, at `S3_MAX_RESPONSE_BYTES`.
 */
export function sendListPage(
    client: S3Client,
    input: Omit<ListObjectsV2CommandInput, "MaxKeys">,
    maxBytes: number = S3_MAX_LISTING_PAGE_BYTES
): Promise<ListObjectsV2CommandOutput> {
    const command = new ListObjectsV2Command({ ...input, MaxKeys: S3_LISTING_MAX_KEYS });
    command.middlewareStack.add(
        bodySizeLimit(
            (status) => (status >= 200 && status < 300 ? maxBytes : Math.min(maxBytes, S3_MAX_RESPONSE_BYTES)),
            (limit) => tooLarge(limit)
        ) as Parameters<ListObjectsV2Command["middlewareStack"]["add"]>[0],
        { step: "deserialize", priority: "low", name: "dbackupListingSizeLimit" }
    );
    return client.send(command);
}
