import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";
import { FileTooLargeError, SIDECAR_READ_LIMIT } from "@/lib/adapters/storage/common/read-limit";
import {
    S3GenericAdapter,
    S3AWSAdapter,
    S3R2Adapter,
    S3HetznerAdapter,
} from "@/lib/adapters/storage/s3";

// --- Hoisted mocks ---
const { mockSend, mockUploadDone, mockUploadOn, mockPipeline } = vi.hoisted(() => ({
    mockSend: vi.fn(),
    mockUploadDone: vi.fn(),
    mockUploadOn: vi.fn(),
    mockPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@aws-sdk/client-s3", () => {
    const MockS3Client = vi.fn(function (this: Record<string, unknown>) {
        this.send = mockSend;
        this.destroy = vi.fn();
        // Every client bounds what it reads of an answer, see `s3-response-limit.ts`.
        this.middlewareStack = { add: vi.fn() };
    });
    return {
        S3Client: MockS3Client,
        ListObjectsV2Command: vi.fn(function (this: Record<string, unknown>, params: unknown) {
            // The listing adds its bound on the answer to the stack of the command, see `s3-listing.ts`.
            Object.defineProperty(this, "middlewareStack", { value: { add: vi.fn() }, enumerable: false });
            Object.assign(this, { _type: "list" }, params as object);
        }),
        GetObjectCommand: vi.fn(function (this: Record<string, unknown>, params: unknown) {
            Object.assign(this, { _type: "get" }, params as object);
        }),
        DeleteObjectCommand: vi.fn(function (this: Record<string, unknown>, params: unknown) {
            Object.assign(this, { _type: "delete" }, params as object);
        }),
        PutObjectCommand: vi.fn(function (this: Record<string, unknown>, params: unknown) {
            Object.assign(this, { _type: "put" }, params as object);
        }),
        StorageClass: {},
    };
});

vi.mock("@aws-sdk/lib-storage", () => {
    const MockUpload = vi.fn(function (this: Record<string, unknown>) {
        this.on = mockUploadOn;
        this.done = mockUploadDone;
    });
    return { Upload: MockUpload };
});

vi.mock("fs", () => ({
    createReadStream: vi.fn(() => Readable.from(["data"])),
    createWriteStream: vi.fn(() => ({
        on: vi.fn(),
        end: vi.fn(),
        write: vi.fn(),
    })),
    default: {
        createReadStream: vi.fn(() => Readable.from(["data"])),
        createWriteStream: vi.fn(() => ({
            on: vi.fn(),
            end: vi.fn(),
            write: vi.fn(),
        })),
    },
}));

vi.mock("stream/promises", () => ({
    pipeline: mockPipeline,
    default: { pipeline: mockPipeline },
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
        }),
    },
}));

vi.mock("@/lib/logging/errors", () => ({
    wrapError: vi.fn((e) => e),
}));

// --- Configs ---
const genericConfig = {
    endpoint: "https://s3.example.com",
    region: "us-east-1",
    bucket: "my-bucket",
    accessKeyId: "KEY",
    secretAccessKey: "SECRET",
    forcePathStyle: false,
    pathPrefix: "",
};

const awsConfig = {
    region: "us-east-1",
    bucket: "aws-bucket",
    accessKeyId: "KEY",
    secretAccessKey: "SECRET",
    storageClass: "STANDARD",
    pathPrefix: "",
};

const r2Config = {
    accountId: "abc123",
    bucket: "r2-bucket",
    accessKeyId: "KEY",
    secretAccessKey: "SECRET",
    jurisdiction: undefined,
    pathPrefix: "",
};

const hetznerConfig = {
    region: "fsn1",
    bucket: "hetzner-bucket",
    accessKeyId: "KEY",
    secretAccessKey: "SECRET",
    pathPrefix: "",
};

