import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";
import { Upload } from "@aws-sdk/lib-storage";
import {
    S3GenericAdapter,
    S3AWSAdapter,
    S3R2Adapter,
    S3HetznerAdapter,
} from "@/lib/adapters/storage/s3";
import { DEFAULT_S3_UPLOAD_TUNING } from "@/lib/adapters/s3-upload-tuning";

const MB = 1024 * 1024;

const { mockUploadDone, mockStat } = vi.hoisted(() => ({
    mockUploadDone: vi.fn(),
    mockStat: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: vi.fn(function (this: Record<string, unknown>) {
        this.send = vi.fn().mockResolvedValue({});
        this.destroy = vi.fn();
        // Every client bounds what it reads of an answer, see `s3-response-limit.ts`.
        this.middlewareStack = { add: vi.fn() };
    }),
    ListObjectsV2Command: vi.fn(),
    GetObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    PutObjectCommand: vi.fn(),
    HeadObjectCommand: vi.fn(),
    HeadBucketCommand: vi.fn(),
    StorageClass: {},
}));

vi.mock("@aws-sdk/lib-storage", () => ({
    Upload: vi.fn(function (this: Record<string, unknown>) {
        this.on = vi.fn();
        this.done = mockUploadDone;
    }),
}));

vi.mock("fs", () => {
    const mod = {
        createReadStream: vi.fn(() => Readable.from(["data"])),
        createWriteStream: vi.fn(),
    };
    return { ...mod, default: mod };
});

vi.mock("fs/promises", () => {
    const mod = { stat: mockStat };
    return { ...mod, default: mod };
});

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("@/lib/logging/errors", () => ({ wrapError: (e: unknown) => e }));

const genericConfig = {
    endpoint: "https://s3.example.com",
    region: "us-east-1",
    bucket: "my-bucket",
    accessKeyId: "KEY",
    secretAccessKey: "SECRET",
    pathPrefix: "",
};

/** The options `new Upload()` was constructed with on the most recent call. */
function lastUploadOptions() {
    return (Upload as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
}

describe("S3 multipart upload tuning reaches the SDK", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUploadDone.mockResolvedValue({});
        mockStat.mockResolvedValue({ size: 2 * 1024 * MB });
    });

    it("uploads with DBackup's defaults rather than the SDK's 4 parts of 5 MB", async () => {
        await S3GenericAdapter.upload(genericConfig as never, "/tmp/backup.tar", "Job/backup.tar");

        const options = lastUploadOptions();
        expect(options.queueSize).toBe(DEFAULT_S3_UPLOAD_TUNING.concurrency.default);
        expect(options.partSize).toBe(DEFAULT_S3_UPLOAD_TUNING.partSizeMb.default * MB);
    });

    it("uses what the connection stored", async () => {
        await S3GenericAdapter.upload(
            { ...genericConfig, uploadConcurrency: 24, uploadPartSizeMb: 32 } as never,
            "/tmp/backup.tar",
            "Job/backup.tar"
        );

        const options = lastUploadOptions();
        expect(options.queueSize).toBe(24);
        expect(options.partSize).toBe(32 * MB);
    });

    it("clamps a stored value that would otherwise multiply straight into memory", async () => {
        // Large enough that the ceiling is what limits the part size rather than the derivation
        // that keeps every connection fed, so this asserts the clamp and nothing else.
        mockStat.mockResolvedValue({ size: 16 * 1024 * MB });

        await S3GenericAdapter.upload(
            { ...genericConfig, uploadConcurrency: 999, uploadPartSizeMb: 999 } as never,
            "/tmp/backup.tar",
            "Job/backup.tar"
        );

        const options = lastUploadOptions();
        expect(options.queueSize).toBe(DEFAULT_S3_UPLOAD_TUNING.concurrency.max);
        expect(options.partSize).toBe(DEFAULT_S3_UPLOAD_TUNING.partSizeMb.max * MB);
    });

    it("lowers the part size when the archive would leave connections without one", async () => {
        // The R2 measurement: 1.39 GB at 32 parts of 64 MB is 21 parts, so 11 connections idled
        // and the upload took as long as one part.
        const archive = 1_387_008_512;
        mockStat.mockResolvedValue({ size: archive });

        await S3GenericAdapter.upload(
            { ...genericConfig, uploadConcurrency: 32, uploadPartSizeMb: 64 } as never,
            "/tmp/backup.tar",
            "Job/backup.tar"
        );

        const { queueSize, partSize } = lastUploadOptions();
        expect(partSize).toBeLessThan(64 * MB);
        expect(Math.ceil(archive / partSize)).toBeGreaterThanOrEqual(queueSize);
    });

    it("raises the part size so a large archive stays under S3's 10,000-part limit", async () => {
        const size = 500 * 1024 * MB;
        mockStat.mockResolvedValue({ size });

        await S3GenericAdapter.upload(genericConfig as never, "/tmp/huge.tar", "Job/huge.tar");

        const { partSize } = lastUploadOptions();
        expect(Math.ceil(size / partSize)).toBeLessThanOrEqual(10_000);
    });

    it("still uploads when the file cannot be stat'd", async () => {
        // The size only picks the part size. Losing it must not lose the backup.
        mockStat.mockRejectedValue(new Error("ENOENT"));

        const result = await S3GenericAdapter.upload(genericConfig as never, "/tmp/x.tar", "Job/x.tar");

        expect(result).toBe(true);
        expect(lastUploadOptions().partSize).toBe(DEFAULT_S3_UPLOAD_TUNING.partSizeMb.default * MB);
    });

    it.each([
        ["S3AWSAdapter", S3AWSAdapter, { region: "us-east-1", bucket: "b", accessKeyId: "K", secretAccessKey: "S" }],
        ["S3R2Adapter", S3R2Adapter, { accountId: "abc", bucket: "b", accessKeyId: "K", secretAccessKey: "S" }],
        ["S3HetznerAdapter", S3HetznerAdapter, { region: "fsn1", bucket: "b", accessKeyId: "K", secretAccessKey: "S" }],
    ])("wires the stored values through on %s", async (_name, adapter, config) => {
        // One adapter missing its wiring would silently fall back to the defaults, which is the
        // one failure this change cannot notice by itself.
        await adapter.upload(
            { ...config, uploadConcurrency: 12, uploadPartSizeMb: 16 } as never,
            "/tmp/backup.tar",
            "Job/backup.tar"
        );

        const options = lastUploadOptions();
        expect(options.queueSize).toBe(12);
        expect(options.partSize).toBe(16 * MB);
    });
});
