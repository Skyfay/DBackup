import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StorageAdapter } from "@/lib/core/interfaces";

/**
 * The listing of a directory source comes from a server a customer may own, and the walk keeps
 * every entry in memory. The limits are far past a real tree, so the walk here meets a guard of
 * five entries, the same guard with a smaller number.
 */
const SMALL_LIMIT = 5;
vi.mock("@/lib/adapters/storage/common/listing-limits", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/adapters/storage/common/listing-limits")>();
    return { ...actual, createListingGuard: (max?: number, maxBytes?: number) => actual.createListingGuard(Math.min(max ?? SMALL_LIMIT, SMALL_LIMIT), maxBytes) };
});

const { mockSftpConnect, mockSftpEnd, mockSftpList, mockSftpExists } = vi.hoisted(() => ({
    mockSftpConnect: vi.fn().mockResolvedValue(undefined),
    mockSftpEnd: vi.fn().mockResolvedValue(undefined),
    mockSftpList: vi.fn(),
    mockSftpExists: vi.fn(),
}));

vi.mock("ssh2-sftp-client", () => {
    class MockSFTPClient {
        connect = mockSftpConnect;
        end = mockSftpEnd;
        list = mockSftpList;
        exists = mockSftpExists;
        client = { destroy: vi.fn() };
        get sftp() { return undefined; }
    }
    return { default: MockSFTPClient };
});

const { mockS3Send } = vi.hoisted(() => ({ mockS3Send: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: vi.fn(function (this: Record<string, unknown>) {
        this.send = mockS3Send;
        this.destroy = vi.fn();
        // Every client bounds what it reads of an answer, see `s3-response-limit.ts`.
        this.middlewareStack = { add: vi.fn() };
    }),
    ListObjectsV2Command: vi.fn(function (this: Record<string, unknown>, params: unknown) {
        // The listing adds its bound on the answer to the stack of the command, see `s3-listing.ts`.
        Object.defineProperty(this, "middlewareStack", { value: { add: vi.fn() }, enumerable: false });
        Object.assign(this, params as object);
    }),
    StorageClass: {},
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { SFTPAdapter } from "@/lib/adapters/storage/sftp";
import { S3GenericAdapter } from "@/lib/adapters/storage/s3";
import { listTreeForCollection } from "@/lib/adapters/storage/common/list-tree";
import {
    assertListingWithinLimits,
    createListingGuard,
    createPageGuard,
    descendableName,
    LISTING_MAX_ENTRIES,
    LISTING_MAX_NAME_BYTES,
    LISTING_MAX_TOKEN_BYTES,
    LISTING_MAX_TOTAL_BYTES,
    ListingTooLargeError,
} from "@/lib/adapters/storage/common/listing-limits";
import { INDEX_MAX_INFLATED_BYTES, INDEX_MAX_LINE_BYTES, INDEX_MAX_LINES } from "@/lib/archive/limits";

const config = { host: "nas.local", port: 22, username: "backup", password: "pw" };
const entry = (name: string, type: "d" | "-") => ({ name, type, size: 1, modifyTime: 1_700_000_000_000 });

describe("the limits of a listing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSftpConnect.mockResolvedValue(undefined);
        mockSftpEnd.mockResolvedValue(undefined);
    });

    it("match what a restore reads back of the index", () => {
        expect(LISTING_MAX_ENTRIES).toBe(INDEX_MAX_LINES);
        // A path and a link target, each escaped to six times its bytes at most, fit one line.
        expect(2 * 6 * LISTING_MAX_NAME_BYTES).toBeLessThan(INDEX_MAX_LINE_BYTES);
    });

    it("refuse a listing whose names add up to more than a restore reads back", () => {
        expect(LISTING_MAX_TOTAL_BYTES).toBe(INDEX_MAX_INFLATED_BYTES);
        const guard = createListingGuard(Number.POSITIVE_INFINITY, 10);
        guard.add("abcd");
        guard.add("ef", "ghij");
        // Each name is short, the count far below its limit, only the total grows.
        expect(() => guard.add("k")).toThrow(/add up to more than 10 bytes/);
    });

    it("refuse an entry past the count, a long name and a long link target", () => {
        const guard = createListingGuard(2);
        guard.add("a");
        guard.add("b");
        expect(() => guard.add("c")).toThrow(ListingTooLargeError);
        expect(() => createListingGuard().add("x".repeat(LISTING_MAX_NAME_BYTES + 1))).toThrow(/longer than/);
        expect(() => createListingGuard().add("link", "y".repeat(LISTING_MAX_NAME_BYTES + 1))).toThrow(ListingTooLargeError);
        expect(() => assertListingWithinLimits([{ path: "ok" }, { path: "z".repeat(LISTING_MAX_NAME_BYTES + 1) }])).toThrow(ListingTooLargeError);
    });

    it("stops an SFTP walk of an endless tree at the limit instead of at its end", async () => {
        // Every folder holds two files and another folder, without end.
        mockSftpExists.mockResolvedValue("d");
        mockSftpList.mockImplementation(async () => [entry("a.txt", "-"), entry("b.txt", "-"), entry("deeper", "d")]);

        await expect(SFTPAdapter.listTree!(config, "")).rejects.toBeInstanceOf(ListingTooLargeError);
        expect(mockSftpList.mock.calls.length).toBeLessThanOrEqual(SMALL_LIMIT);
    });

    it("fails an SFTP source that lists a name longer than any file system allows", async () => {
        mockSftpExists.mockResolvedValue("d");
        mockSftpList.mockResolvedValue([entry("x".repeat(LISTING_MAX_NAME_BYTES + 1), "-")]);

        await expect(SFTPAdapter.listTree!(config, "")).rejects.toThrow(/longer than the 32768 any file system allows/);
    });

    it("holds an adapter without a walk of its own to the same limits", async () => {
        const adapter = {
            id: "webdav",
            list: vi.fn().mockResolvedValue([{ name: "n", path: "n".repeat(LISTING_MAX_NAME_BYTES + 1), size: 1, lastModified: new Date() }]),
        } as unknown as StorageAdapter;

        await expect(listTreeForCollection(adapter, {}, "")).rejects.toBeInstanceOf(ListingTooLargeError);
    });

    it("stops the SFTP listing of a destination in an endless tree too", async () => {
        mockSftpExists.mockResolvedValue("d");
        mockSftpList.mockImplementation(async () => [entry("a.tar", "-"), entry("deeper", "d")]);

        await expect(SFTPAdapter.list(config, "")).rejects.toBeInstanceOf(ListingTooLargeError);
        expect(mockSftpList.mock.calls.length).toBeLessThanOrEqual(SMALL_LIMIT);
    });

    it.each([
        ["list", () => SFTPAdapter.list(config, "")],
        ["listTree", async () => (await SFTPAdapter.listTree!(config, "")).files],
    ])("never lets the SFTP %s read a folder again through a name of dots or with a slash", async (_name, walk) => {
        mockSftpExists.mockResolvedValue("d");
        mockSftpList.mockImplementation(async () => [entry("..", "d"), entry("x/..", "d"), entry("a.tar", "-")]);

        const files = await walk();
        expect(files.map((f) => f.name)).toEqual(["a.tar"]);
        expect(mockSftpList).toHaveBeenCalledTimes(1);
    });
});

