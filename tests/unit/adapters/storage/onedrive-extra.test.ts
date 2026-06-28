import { describe, it, expect, vi, beforeEach } from "vitest";
import { OneDriveAdapter } from "@/lib/adapters/storage/onedrive";

// --- Hoisted mocks ---
const { mockClient, mockFetch, mockFs, mockPipeline } = vi.hoisted(() => ({
    mockClient: { api: vi.fn() },
    mockFetch: vi.fn(),
    mockFs: { stat: vi.fn(), mkdir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
    mockPipeline: vi.fn().mockResolvedValue(undefined),
}));

const mockApiChain = {
    select: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    top: vi.fn().mockReturnThis(),
    orderby: vi.fn().mockReturnThis(),
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
};

vi.mock("@microsoft/microsoft-graph-client", () => ({
    Client: {
        init: vi.fn((opts: any) => {
            if (opts?.authProvider) {
                opts.authProvider((_err: unknown, _token: unknown) => {});
            }
            return mockClient;
        }),
    },
}));

vi.mock("fs/promises", () => ({
    default: {
        stat: (...args: unknown[]) => mockFs.stat(...args),
        mkdir: (...args: unknown[]) => mockFs.mkdir(...args),
        readFile: (...args: unknown[]) => mockFs.readFile(...args),
        writeFile: (...args: unknown[]) => mockFs.writeFile(...args),
    },
}));

vi.mock("fs", () => ({
    default: { createReadStream: vi.fn(), createWriteStream: vi.fn() },
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
}));

vi.mock("stream/promises", () => ({
    pipeline: mockPipeline,
    default: { pipeline: mockPipeline },
}));

const validConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    refreshToken: "test-refresh-token",
    folderPath: "backups",
};

function mockTokenRefresh() {
    mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "mock-access-token" }),
    });
}

describe("OneDriveAdapter - openSession", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApiChain.select.mockReturnThis();
        mockApiChain.get.mockReset();
        mockClient.api.mockReturnValue(mockApiChain);
        vi.stubGlobal("fetch", mockFetch);
    });

    it("authenticates and returns a session with upload and close methods", async () => {
        mockTokenRefresh();
        mockFs.stat.mockResolvedValue({ size: 100 });

        const logs: string[] = [];
        const onLog = (msg: string) => logs.push(msg);

        const session = await OneDriveAdapter.openSession!(validConfig, onLog);

        expect(session).toBeDefined();
        expect(typeof session.upload).toBe("function");
        expect(typeof session.close).toBe("function");
        expect(logs.some((m) => m.toLowerCase().includes("authenticated"))).toBe(true);
    });

    it("returns a session without onLog callback", async () => {
        mockTokenRefresh();
        mockFs.stat.mockResolvedValue({ size: 100 });

        const session = await OneDriveAdapter.openSession!(validConfig);

        expect(session).toBeDefined();
        expect(typeof session.upload).toBe("function");
    });

    it("session.close() resolves without error", async () => {
        mockTokenRefresh();
        mockFs.stat.mockResolvedValue({ size: 100 });

        const session = await OneDriveAdapter.openSession!(validConfig);
        await expect(session.close()).resolves.toBeUndefined();
    });
});

describe("OneDriveAdapter - ping", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApiChain.select.mockReturnThis();
        mockApiChain.get.mockReset();
        mockClient.api.mockReturnValue(mockApiChain);
        vi.stubGlobal("fetch", mockFetch);
    });

    it("returns success when the drive is accessible", async () => {
        mockTokenRefresh();
        mockApiChain.get.mockResolvedValueOnce({ id: "drive-id" });

        const result = await OneDriveAdapter.ping!(validConfig);

        expect(result.success).toBe(true);
        expect(result.message).toBe("Connection successful");
    });

    it("returns failure with re-authorization message on invalid_grant error", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ access_token: "token" }),
        });
        mockApiChain.get.mockRejectedValueOnce(new Error("invalid_grant: Refresh token expired"));

        const result = await OneDriveAdapter.ping!(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain("Authorization expired");
    });

    it("returns failure with re-authorization message on AADSTS error", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ access_token: "token" }),
        });
        mockApiChain.get.mockRejectedValueOnce(new Error("AADSTS70011: The provided request must include a 'response_type'"));

        const result = await OneDriveAdapter.ping!(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain("Authorization expired");
    });

    it("returns generic failure message on unexpected error", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ access_token: "token" }),
        });
        mockApiChain.get.mockRejectedValueOnce(new Error("Network timeout"));

        const result = await OneDriveAdapter.ping!(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain("OneDrive connection failed");
        expect(result.message).toContain("Network timeout");
    });
});

describe("OneDriveAdapter - verifyChecksum", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApiChain.select.mockReturnThis();
        mockApiChain.get.mockReset();
        mockClient.api.mockReturnValue(mockApiChain);
        vi.stubGlobal("fetch", mockFetch);
    });

    it("returns 'unsupported' when no sha256 checksum is provided", async () => {
        const result = await OneDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/file.sql",
            { md5: "abc123" }
        );
        expect(result).toBe("unsupported");
    });

    it("returns 'passed' when sha256 matches", async () => {
        mockTokenRefresh();
        // sha256 "aabbccdd" in hex -> base64
        const hex = "aabbccdd";
        const base64 = Buffer.from(hex, "hex").toString("base64");
        mockApiChain.get.mockResolvedValueOnce({
            file: { hashes: { sha256Hash: base64 } },
        });

        const result = await OneDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/file.sql",
            { sha256: hex }
        );
        expect(result).toBe("passed");
    });

    it("returns 'failed' when sha256 does not match", async () => {
        mockTokenRefresh();
        const base64 = Buffer.from("deadbeef", "hex").toString("base64");
        mockApiChain.get.mockResolvedValueOnce({
            file: { hashes: { sha256Hash: base64 } },
        });

        const result = await OneDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/file.sql",
            { sha256: "aabbccdd" }
        );
        expect(result).toBe("failed");
    });

    it("returns 'unsupported' when item has no sha256Hash field", async () => {
        mockTokenRefresh();
        mockApiChain.get.mockResolvedValueOnce({ file: { hashes: {} } });

        const result = await OneDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/file.sql",
            { sha256: "aabbccdd" }
        );
        expect(result).toBe("unsupported");
    });

    it("returns 'unsupported' on error", async () => {
        mockTokenRefresh();
        mockApiChain.get.mockRejectedValueOnce(new Error("Not found"));

        const result = await OneDriveAdapter.verifyChecksum!(
            validConfig,
            "backups/missing.sql",
            { sha256: "aabbccdd" }
        );
        expect(result).toBe("unsupported");
    });
});
