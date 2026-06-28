import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleDriveAdapter } from "@/lib/adapters/storage/google-drive";

// --- Hoisted mocks ---
const { mockDrive, mockSetCredentials } = vi.hoisted(() => ({
    mockDrive: {
        files: {
            list: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            get: vi.fn(),
            delete: vi.fn(),
        },
    },
    mockSetCredentials: vi.fn(),
}));

vi.mock("googleapis", () => {
    class MockOAuth2 {
        setCredentials = mockSetCredentials;
    }
    return {
        google: {
            auth: { OAuth2: MockOAuth2 },
            drive: vi.fn(() => mockDrive),
        },
    };
});

vi.mock("fs/promises", () => ({
    default: { stat: vi.fn(), mkdir: vi.fn() },
}));

vi.mock("fs", () => ({
    default: { createReadStream: vi.fn(), createWriteStream: vi.fn() },
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
}));

vi.mock("stream/promises", () => ({
    pipeline: vi.fn().mockResolvedValue(undefined),
    default: { pipeline: vi.fn().mockResolvedValue(undefined) },
}));

const validConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    refreshToken: "test-refresh-token",
    folderId: "root-folder-id",
};

describe("GoogleDriveAdapter - verifyChecksum", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 'unsupported' when no md5 checksum is provided", async () => {
        const result = await GoogleDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/file.sql",
            { sha256: "abc123" }
        );
        expect(result).toBe("unsupported");
    });

    it("returns 'passed' when md5 matches the file on Google Drive", async () => {
        // list returns a file
        mockDrive.files.list.mockResolvedValue({
            data: { files: [{ id: "file-id-123", name: "file.sql" }] },
        });
        // get returns the md5
        mockDrive.files.get.mockResolvedValue({
            data: { md5Checksum: "AABBCCDD" },
        });

        const result = await GoogleDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/file.sql",
            { md5: "aabbccdd" }
        );
        expect(result).toBe("passed");
    });

    it("returns 'failed' when md5 does not match", async () => {
        mockDrive.files.list.mockResolvedValue({
            data: { files: [{ id: "file-id-123", name: "file.sql" }] },
        });
        mockDrive.files.get.mockResolvedValue({
            data: { md5Checksum: "DEADBEEF" },
        });

        const result = await GoogleDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/file.sql",
            { md5: "aabbccdd" }
        );
        expect(result).toBe("failed");
    });

    it("returns 'unsupported' when the file is not found on Google Drive", async () => {
        mockDrive.files.list.mockResolvedValue({
            data: { files: [] },
        });

        const result = await GoogleDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/missing.sql",
            { md5: "aabbccdd" }
        );
        expect(result).toBe("unsupported");
    });

    it("returns 'unsupported' when the file has no md5Checksum field", async () => {
        mockDrive.files.list.mockResolvedValue({
            data: { files: [{ id: "file-id-123", name: "file.sql" }] },
        });
        mockDrive.files.get.mockResolvedValue({
            data: {},
        });

        const result = await GoogleDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/file.sql",
            { md5: "aabbccdd" }
        );
        expect(result).toBe("unsupported");
    });

    it("returns 'unsupported' on error", async () => {
        mockDrive.files.list.mockRejectedValue(new Error("Network error"));

        const result = await GoogleDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/file.sql",
            { md5: "aabbccdd" }
        );
        expect(result).toBe("unsupported");
    });
});

describe("GoogleDriveAdapter - ping", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns success when folder is accessible", async () => {
        mockDrive.files.get.mockResolvedValue({ data: { id: "root-folder-id" } });

        const result = await GoogleDriveAdapter.ping!(validConfig);

        expect(result.success).toBe(true);
        expect(result.message).toBe("Connection successful");
    });

    it("returns failure with expired token message on invalid_grant error", async () => {
        mockDrive.files.get.mockRejectedValue(new Error("invalid_grant: Token has been expired"));

        const result = await GoogleDriveAdapter.ping!(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain("Authorization expired");
    });

    it("returns failure with expired token message on Token has been expired error", async () => {
        mockDrive.files.get.mockRejectedValue(new Error("Token has been expired or revoked"));

        const result = await GoogleDriveAdapter.ping!(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain("Authorization expired");
    });

    it("returns generic failure message on unexpected error", async () => {
        mockDrive.files.get.mockRejectedValue(new Error("DNS resolution failed"));

        const result = await GoogleDriveAdapter.ping!(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain("Google Drive connection failed");
        expect(result.message).toContain("DNS resolution failed");
    });
});