describe("a folder a walk may go down into", () => {
    it.each(["", ".", "..", "...", "a/b", "a/..", "a\0b"])("is never %j", (name) => {
        expect(descendableName(name)).toBe(false);
    });

    it.each(["a", ".hidden", "a..b", "a\\b", "name with spaces"])("may be %j", (name) => {
        expect(descendableName(name)).toBe(true);
    });
});

describe("a paged listing", () => {
    it("ends when the storage hands out a page token it handed out before", () => {
        const pages = createPageGuard();
        pages.next("t1", 10);
        pages.next("t2", 10);
        expect(() => pages.next("t1", 10)).toThrow(ListingTooLargeError);
    });

    it("ends after too many pages in a row without an entry, and counts again after one with entries", () => {
        const pages = createPageGuard(3);
        for (let i = 0; i < 3; i++) pages.next(`e${i}`, 0);
        pages.next("full", 5);
        for (let i = 3; i < 6; i++) pages.next(`e${i}`, 0);
        expect(() => pages.next("e6", 0)).toThrow(ListingTooLargeError);
    });

    it("refuses a page token longer than any storage hands out", () => {
        const pages = createPageGuard();
        pages.next("t".repeat(LISTING_MAX_TOKEN_BYTES), 1);
        expect(() => pages.next("u".repeat(LISTING_MAX_TOKEN_BYTES + 1), 1)).toThrow(/page token of/);
    });

    it("keeps no more bytes of page tokens than its limit", () => {
        const pages = createPageGuard(1000, 100, 25);
        pages.next("a".repeat(10), 1);
        pages.next("b".repeat(10), 1);
        expect(() => pages.next("c".repeat(10), 1)).toThrow(/add up to more than 25 bytes/);
    });

    it("ends an S3 listing of folder markers alone at the limit of entries", async () => {
        // A server of a customer answers page after page of folder markers, each under a new
        // token. A marker is no file, but it is an entry the listing had to take.
        let page = 0;
        mockS3Send.mockImplementation(async () => {
            page++;
            return {
                Contents: [{ Key: `m${page}/`, Size: 0 }, { Key: `n${page}/`, Size: 0 }],
                IsTruncated: page < 50,
                NextContinuationToken: `p${page}`,
            };
        });
        const s3Config = { endpoint: "https://s3.example.com", region: "us-east-1", bucket: "b", accessKeyId: "K", secretAccessKey: "S", pathPrefix: "" };

        await expect(S3GenericAdapter.list(s3Config, "")).rejects.toBeInstanceOf(ListingTooLargeError);
        expect(page).toBeLessThanOrEqual(SMALL_LIMIT);

        page = 0;
        await expect(S3GenericAdapter.listTree!(s3Config, "")).rejects.toBeInstanceOf(ListingTooLargeError);
        expect(page).toBeLessThanOrEqual(SMALL_LIMIT);
    });

    it("takes the last page, which names no token", () => {
        const pages = createPageGuard();
        pages.next("t1", 1);
        expect(() => pages.next(undefined, 1)).not.toThrow();
    });
});
