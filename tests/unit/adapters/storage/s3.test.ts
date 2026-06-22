import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";
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
    });
    return {
        S3Client: MockS3Client,
        ListObjectsV2Command: vi.fn(function (this: Record<string, unknown>, params: unknown) {
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

        it("filters out zero-size entries (virtual folder markers)", async () => {
            mockSend.mockResolvedValue({
                Contents: [
                    { Key: "Job/", Size: 0, LastModified: new Date() },
                    { Key: "Job/backup.sql", Size: 512, LastModified: new Date() },
                ],
            });

            const result = await S3GenericAdapter.list(genericConfig, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
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
            const bodyMock = { transformToString: vi.fn().mockResolvedValue('{"checksum":"abc"}') };
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
        const bodyMock = { transformToString: vi.fn().mockResolvedValue("meta content") };
        mockSend.mockResolvedValue({ Body: bodyMock });
        const result = await S3HetznerAdapter.read!(hetznerConfig, "Job/file.sql.meta.json");
        expect(result).toBe("meta content");
    });

    it("S3R2Adapter - read delegates correctly", async () => {
        const bodyMock = { transformToString: vi.fn().mockResolvedValue("r2 meta") };
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
        const bodyMock = { transformToString: vi.fn().mockResolvedValue("aws meta") };
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
