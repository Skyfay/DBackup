import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";
import { S3R2Adapter, S3HetznerAdapter } from "@/lib/adapters/storage/s3";

// --- Hoisted mocks ---
const { mockSend, mockUploadDone, mockUploadOn, mockS3ClientCtor } = vi.hoisted(() => {
    const mockSend = vi.fn();
    const mockUploadDone = vi.fn();
    const mockUploadOn = vi.fn();
    // Capture the S3Client constructor argument for assertion in tests.
    const mockS3ClientCtor = vi.fn();
    return { mockSend, mockUploadDone, mockUploadOn, mockS3ClientCtor };
});

vi.mock("@aws-sdk/client-s3", () => {
    const MockS3Client = vi.fn(function (this: Record<string, unknown>, params: unknown) {
        mockS3ClientCtor(params);
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
        HeadObjectCommand: vi.fn(function (this: Record<string, unknown>, params: unknown) {
            Object.assign(this, { _type: "head" }, params as object);
        }),
        HeadBucketCommand: vi.fn(function (this: Record<string, unknown>, params: unknown) {
            Object.assign(this, { _type: "headbucket" }, params as object);
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
    pipeline: vi.fn().mockResolvedValue(undefined),
    default: { pipeline: vi.fn().mockResolvedValue(undefined) },
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

// ─── Configs ───────────────────────────────────────────────────────────────

const baseR2Config = {
    accountId: "abc123",
    bucket: "r2-bucket",
    accessKeyId: "KEY",
    secretAccessKey: "SECRET",
    pathPrefix: "",
    jurisdiction: undefined as string | undefined,
};

const hetznerConfig = {
    region: "fsn1",
    bucket: "hetzner-bucket",
    accessKeyId: "KEY",
    secretAccessKey: "SECRET",
    pathPrefix: "",
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Returns the S3Client constructor options captured during the last call. */
function lastClientConfig(): Record<string, unknown> {
    const calls = mockS3ClientCtor.mock.calls;
    return calls[calls.length - 1][0] as Record<string, unknown>;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("S3R2Adapter - config transformation (endpoint / region)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUploadDone.mockResolvedValue({});
        mockSend.mockResolvedValue({ Contents: [] });
    });

    it("builds the standard R2 endpoint when jurisdiction is not set", async () => {
        await S3R2Adapter.list({ ...baseR2Config, jurisdiction: undefined }, "");

        expect(lastClientConfig().endpoint).toBe(
            "https://abc123.r2.cloudflarestorage.com"
        );
        expect(lastClientConfig().region).toBe("auto");
    });

    it("builds the EU R2 endpoint when jurisdiction is 'eu'", async () => {
        await S3R2Adapter.ping!({ ...baseR2Config, jurisdiction: "eu" });

        expect(lastClientConfig().endpoint).toBe(
            "https://abc123.eu.r2.cloudflarestorage.com"
        );
    });

    it("builds the FedRAMP R2 endpoint when jurisdiction is 'fedramp'", async () => {
        await S3R2Adapter.ping!({ ...baseR2Config, jurisdiction: "fedramp" });

        expect(lastClientConfig().endpoint).toBe(
            "https://abc123.fedramp.r2.cloudflarestorage.com"
        );
    });

    it("uses region 'auto' for all R2 operations", async () => {
        await S3R2Adapter.list({ ...baseR2Config }, "");

        expect(lastClientConfig().region).toBe("auto");
    });

    it("passes correct credentials to S3Client", async () => {
        await S3R2Adapter.list({ ...baseR2Config }, "");

        const creds = lastClientConfig().credentials as Record<string, string>;
        expect(creds.accessKeyId).toBe("KEY");
        expect(creds.secretAccessKey).toBe("SECRET");
    });

    it("ping() returns success when HeadBucketCommand succeeds", async () => {
        mockSend.mockResolvedValue({});

        const result = await S3R2Adapter.ping!({ ...baseR2Config });

        expect(result.success).toBe(true);
    });

    it("ping() returns failure when S3Client throws", async () => {
        mockSend.mockRejectedValue(new Error("Access denied"));

        const result = await S3R2Adapter.ping!({ ...baseR2Config });

        expect(result.success).toBe(false);
    });

    it("upload() passes the correct bucket to the Upload params", async () => {
        const { Upload } = await import("@aws-sdk/lib-storage");
        const MockUpload = Upload as unknown as ReturnType<typeof vi.fn>;

        mockUploadDone.mockResolvedValue({});
        await S3R2Adapter.upload({ ...baseR2Config }, "/tmp/file.sql", "Job/file.sql");

        const uploadParams = MockUpload.mock.calls[MockUpload.mock.calls.length - 1][0];
        expect(uploadParams.params.Bucket).toBe("r2-bucket");
    });
});

describe("S3HetznerAdapter - config transformation (endpoint / region)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUploadDone.mockResolvedValue({});
        mockSend.mockResolvedValue({ Contents: [] });
    });

    it("builds endpoint from region: https://<region>.your-objectstorage.com", async () => {
        await S3HetznerAdapter.list(hetznerConfig, "");

        expect(lastClientConfig().endpoint).toBe(
            "https://fsn1.your-objectstorage.com"
        );
    });

    it("passes the region value as S3Client region", async () => {
        await S3HetznerAdapter.list(hetznerConfig, "");

        expect(lastClientConfig().region).toBe("fsn1");
    });

    it("passes correct credentials to S3Client", async () => {
        await S3HetznerAdapter.list(hetznerConfig, "");

        const creds = lastClientConfig().credentials as Record<string, string>;
        expect(creds.accessKeyId).toBe("KEY");
        expect(creds.secretAccessKey).toBe("SECRET");
    });

    it("ping() returns success when HeadBucketCommand succeeds", async () => {
        mockSend.mockResolvedValue({});

        const result = await S3HetznerAdapter.ping!(hetznerConfig);

        expect(result.success).toBe(true);
    });

    it("ping() builds the correct endpoint for the connectivity check", async () => {
        mockSend.mockResolvedValue({});
        await S3HetznerAdapter.ping!(hetznerConfig);

        expect(lastClientConfig().endpoint).toBe(
            "https://fsn1.your-objectstorage.com"
        );
    });

    it("verifyChecksum() uses the correct endpoint", async () => {
        // Must provide sha256 or the function returns early before creating the S3Client.
        mockSend.mockResolvedValue({ Metadata: { "dbackup-sha256": "deadbeef" } });
        await S3HetznerAdapter.verifyChecksum!(hetznerConfig, "Job/file.sql", { sha256: "deadbeef" });

        expect(lastClientConfig().endpoint).toBe(
            "https://fsn1.your-objectstorage.com"
        );
    });
});
