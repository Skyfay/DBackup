import { describe, it, expect, vi, beforeEach } from "vitest";
import { OneDriveAdapter } from "@/lib/adapters/storage/onedrive";
import { Readable } from "stream";

// --- Hoisted mocks (available in vi.mock factories) ---
const { mockClient, mockFetch, mockFs } = vi.hoisted(() => ({
    mockClient: {
        api: vi.fn(),
    },
    mockFetch: vi.fn(),
    mockFs: {
        stat: vi.fn(),
        mkdir: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
    },
}));

// Track chained API calls
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
        init: vi.fn(() => mockClient),
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
    default: {
        createReadStream: vi.fn(() => Readable.from(["mock file data"])),
        createWriteStream: vi.fn(() => ({
            on: vi.fn(),
            end: vi.fn(),
            write: vi.fn(),
        })),
    },
    createReadStream: vi.fn(() => Readable.from(["mock file data"])),
    createWriteStream: vi.fn(() => ({
        on: vi.fn(),
        end: vi.fn(),
        write: vi.fn(),
    })),
}));

vi.mock("stream/promises", () => ({
    pipeline: vi.fn().mockResolvedValue(undefined),
    default: {
        pipeline: vi.fn().mockResolvedValue(undefined),
    },
}));

// --- Base config ---
const validConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    refreshToken: "test-refresh-token",
    folderPath: "backups",
};

const unauthorizedConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
};

// Helper to mock successful token refresh
function mockTokenRefresh() {
    mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "mock-access-token" }),
    });
}