const adapters = [
    { name: "S3GenericAdapter", adapter: S3GenericAdapter, config: genericConfig },
    { name: "S3AWSAdapter", adapter: S3AWSAdapter, config: awsConfig },
    { name: "S3R2Adapter", adapter: S3R2Adapter, config: r2Config },
    { name: "S3HetznerAdapter", adapter: S3HetznerAdapter, config: hetznerConfig },
];

// --- Tests for shared S3 logic (run once via Generic, then spot-check variants) ---

describe("S3 Adapters - shared logic via S3GenericAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ===== upload() =====

    describe("upload()", () => {
        it("returns true on successful upload", async () => {
            mockUploadDone.mockResolvedValue({});

            const result = await S3GenericAdapter.upload(genericConfig, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockUploadDone).toHaveBeenCalled();
        });

        it("returns false when Upload throws", async () => {
            mockUploadDone.mockRejectedValue(new Error("Network error"));

            const result = await S3GenericAdapter.upload(genericConfig, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("calls onProgress via httpUploadProgress event", async () => {
            mockUploadDone.mockResolvedValue({});
            // Capture the httpUploadProgress callback
            let progressCb: ((p: any) => void) | undefined;
            mockUploadOn.mockImplementation((event: string, cb: (p: any) => void) => {
                if (event === "httpUploadProgress") progressCb = cb;
                return { on: mockUploadOn, done: mockUploadDone };
            });

            const onProgress = vi.fn();
            await S3GenericAdapter.upload(genericConfig, "/tmp/file.sql", "Job/file.sql", onProgress);

            progressCb?.({ loaded: 50, total: 100 });
            expect(onProgress).toHaveBeenCalledWith(50);
        });

        it("respects pathPrefix when building S3 key", async () => {
            const { Upload } = await import("@aws-sdk/lib-storage");
            mockUploadDone.mockResolvedValue({});

            const configWithPrefix = { ...genericConfig, pathPrefix: "backups/prod" };
            await S3GenericAdapter.upload(configWithPrefix, "/tmp/backup.sql", "Job/backup.sql");

            const uploadCtor = (Upload as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
            expect(uploadCtor.params.Key).toBe("backups/prod/Job/backup.sql");
        });

        it("calls onLog callback during upload", async () => {
            mockUploadDone.mockResolvedValue({});
            const onLog = vi.fn();

            await S3GenericAdapter.upload(genericConfig, "/tmp/backup.sql", "Job/backup.sql", undefined, onLog);

            expect(onLog).toHaveBeenCalledWith(expect.stringContaining("S3 upload"), "info", "storage");
        });
    });

    // ===== list() =====

    describe("list()", () => {
        it("returns mapped file list on success", async () => {
            mockSend.mockResolvedValue({
                Contents: [
                    { Key: "Job/backup.sql", Size: 1024, LastModified: new Date("2026-01-01") },
                    { Key: "Job/backup2.sql", Size: 2048, LastModified: new Date("2026-01-02") },
                ],
            });

            const result = await S3GenericAdapter.list(genericConfig, "Job");

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe("backup.sql");
            expect(result[0].size).toBe(1024);
        });

        it("returns empty array when Contents is undefined", async () => {
            mockSend.mockResolvedValue({ Contents: undefined });

            const result = await S3GenericAdapter.list(genericConfig, "Job");

            expect(result).toEqual([]);
        });

        it("throws on ListObjects error", async () => {
            mockSend.mockRejectedValue(new Error("Access Denied"));

            await expect(S3GenericAdapter.list(genericConfig, "Job")).rejects.toThrow("Access Denied");
        });

        // A folder marker is a key ending in "/". Recognising them by size instead threw away
        // every genuine empty file with them, which left an empty file out of a directory
        // backup and made it read as deleted everywhere the listing decides what exists.
        it("drops folder markers but keeps a genuinely empty file", async () => {
            mockSend.mockResolvedValue({
                Contents: [
                    { Key: "Job/", Size: 0, LastModified: new Date() },
                    { Key: "Job/empty.txt", Size: 0, LastModified: new Date() },
                    { Key: "Job/backup.sql", Size: 512, LastModified: new Date() },
                ],
            });

            const result = await S3GenericAdapter.list(genericConfig, "Job");

            expect(result.map((f) => f.name)).toEqual(["empty.txt", "backup.sql"]);
            expect(result[0].size).toBe(0);
        });

        // A marker's basename is the folder name ("backups/foo/" -> "foo"), so the trailing
        // slash has to be tested on the raw key, before basename and before the prefix strip.
        it("drops a nested folder marker whose basename looks like a file", async () => {
            mockSend.mockResolvedValue({
                Contents: [{ Key: "Job/nested/", Size: 0, LastModified: new Date() }],
            });

            expect(await S3GenericAdapter.list(genericConfig, "Job")).toEqual([]);
        });

        // S3 answers with at most 1000 keys per page, in lexicographic order. Reading only the
        // first page returned the alphabetically first keys, which for timestamped backup
        // names are the oldest - so every recent backup was invisible, silently.
        it("follows the continuation token until the listing is complete", async () => {
            mockSend
                .mockResolvedValueOnce({
                    Contents: [{ Key: "Job/a.sql", Size: 10, LastModified: new Date() }],
                    IsTruncated: true,
                    NextContinuationToken: "page-2",
                })
                .mockResolvedValueOnce({
                    Contents: [{ Key: "Job/b.sql", Size: 20, LastModified: new Date() }],
                    IsTruncated: false,
                });

            const result = await S3GenericAdapter.list(genericConfig, "Job");

            expect(result.map((f) => f.name)).toEqual(["a.sql", "b.sql"]);
            expect(mockSend).toHaveBeenCalledTimes(2);
            expect(mockSend.mock.calls[0][0].ContinuationToken).toBeUndefined();
            expect(mockSend.mock.calls[1][0].ContinuationToken).toBe("page-2");
        });

        it("stops after a truncated page that hands back no token", async () => {
            mockSend.mockResolvedValue({
                Contents: [{ Key: "Job/a.sql", Size: 10, LastModified: new Date() }],
                IsTruncated: true,
            });

            const result = await S3GenericAdapter.list(genericConfig, "Job");

            expect(result).toHaveLength(1);
            expect(mockSend).toHaveBeenCalledTimes(1);
        });
    });

    // ===== download() =====

    describe("download()", () => {
        it("returns true on successful download", async () => {
            const bodyStream = Readable.from(["data"]);
            (bodyStream as any).transformToString = vi.fn();
            mockSend.mockResolvedValue({ Body: bodyStream, ContentLength: 4 });

            const result = await S3GenericAdapter.download(genericConfig, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(true);
        });

        it("returns false when GetObject throws", async () => {
            mockSend.mockRejectedValue(new Error("NoSuchKey"));

            const result = await S3GenericAdapter.download(genericConfig, "Job/missing.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });

        it("returns false when Body is empty", async () => {
            mockSend.mockResolvedValue({ Body: null, ContentLength: 0 });

            const result = await S3GenericAdapter.download(genericConfig, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });
    });

    // ===== delete() =====

    describe("delete()", () => {
        it("returns true on successful delete", async () => {
            mockSend.mockResolvedValue({});

            const result = await S3GenericAdapter.delete(genericConfig, "Job/backup.sql");

            expect(result).toBe(true);
        });

        it("returns false when DeleteObject throws", async () => {
            mockSend.mockRejectedValue(new Error("Access Denied"));

            const result = await S3GenericAdapter.delete(genericConfig, "Job/backup.sql");

            expect(result).toBe(false);
        });
    });

    // ===== test() =====

    describe("test()", () => {
        it("returns success when put+delete succeed", async () => {
            mockSend.mockResolvedValue({});

            const result = await S3GenericAdapter.test!(genericConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successful");
        });

        it("returns failure message when connection fails", async () => {
            mockSend.mockRejectedValue(new Error("InvalidAccessKeyId"));

            const result = await S3GenericAdapter.test!(genericConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("InvalidAccessKeyId");
        });
    });

    // ===== read() =====

    describe("read()", () => {
        it("returns file content as string", async () => {
            const bodyMock = Readable.from([Buffer.from('{"checksum":"abc"}')]);
            mockSend.mockResolvedValue({ Body: bodyMock });

            const result = await S3GenericAdapter.read!(genericConfig, "Job/backup.sql.meta.json");

            expect(result).toBe('{"checksum":"abc"}');
        });

        it("returns null when file not found", async () => {
            mockSend.mockRejectedValue(new Error("NoSuchKey"));

            const result = await S3GenericAdapter.read!(genericConfig, "Job/missing.meta.json");

            expect(result).toBeNull();
        });

        it("returns null when Body is absent", async () => {
            mockSend.mockResolvedValue({ Body: null });

            const result = await S3GenericAdapter.read!(genericConfig, "Job/missing.meta.json");

            expect(result).toBeNull();
        });

        it("refuses a sidecar whose announced size passes the default limit before reading it", async () => {
            const body = Readable.from([Buffer.from("{}")]);
            mockSend.mockResolvedValue({ Body: body, ContentLength: SIDECAR_READ_LIMIT + 1 });

            await expect(S3GenericAdapter.read!(genericConfig, "Job/huge.meta.json")).rejects.toBeInstanceOf(FileTooLargeError);
        });

        it("stops a body that sends more than the limit, whatever it announced", async () => {
            let sent = 0;
            const body = new Readable({
                read() {
                    sent++;
                    this.push(Buffer.alloc(1024));
                },
            });
            mockSend.mockResolvedValue({ Body: body, ContentLength: 10 });

            await expect(S3GenericAdapter.readBytes!(genericConfig, "Job/x.index", { maxBytes: 4096 })).rejects.toBeInstanceOf(FileTooLargeError);
            expect(sent).toBeLessThan(16);
        });

        it("reads a binary file byte for byte", async () => {
            const bytes = Buffer.from([0xff, 0x00, 0xfe, 0x80]);
            mockSend.mockResolvedValue({ Body: Readable.from([bytes]) });

            expect(await S3GenericAdapter.readBytes!(genericConfig, "Job/x.index")).toEqual(bytes);
        });
    });
});

// --- Variant-specific tests ---

describe("S3 Adapter variants - configuration wiring", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("S3AWSAdapter - upload succeeds (no endpoint)", async () => {
        mockUploadDone.mockResolvedValue({});
        const result = await S3AWSAdapter.upload(awsConfig, "/tmp/file.sql", "Job/file.sql");
        expect(result).toBe(true);
    });

    it("S3AWSAdapter - storageClass passed to Upload params", async () => {
        const { Upload } = await import("@aws-sdk/lib-storage");
        mockUploadDone.mockResolvedValue({});

        await S3AWSAdapter.upload(awsConfig, "/tmp/file.sql", "Job/file.sql");

        const uploadParams = (Upload as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0].params;
        expect(uploadParams.StorageClass).toBe("STANDARD");
    });

    it("S3R2Adapter - standard endpoint from accountId", async () => {
        const { S3Client } = await import("@aws-sdk/client-s3");
        mockSend.mockResolvedValue({});

        await S3R2Adapter.test!(r2Config);

        const s3ClientConfig = (S3Client as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        expect(s3ClientConfig.endpoint).toBe("https://abc123.r2.cloudflarestorage.com");
    });

    it("S3R2Adapter - EU jurisdiction endpoint", async () => {
        const { S3Client } = await import("@aws-sdk/client-s3");
        mockSend.mockResolvedValue({});

        await S3R2Adapter.test!({ ...r2Config, jurisdiction: "eu" });

        const s3ClientConfig = (S3Client as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        expect(s3ClientConfig.endpoint).toBe("https://abc123.eu.r2.cloudflarestorage.com");
    });

    it("S3HetznerAdapter - Hetzner endpoint from region", async () => {
        const { S3Client } = await import("@aws-sdk/client-s3");
        mockSend.mockResolvedValue({});

        await S3HetznerAdapter.test!(hetznerConfig);

        const s3ClientConfig = (S3Client as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        expect(s3ClientConfig.endpoint).toBe("https://fsn1.your-objectstorage.com");
    });

    it("S3HetznerAdapter - upload delegates correctly", async () => {
        mockUploadDone.mockResolvedValue({});
        const result = await S3HetznerAdapter.upload(hetznerConfig, "/tmp/file.sql", "Job/file.sql");
        expect(result).toBe(true);
    });

    it("S3HetznerAdapter - list delegates correctly", async () => {
        mockSend.mockResolvedValue({ Contents: [{ Key: "Job/file.sql", Size: 100, LastModified: new Date() }] });
        const result = await S3HetznerAdapter.list(hetznerConfig, "Job");
        expect(result).toHaveLength(1);
    });

    it("S3HetznerAdapter - download delegates correctly", async () => {
        const bodyStream = Readable.from(["data"]);
        mockSend.mockResolvedValue({ Body: bodyStream, ContentLength: 4 });
        const result = await S3HetznerAdapter.download(hetznerConfig, "Job/file.sql", "/tmp/out.sql");
        expect(result).toBe(true);
    });

    it("S3HetznerAdapter - delete delegates correctly", async () => {
        mockSend.mockResolvedValue({});
        const result = await S3HetznerAdapter.delete(hetznerConfig, "Job/file.sql");
        expect(result).toBe(true);
    });

    it("S3HetznerAdapter - read delegates correctly", async () => {
        const bodyMock = Readable.from([Buffer.from("meta content")]);
        mockSend.mockResolvedValue({ Body: bodyMock });
        const result = await S3HetznerAdapter.read!(hetznerConfig, "Job/file.sql.meta.json");
        expect(result).toBe("meta content");
    });

    it("S3R2Adapter - read delegates correctly", async () => {
        const bodyMock = Readable.from([Buffer.from("r2 meta")]);
        mockSend.mockResolvedValue({ Body: bodyMock });
        const result = await S3R2Adapter.read!({ ...r2Config }, "Job/file.meta.json");
        expect(result).toBe("r2 meta");
    });

    it("all adapters expose required StorageAdapter interface methods", () => {
        for (const { name, adapter } of adapters) {
            expect(typeof adapter.upload, `${name}.upload`).toBe("function");
            expect(typeof adapter.download, `${name}.download`).toBe("function");
            expect(typeof adapter.list, `${name}.list`).toBe("function");
            expect(typeof adapter.delete, `${name}.delete`).toBe("function");
            expect(typeof adapter.test, `${name}.test`).toBe("function");
            expect(typeof adapter.read, `${name}.read`).toBe("function");
        }
    });

    // ===== S3AWSAdapter - all delegated methods =====

    it("S3AWSAdapter - list delegates correctly", async () => {
        mockSend.mockResolvedValue({ Contents: [{ Key: "Job/file.sql", Size: 100, LastModified: new Date() }] });
        const result = await S3AWSAdapter.list(awsConfig, "Job");
        expect(result).toHaveLength(1);
    });

    it("S3AWSAdapter - download delegates correctly", async () => {
        const bodyStream = Readable.from(["data"]);
        mockSend.mockResolvedValue({ Body: bodyStream, ContentLength: 4 });
        const result = await S3AWSAdapter.download(awsConfig, "Job/file.sql", "/tmp/out.sql");
        expect(result).toBe(true);
    });

    it("S3AWSAdapter - delete delegates correctly", async () => {
        mockSend.mockResolvedValue({});
        const result = await S3AWSAdapter.delete(awsConfig, "Job/file.sql");
        expect(result).toBe(true);
    });

    it("S3AWSAdapter - test delegates correctly", async () => {
        mockSend.mockResolvedValue({});
        const result = await S3AWSAdapter.test!(awsConfig);
        expect(result.success).toBe(true);
    });

    it("S3AWSAdapter - read delegates correctly", async () => {
        const bodyMock = Readable.from([Buffer.from("aws meta")]);
        mockSend.mockResolvedValue({ Body: bodyMock });
        const result = await S3AWSAdapter.read!(awsConfig, "Job/file.meta.json");
        expect(result).toBe("aws meta");
    });

    // ===== S3R2Adapter - all delegated methods =====

    it("S3R2Adapter - upload delegates correctly", async () => {
        mockUploadDone.mockResolvedValue({});
        const result = await S3R2Adapter.upload(r2Config, "/tmp/file.sql", "Job/file.sql");
        expect(result).toBe(true);
    });

    it("S3R2Adapter - list delegates correctly", async () => {
        mockSend.mockResolvedValue({ Contents: [{ Key: "Job/file.sql", Size: 100, LastModified: new Date() }] });
        const result = await S3R2Adapter.list(r2Config, "Job");
        expect(result).toHaveLength(1);
    });

    it("S3R2Adapter - download delegates correctly", async () => {
        const bodyStream = Readable.from(["data"]);
        mockSend.mockResolvedValue({ Body: bodyStream, ContentLength: 4 });
        const result = await S3R2Adapter.download(r2Config, "Job/file.sql", "/tmp/out.sql");
        expect(result).toBe(true);
    });

    it("S3R2Adapter - delete delegates correctly", async () => {
        mockSend.mockResolvedValue({});
        const result = await S3R2Adapter.delete(r2Config, "Job/file.sql");
        expect(result).toBe(true);
    });
});

// --- Download progress tracker transform body coverage (lines 132-140) ---

describe("S3 download progress tracker transform body", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("invokes onProgress via tracker transform when onProgress and total > 0", async () => {
        const bodyStream = Readable.from(["data"]);
        mockSend.mockResolvedValue({ Body: bodyStream, ContentLength: 1024 });

        const onProgress = vi.fn();

        // Override pipeline to invoke the tracker's _transform so lines 132-140 run
        mockPipeline.mockImplementationOnce(async (_src: any, tracker: any, _dst: any) => {
            if (tracker && tracker._transform) {
                tracker._transform(Buffer.from("chunk"), "buffer", () => {});
            }
        });

        const result = await S3GenericAdapter.download(genericConfig, "Job/backup.sql", "/tmp/out.sql", onProgress);

        expect(result).toBe(true);
        expect(onProgress).toHaveBeenCalled();
    });
});

// --- listTree(): the same listing, reported and interruptible while it runs ---
//
// Without it, listTreeForCollection() falls back to list(), which says nothing until it has
// finished and cannot be cancelled at all. Harmless while a listing stopped at 1000 keys, and
// not once it paginates: a large bucket lists for minutes behind a frozen progress row.
describe("S3 listTree()", () => {
    // mockReset on top of clearAllMocks, because clearing only drops recorded calls: a
    // `mockResolvedValueOnce` a test never consumed stays queued and answers the next one.
    beforeEach(() => {
        vi.clearAllMocks();
        mockSend.mockReset();
    });

    const twoPages = () => {
        mockSend
            .mockResolvedValueOnce({
                Contents: [
                    { Key: "Job/a.sql", Size: 10, LastModified: new Date() },
                    { Key: "Job/b.sql", Size: 20, LastModified: new Date() },
                ],
                IsTruncated: true,
                NextContinuationToken: "page-2",
            })
            .mockResolvedValueOnce({
                Contents: [{ Key: "Job/c.sql", Size: 30, LastModified: new Date() }],
                IsTruncated: false,
            });
    };

    it("returns every page and reports no pruned directories", async () => {
        twoPages();

        const result = await S3GenericAdapter.listTree!(genericConfig, "Job");

        expect(result.files.map((f) => f.name)).toEqual(["a.sql", "b.sql", "c.sql"]);
        expect(result.pruned).toEqual([]);
        expect(result.unsupportedSymlinks).toBeUndefined();
    });

    it("reports progress once per page with a growing file count", async () => {
        twoPages();
        const seen: number[] = [];

        await S3GenericAdapter.listTree!(genericConfig, "Job", {
            onProgress: ({ files }) => seen.push(files),
        });

        expect(seen).toEqual([2, 3]);
    });

    it("reports a flat scan as having no directories", async () => {
        mockSend.mockResolvedValue({
            Contents: [{ Key: "Job/a.sql", Size: 10, LastModified: new Date() }],
        });
        const seen: Array<{ directories: number; prunedDirectories: number; currentPath: string }> = [];

        await S3GenericAdapter.listTree!(genericConfig, "Job", {
            onProgress: ({ directories, prunedDirectories, currentPath }) =>
                seen.push({ directories, prunedDirectories, currentPath }),
        });

        expect(seen).toEqual([{ directories: 0, prunedDirectories: 0, currentPath: "" }]);
    });

    it("stops when the signal is already aborted, without listing anything", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            S3GenericAdapter.listTree!(genericConfig, "Job", { signal: controller.signal })
        ).rejects.toThrow();
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("stops between pages when the signal fires mid-listing", async () => {
        const controller = new AbortController();
        mockSend
            .mockImplementationOnce(async () => {
                controller.abort();
                return {
                    Contents: [{ Key: "Job/a.sql", Size: 10, LastModified: new Date() }],
                    IsTruncated: true,
                    NextContinuationToken: "page-2",
                };
            })
            .mockResolvedValueOnce({ Contents: [], IsTruncated: false });

        await expect(
            S3GenericAdapter.listTree!(genericConfig, "Job", { signal: controller.signal })
        ).rejects.toThrow();
        // The second page is never requested.
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("is exposed by every S3 adapter variant", () => {
        for (const { adapter } of adapters) {
            expect(typeof adapter.listTree).toBe("function");
        }
    });

    it("returns prefix-relative paths, same as list()", async () => {
        mockSend.mockResolvedValue({
            Contents: [{ Key: "test/Images/a.jpg", Size: 10, LastModified: new Date() }],
        });

        const result = await S3GenericAdapter.listTree!({ ...genericConfig, pathPrefix: "test" }, "");

        expect(result.files[0].path).toBe("Images/a.jpg");
    });
});

// --- pathPrefix: the adapter root, honoured symmetrically across every operation ---
//
// The regression this pins: list() used to return full bucket keys (prefix included) while
// download/delete consumed them raw. That leaked the prefix into stored file paths - a
// directory backup rooted at prefix "test" recorded "test/Images/..." and restoring it built
// a second "test" folder. Object storage has no real directories, so the adapter has to
// impose the same "paths are relative to the configured root" contract every other adapter
// already keeps.
describe("S3 pathPrefix is the adapter root", () => {
    beforeEach(() => vi.clearAllMocks());

    const prefixed = { ...genericConfig, pathPrefix: "test" };

    it("list() returns paths relative to the prefix, not full bucket keys", async () => {
        mockSend.mockResolvedValue({
            Contents: [
                { Key: "test/Images/a.jpg", Size: 10, LastModified: new Date() },
                { Key: "test/Java/b.jar", Size: 20, LastModified: new Date() },
            ],
        });

        const result = await S3GenericAdapter.list(prefixed, "");

        expect(result.map((f) => f.path)).toEqual(["Images/a.jpg", "Java/b.jar"]);
        // The listing itself is still scoped to the prefix.
        expect(mockSend.mock.calls[0][0].Prefix).toBe("test/");
    });

    // The prefix strip runs per object, so it has to survive pagination. A second page whose
    // keys still carried the prefix would produce exactly the "test/test/..." drift above.
    it("strips the prefix on every page of a paginated listing", async () => {
        mockSend
            .mockResolvedValueOnce({
                Contents: [{ Key: "test/Images/a.jpg", Size: 10, LastModified: new Date() }],
                IsTruncated: true,
                NextContinuationToken: "page-2",
            })
            .mockResolvedValueOnce({
                Contents: [{ Key: "test/Java/b.jar", Size: 20, LastModified: new Date() }],
                IsTruncated: false,
            });

        const result = await S3GenericAdapter.list(prefixed, "");

        expect(result.map((f) => f.path)).toEqual(["Images/a.jpg", "Java/b.jar"]);
        expect(mockSend.mock.calls[1][0].Prefix).toBe("test/");
    });

    it("download() re-applies the prefix to a prefix-relative path", async () => {
        const body = Readable.from(["x"]);
        (body as any).transformToString = vi.fn();
        mockSend.mockResolvedValue({ Body: body, ContentLength: 1 });

        await S3GenericAdapter.download(prefixed, "Images/a.jpg", "/tmp/out");

        expect(mockSend.mock.calls[0][0].Key).toBe("test/Images/a.jpg");
    });

    it("delete() re-applies the prefix", async () => {
        mockSend.mockResolvedValue({});
        await S3GenericAdapter.delete(prefixed, "Images/a.jpg");
        expect(mockSend.mock.calls[0][0].Key).toBe("test/Images/a.jpg");
    });

    it("read() re-applies the prefix", async () => {
        mockSend.mockResolvedValue({ Body: Readable.from([Buffer.from("{}")]) });
        await S3GenericAdapter.read!(prefixed, "Images/a.jpg.meta.json");
        expect(mockSend.mock.calls[0][0].Key).toBe("test/Images/a.jpg.meta.json");
    });

    it("downloadRange() re-applies the prefix", async () => {
        const body = Readable.from(["x"]);
        mockSend.mockResolvedValue({ Body: body });
        await S3R2Adapter.downloadRange!({ ...r2Config, pathPrefix: "test" }, "job/full-0.tar", 0, 9);
        expect(mockSend.mock.calls[0][0].Key).toBe("test/job/full-0.tar");
        expect(mockSend.mock.calls[0][0].Range).toBe("bytes=0-9");
    });

    // The load-bearing property: whatever list() hands back can be fed straight into
    // download() and lands on the exact object it came from. If either half stopped honouring
    // the prefix, this key would drift (missing prefix) or double it ("test/test/...").
    it("round-trips a listed path back to its original key (R2, the reported case)", async () => {
        const r2Prefixed = { ...r2Config, pathPrefix: "test" };
        mockSend.mockResolvedValue({ Contents: [{ Key: "test/Images/a.jpg", Size: 10, LastModified: new Date() }] });
        const listed = await S3R2Adapter.list(r2Prefixed, "");
        expect(listed[0].path).toBe("Images/a.jpg");

        mockSend.mockClear();
        const body = Readable.from(["x"]);
        (body as any).transformToString = vi.fn();
        mockSend.mockResolvedValue({ Body: body, ContentLength: 1 });
        await S3R2Adapter.download(r2Prefixed, listed[0].path, "/tmp/out");

        expect(mockSend.mock.calls[0][0].Key).toBe("test/Images/a.jpg");
    });

    it("is a no-op when no prefix is configured", async () => {
        mockSend.mockResolvedValue({ Contents: [{ Key: "Images/a.jpg", Size: 10, LastModified: new Date() }] });
        const listed = await S3GenericAdapter.list(genericConfig, "");
        expect(listed[0].path).toBe("Images/a.jpg");

        mockSend.mockClear();
        mockSend.mockResolvedValue({});
        await S3GenericAdapter.delete(genericConfig, "Images/a.jpg");
        expect(mockSend.mock.calls[0][0].Key).toBe("Images/a.jpg");
    });
});