describe("OneDriveAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset api chain mock
        mockApiChain.select.mockReturnThis();
        mockApiChain.filter.mockReturnThis();
        mockApiChain.top.mockReturnThis();
        mockApiChain.orderby.mockReturnThis();
        mockApiChain.get.mockReset();
        mockApiChain.put.mockReset();
        mockApiChain.post.mockReset();
        mockApiChain.delete.mockReset();

        // Setup client.api() to return the chain
        mockClient.api.mockReturnValue(mockApiChain);

        // Replace global fetch with mock
        vi.stubGlobal("fetch", mockFetch);
    });

    // ====================================================================
    // Authorization guard
    // ====================================================================
    describe("authorization guard", () => {
        it("should fail test() when no refreshToken is set", async () => {
            const result = await OneDriveAdapter.test(unauthorizedConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("not authorized");
        });

        it("should fail upload when no refreshToken is set", async () => {
            const result = await OneDriveAdapter.upload(
                unauthorizedConfig,
                "/tmp/file.sql",
                "backup.sql"
            );
            expect(result).toBe(false);
        });

        it("should fail download when no refreshToken is set", async () => {
            const result = await OneDriveAdapter.download(
                unauthorizedConfig,
                "backup.sql",
                "/tmp/file.sql"
            );
            expect(result).toBe(false);
        });
    });

    // ====================================================================
    // test()
    // ====================================================================
    describe("test()", () => {
        it("should succeed when drive is accessible and write/delete works", async () => {
            mockTokenRefresh();

            // Drive info call
            let apiCallIdx = 0;
            mockClient.api.mockImplementation((path: string) => {
                apiCallIdx++;
                if (path === "/me/drive") {
                    return {
                        select: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                owner: { user: { displayName: "Test User" } },
                            }),
                        }),
                    };
                }
                if (path.includes("backups:") && !path.includes("content") && !path.includes("dbackup-test")) {
                    // Folder check
                    return {
                        select: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                folder: {},
                            }),
                        }),
                    };
                }
                if (path.includes("/content")) {
                    // Test file write
                    return {
                        put: vi.fn().mockResolvedValue({}),
                    };
                }
                // Delete test file
                return {
                    delete: vi.fn().mockResolvedValue({}),
                    select: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ folder: {} }),
                    }),
                };
            });

            const result = await OneDriveAdapter.test(validConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("Write/Delete verified");
            expect(result.message).toContain("Test User");
        });

        it("should fail when folder path points to a file, not a folder", async () => {
            mockTokenRefresh();

            mockClient.api.mockImplementation((path: string) => {
                if (path === "/me/drive") {
                    return {
                        select: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                owner: { user: { displayName: "Test User" } },
                            }),
                        }),
                    };
                }
                // Folder check returns item without folder property (it's a file)
                return {
                    select: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({
                            id: "some-id",
                            // no folder property = it's a file
                        }),
                    }),
                };
            });

            const result = await OneDriveAdapter.test(validConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("not a folder");
        });

        it("should detect expired authorization", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: async () => '{"error":"invalid_grant","error_description":"AADSTS700082: The refresh token has expired"}',
            });

            const result = await OneDriveAdapter.test(validConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("re-authorize with Microsoft");
        });

        it("should work without folderPath (uses root)", async () => {
            const rootConfig = { ...validConfig, folderPath: undefined };
            mockTokenRefresh();

            mockClient.api.mockImplementation((path: string) => {
                if (path === "/me/drive") {
                    return {
                        select: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                owner: { user: { displayName: "Test User" } },
                            }),
                        }),
                    };
                }
                if (path.includes("/content")) {
                    return { put: vi.fn().mockResolvedValue({}) };
                }
                return {
                    delete: vi.fn().mockResolvedValue({}),
                    select: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({}),
                    }),
                };
            });

            const result = await OneDriveAdapter.test(rootConfig);

            expect(result.success).toBe(true);
        });

        it("should handle generic network errors", async () => {
            mockTokenRefresh();

            mockClient.api.mockImplementation(() => ({
                select: vi.fn().mockReturnValue({
                    get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
                }),
            }));

            const result = await OneDriveAdapter.test(validConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("ECONNREFUSED");
        });
    });

    // ====================================================================
    // upload()
    // ====================================================================
    describe("upload()", () => {
        it("should upload a small file using simple PUT", async () => {
            mockTokenRefresh();
            mockFs.stat.mockResolvedValue({ size: 1024 }); // < 4 MB
            mockFs.readFile.mockResolvedValue(Buffer.from("test content"));

            // Ensure folder exists (backups subfolder)
            mockClient.api.mockImplementation((path: string) => {
                if (path.includes("children")) {
                    return { post: vi.fn().mockResolvedValue({}) };
                }
                if (path.includes("/content")) {
                    return { put: vi.fn().mockResolvedValue({ id: "new-file-id" }) };
                }
                return mockApiChain;
            });

            const onProgress = vi.fn();
            const onLog = vi.fn();

            const result = await OneDriveAdapter.upload(
                validConfig,
                "/tmp/backup.sql",
                "daily/backup.sql",
                onProgress,
                onLog
            );

            expect(result).toBe(true);
            expect(onProgress).toHaveBeenCalledWith(100);
            expect(onLog).toHaveBeenCalledWith(
                expect.stringContaining("upload completed"),
                "info",
                "storage"
            );
        });

        it("should use upload session for large files", async () => {
            mockTokenRefresh();
            const fileSize = 10 * 1024 * 1024; // 10 MB > 4 MB limit
            mockFs.stat.mockResolvedValue({ size: fileSize });

            const uploadUrl = "https://upload.onedrive.example.com/session";

            mockClient.api.mockImplementation((path: string) => {
                if (path.includes("children")) {
                    return { post: vi.fn().mockResolvedValue({}) };
                }
                if (path.includes("createUploadSession")) {
                    return {
                        post: vi.fn().mockResolvedValue({ uploadUrl }),
                    };
                }
                return mockApiChain;
            });

            // Mock the PUT to upload session
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({}),
            });

            const onProgress = vi.fn();

            const result = await OneDriveAdapter.upload(
                validConfig,
                "/tmp/large-backup.sql",
                "backup.sql",
                onProgress
            );

            expect(result).toBe(true);
            expect(onProgress).toHaveBeenCalledWith(100);
        });

        it("should handle upload errors gracefully", async () => {
            mockTokenRefresh();
            mockFs.stat.mockRejectedValue(new Error("File not found"));

            const onLog = vi.fn();

            const result = await OneDriveAdapter.upload(
                validConfig,
                "/tmp/nonexistent.sql",
                "backup.sql",
                undefined,
                onLog
            );

            expect(result).toBe(false);
            expect(onLog).toHaveBeenCalledWith(
                expect.stringContaining("upload failed"),
                "error",
                "storage"
            );
        });
    });

    // ====================================================================
    // download()
    // ====================================================================
    describe("download()", () => {
        it("should download a file using the download URL", async () => {
            mockTokenRefresh();
            mockFs.mkdir.mockResolvedValue(undefined);

            const downloadUrl = "https://download.onedrive.example.com/file";

            mockClient.api.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        "@microsoft.graph.downloadUrl": downloadUrl,
                    }),
                }),
            });

            // Mock the download fetch
            mockFetch.mockResolvedValueOnce({
                ok: true,
                body: Readable.toWeb(Readable.from(["file content"])),
            });

            const result = await OneDriveAdapter.download(
                validConfig,
                "daily/backup.sql",
                "/tmp/restored.sql"
            );

            expect(result).toBe(true);
        });

        it("should fail when download URL is not available", async () => {
            mockTokenRefresh();
            mockFs.mkdir.mockResolvedValue(undefined);

            mockClient.api.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        // No download URL
                    }),
                }),
            });

            const result = await OneDriveAdapter.download(
                validConfig,
                "backup.sql",
                "/tmp/restored.sql"
            );

            expect(result).toBe(false);
        });

        it("should handle download errors gracefully", async () => {
            mockTokenRefresh();
            mockFs.mkdir.mockResolvedValue(undefined);

            mockClient.api.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    get: vi.fn().mockRejectedValue(new Error("Network error")),
                }),
            });

            const onLog = vi.fn();

            const result = await OneDriveAdapter.download(
                validConfig,
                "backup.sql",
                "/tmp/restored.sql",
                undefined,
                onLog
            );

            expect(result).toBe(false);
            expect(onLog).toHaveBeenCalledWith(
                expect.stringContaining("download failed"),
                "error",
                "storage"
            );
        });
    });

    // ====================================================================
    // read()
    // ====================================================================
    describe("read()", () => {
        it("should read file contents as text", async () => {
            mockTokenRefresh();

            mockClient.api.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        "@microsoft.graph.downloadUrl": "https://download.example.com/meta",
                    }),
                }),
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => '{"compression":"gzip"}',
            });

            const result = await OneDriveAdapter.read(validConfig, "backup.meta.json");

            expect(result).toBe('{"compression":"gzip"}');
        });

        it("should return null when file does not exist", async () => {
            mockTokenRefresh();

            mockClient.api.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    get: vi.fn().mockRejectedValue(new Error("itemNotFound")),
                }),
            });

            const result = await OneDriveAdapter.read(validConfig, "nonexistent.json");

            expect(result).toBeNull();
        });
    });

    // ====================================================================
    // list()
    // ====================================================================
    describe("list()", () => {
        it("should list files recursively", async () => {
            mockTokenRefresh();

            let callCount = 0;
            mockClient.api.mockImplementation(() => ({
                select: vi.fn().mockReturnThis(),
                filter: vi.fn().mockReturnThis(),
                top: vi.fn().mockReturnThis(),
                orderby: vi.fn().mockReturnThis(),
                get: vi.fn().mockImplementation(() => {
                    callCount++;
                    if (callCount === 1) {
                        // First call: root listing with files and a subfolder
                        return {
                            value: [
                                {
                                    name: "backup-2024.sql",
                                    size: 1024,
                                    lastModifiedDateTime: "2024-01-01T00:00:00Z",
                                    file: {},
                                },
                                {
                                    name: "subfolder",
                                    folder: { childCount: 1 },
                                },
                            ],
                        };
                    }
                    // Second call: subfolder listing
                    return {
                        value: [
                            {
                                name: "nested.sql",
                                size: 512,
                                lastModifiedDateTime: "2024-02-01T00:00:00Z",
                                file: {},
                            },
                        ],
                    };
                }),
            }));

            const result = await OneDriveAdapter.list(validConfig);

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe("backup-2024.sql");
            expect(result[1].name).toBe("nested.sql");
            expect(result[1].path).toContain("subfolder/nested.sql");
        });

        it("should return empty array on error", async () => {
            mockTokenRefresh();

            mockClient.api.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                filter: vi.fn().mockReturnThis(),
                top: vi.fn().mockReturnThis(),
                orderby: vi.fn().mockReturnThis(),
                get: vi.fn().mockRejectedValue(new Error("Access denied")),
            });

            const result = await OneDriveAdapter.list(validConfig);

            expect(result).toEqual([]);
        });

        it("should handle pagination with @odata.nextLink", async () => {
            mockTokenRefresh();

            let callCount = 0;
            mockClient.api.mockImplementation(() => ({
                select: vi.fn().mockReturnThis(),
                filter: vi.fn().mockReturnThis(),
                top: vi.fn().mockReturnThis(),
                orderby: vi.fn().mockReturnThis(),
                get: vi.fn().mockImplementation(() => {
                    callCount++;
                    if (callCount === 1) {
                        return {
                            value: [
                                { name: "file1.sql", size: 100, lastModifiedDateTime: "2024-01-01T00:00:00Z", file: {} },
                            ],
                            "@odata.nextLink": "https://graph.microsoft.com/next-page",
                        };
                    }
                    return {
                        value: [
                            { name: "file2.sql", size: 200, lastModifiedDateTime: "2024-02-01T00:00:00Z", file: {} },
                        ],
                    };
                }),
            }));

            const result = await OneDriveAdapter.list(validConfig);

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe("file1.sql");
            expect(result[1].name).toBe("file2.sql");
        });
    });

    // ====================================================================
    // delete()
    // ====================================================================
    describe("delete()", () => {
        it("should delete a file successfully", async () => {
            mockTokenRefresh();

            mockClient.api.mockReturnValue({
                delete: vi.fn().mockResolvedValue(undefined),
            });

            const result = await OneDriveAdapter.delete(validConfig, "daily/backup.sql");

            expect(result).toBe(true);
        });

        it("should return true when file does not exist (itemNotFound)", async () => {
            mockTokenRefresh();

            mockClient.api.mockReturnValue({
                delete: vi.fn().mockRejectedValue(new Error("itemNotFound")),
            });

            const result = await OneDriveAdapter.delete(validConfig, "nonexistent.sql");

            expect(result).toBe(true);
        });

        it("should return true for 404 status", async () => {
            mockTokenRefresh();

            mockClient.api.mockReturnValue({
                delete: vi.fn().mockRejectedValue(new Error("404: Resource not found")),
            });

            const result = await OneDriveAdapter.delete(validConfig, "nonexistent.sql");

            expect(result).toBe(true);
        });

        it("should return false on unexpected errors", async () => {
            mockTokenRefresh();

            mockClient.api.mockReturnValue({
                delete: vi.fn().mockRejectedValue(new Error("Permission denied")),
            });

            const result = await OneDriveAdapter.delete(validConfig, "protected.sql");

            expect(result).toBe(false);
        });
    });

    // ====================================================================
    // Adapter metadata
    // ====================================================================
    describe("metadata", () => {
        it("should have correct adapter ID and type", () => {
            expect(OneDriveAdapter.id).toBe("onedrive");
            expect(OneDriveAdapter.type).toBe("storage");
            expect(OneDriveAdapter.name).toBe("Microsoft OneDrive");
        });

        it("should have a Zod config schema", () => {
            const parsed = OneDriveAdapter.configSchema.parse({
                clientId: "test-id",
                clientSecret: "test-secret",
            });
            expect(parsed.clientId).toBe("test-id");
            expect(parsed.clientSecret).toBe("test-secret");
            expect(parsed.refreshToken).toBeUndefined();
            expect(parsed.folderPath).toBeUndefined();
        });

        it("should reject invalid config (missing clientId)", () => {
            expect(() =>
                OneDriveAdapter.configSchema.parse({
                    clientSecret: "test-secret",
                })
            ).toThrow();
        });
    });
});
