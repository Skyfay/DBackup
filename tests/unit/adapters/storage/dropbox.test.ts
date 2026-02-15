import { describe, it, expect, vi, beforeEach } from "vitest";
import { DropboxAdapter } from "@/lib/adapters/storage/dropbox";

// --- Hoisted mocks (available in vi.mock factories) ---
const { mockDbx, mockFs } = vi.hoisted(() => ({
    mockDbx: {
        usersGetCurrentAccount: vi.fn(),
        filesGetMetadata: vi.fn(),
        filesCreateFolderV2: vi.fn(),
        filesUpload: vi.fn(),
        filesDeleteV2: vi.fn(),
        filesDownload: vi.fn(),
        filesListFolder: vi.fn(),
        filesListFolderContinue: vi.fn(),
        filesUploadSessionStart: vi.fn(),
        filesUploadSessionAppendV2: vi.fn(),
        filesUploadSessionFinish: vi.fn(),
    },
    mockFs: {
        stat: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
    },
}));

vi.mock("dropbox", () => {
    // Class-based mock so `new Dropbox(...)` works as a constructor
    class MockDropbox {
        constructor() {
            return mockDbx;
        }
    }
    return { Dropbox: MockDropbox };
});

vi.mock("fs/promises", () => ({
    default: {
        stat: (...args: unknown[]) => mockFs.stat(...args),
        readFile: (...args: unknown[]) => mockFs.readFile(...args),
        writeFile: (...args: unknown[]) => mockFs.writeFile(...args),
        mkdir: (...args: unknown[]) => mockFs.mkdir(...args),
    },
}));

vi.mock("fs", () => ({
    default: {
        createReadStream: vi.fn(),
    },
    createReadStream: vi.fn(),
}));

// --- Base config ---
const validConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    refreshToken: "test-refresh-token",
    folderPath: "/backups",
};

const unauthorizedConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
};

describe("DropboxAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ====================================================================
    // Authorization guard
    // ====================================================================
    describe("authorization guard", () => {
        it("should fail test() when no refreshToken is set", async () => {
            const result = await DropboxAdapter.test(unauthorizedConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("not authorized");
        });

        it("should fail upload when no refreshToken is set", async () => {
            const result = await DropboxAdapter.upload(unauthorizedConfig, "/tmp/file.sql", "backup.sql");

            expect(result).toBe(false);
        });

        it("should fail download when no refreshToken is set", async () => {
            const result = await DropboxAdapter.download(unauthorizedConfig, "backup.sql", "/tmp/file.sql");

            expect(result).toBe(false);
        });
    });

    // ====================================================================
    // test() method
    // ====================================================================
    describe("test()", () => {
        it("should succeed when account is accessible and write/delete works", async () => {
            mockDbx.usersGetCurrentAccount.mockResolvedValue({
                result: { name: { display_name: "Test User" } },
            });
            mockDbx.filesGetMetadata.mockResolvedValue({
                result: { ".tag": "folder" },
            });
            mockDbx.filesUpload.mockResolvedValue({});
            mockDbx.filesDeleteV2.mockResolvedValue({});

            const result = await DropboxAdapter.test(validConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("Test User");
            expect(result.message).toContain("Write/Delete verified");
        });

        it("should return error when folder path is not a folder", async () => {
            mockDbx.usersGetCurrentAccount.mockResolvedValue({
                result: { name: { display_name: "Test User" } },
            });
            mockDbx.filesGetMetadata.mockResolvedValue({
                result: { ".tag": "file" },
            });

            const result = await DropboxAdapter.test(validConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("not a folder");
        });

        it("should detect expired tokens", async () => {
            mockDbx.usersGetCurrentAccount.mockRejectedValue(
                new Error("invalid_access_token")
            );

            const result = await DropboxAdapter.test(validConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("expired");
        });

        it("should create folder when it does not exist", async () => {
            mockDbx.usersGetCurrentAccount.mockResolvedValue({
                result: { name: { display_name: "Test User" } },
            });
            // filesGetMetadata throws (folder not found)
            mockDbx.filesGetMetadata.mockRejectedValue(new Error("not_found"));
            // Create folder succeeds
            mockDbx.filesCreateFolderV2.mockResolvedValue({});
            mockDbx.filesUpload.mockResolvedValue({});
            mockDbx.filesDeleteV2.mockResolvedValue({});

            const result = await DropboxAdapter.test(validConfig);

            expect(result.success).toBe(true);
            expect(mockDbx.filesCreateFolderV2).toHaveBeenCalledWith({
                path: "/backups",
                autorename: false,
            });
        });

        it("should handle generic errors gracefully", async () => {
            mockDbx.usersGetCurrentAccount.mockRejectedValue(
                new Error("Network timeout")
            );

            const result = await DropboxAdapter.test(validConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Network timeout");
        });

        it("should work without a folder path (root)", async () => {
            const rootConfig = { ...validConfig, folderPath: undefined };

            mockDbx.usersGetCurrentAccount.mockResolvedValue({
                result: { name: { display_name: "Root User" } },
            });
            mockDbx.filesUpload.mockResolvedValue({});
            mockDbx.filesDeleteV2.mockResolvedValue({});

            const result = await DropboxAdapter.test(rootConfig);

            expect(result.success).toBe(true);
            // No metadata check when no folder path
            expect(mockDbx.filesGetMetadata).not.toHaveBeenCalled();
        });
    });

    // ====================================================================
    // upload()
    // ====================================================================
    describe("upload()", () => {
        it("should do simple upload for small files (< 150 MB)", async () => {
            const fileContent = Buffer.from("SQL dump data");
            mockFs.stat.mockResolvedValue({ size: 100 });
            mockFs.readFile.mockResolvedValue(fileContent);
            mockDbx.filesUpload.mockResolvedValue({});

            const onLog = vi.fn();
            const onProgress = vi.fn();
            const result = await DropboxAdapter.upload(
                validConfig,
                "/tmp/dump.sql",
                "daily/backup.sql",
                onProgress,
                onLog
            );

            expect(result).toBe(true);
            expect(mockDbx.filesUpload).toHaveBeenCalledWith({
                path: "/backups/daily/backup.sql",
                contents: fileContent,
                mode: { ".tag": "overwrite" },
                autorename: false,
            });
            expect(onProgress).toHaveBeenCalledWith(100);
        });

        it("should build correct path with folderPath", async () => {
            mockFs.stat.mockResolvedValue({ size: 10 });
            mockFs.readFile.mockResolvedValue(Buffer.from("data"));
            mockDbx.filesUpload.mockResolvedValue({});

            await DropboxAdapter.upload(validConfig, "/tmp/file.sql", "sub/folder/backup.sql");

            expect(mockDbx.filesUpload).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "/backups/sub/folder/backup.sql",
                })
            );
        });

        it("should build correct path without folderPath", async () => {
            const noFolderConfig = { ...validConfig, folderPath: undefined };
            mockFs.stat.mockResolvedValue({ size: 10 });
            mockFs.readFile.mockResolvedValue(Buffer.from("data"));
            mockDbx.filesUpload.mockResolvedValue({});

            await DropboxAdapter.upload(noFolderConfig, "/tmp/file.sql", "backup.sql");

            expect(mockDbx.filesUpload).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "/backup.sql",
                })
            );
        });

        it("should handle upload errors and return false", async () => {
            mockFs.stat.mockResolvedValue({ size: 10 });
            mockFs.readFile.mockResolvedValue(Buffer.from("data"));
            mockDbx.filesUpload.mockRejectedValue(new Error("Upload failed"));

            const onLog = vi.fn();
            const result = await DropboxAdapter.upload(
                validConfig,
                "/tmp/dump.sql",
                "backup.sql",
                undefined,
                onLog
            );

            expect(result).toBe(false);
            expect(onLog).toHaveBeenCalledWith(
                expect.stringContaining("Upload failed"),
                "error",
                "storage"
            );
        });
    });

    // ====================================================================
    // download()
    // ====================================================================
    describe("download()", () => {
        it("should download file using fileBinary path", async () => {
            const fileData = Buffer.from("downloaded SQL data");
            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.writeFile.mockResolvedValue(undefined);
            mockDbx.filesDownload.mockResolvedValue({
                result: { fileBinary: fileData },
            });

            const result = await DropboxAdapter.download(
                validConfig,
                "daily/backup.sql",
                "/tmp/restore.sql"
            );

            expect(result).toBe(true);
            expect(mockFs.writeFile).toHaveBeenCalledWith("/tmp/restore.sql", fileData);
        });

        it("should download file using fileBlob path (ESM/Turbopack)", async () => {
            // Use a mock blob-like object since jsdom's Blob.arrayBuffer() may not work correctly
            const content = "blob SQL data";
            const mockBlob = {
                arrayBuffer: vi.fn().mockResolvedValue(Buffer.from(content).buffer),
            };
            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.writeFile.mockResolvedValue(undefined);
            mockDbx.filesDownload.mockResolvedValue({
                result: { fileBlob: mockBlob },
            });

            const result = await DropboxAdapter.download(
                validConfig,
                "backup.sql",
                "/tmp/restore.sql"
            );

            expect(result).toBe(true);
            expect(mockFs.writeFile).toHaveBeenCalledWith(
                "/tmp/restore.sql",
                expect.any(Buffer)
            );
        });

        it("should fail when no file data is returned", async () => {
            mockFs.mkdir.mockResolvedValue(undefined);
            mockDbx.filesDownload.mockResolvedValue({
                result: {},
            });

            const result = await DropboxAdapter.download(
                validConfig,
                "backup.sql",
                "/tmp/restore.sql"
            );

            expect(result).toBe(false);
        });

        it("should handle download errors and return false", async () => {
            mockFs.mkdir.mockResolvedValue(undefined);
            mockDbx.filesDownload.mockRejectedValue(new Error("Download error"));

            const result = await DropboxAdapter.download(
                validConfig,
                "backup.sql",
                "/tmp/restore.sql"
            );

            expect(result).toBe(false);
        });
    });

    // ====================================================================
    // read()
    // ====================================================================
    describe("read()", () => {
        it("should return file content as string", async () => {
            const content = "meta json content";
            mockDbx.filesDownload.mockResolvedValue({
                result: { fileBinary: Buffer.from(content) },
            });

            const result = await DropboxAdapter.read!(validConfig, "backup.sql.meta.json");

            expect(result).toBe(content);
        });

        it("should return null on error", async () => {
            mockDbx.filesDownload.mockRejectedValue(new Error("not found"));

            const result = await DropboxAdapter.read!(validConfig, "nonexistent.sql");

            expect(result).toBeNull();
        });

        it("should return null when no file data received", async () => {
            mockDbx.filesDownload.mockResolvedValue({
                result: {},
            });

            const result = await DropboxAdapter.read!(validConfig, "backup.sql");

            expect(result).toBeNull();
        });
    });

    // ====================================================================
    // list()
    // ====================================================================
    describe("list()", () => {
        it("should list files recursively from configured folder", async () => {
            mockDbx.filesListFolder.mockResolvedValue({
                result: {
                    entries: [
                        {
                            ".tag": "file",
                            name: "backup1.sql",
                            path_display: "/backups/backup1.sql",
                            size: 1024,
                            server_modified: "2025-01-15T10:00:00Z",
                        },
                        {
                            ".tag": "file",
                            name: "backup2.sql",
                            path_display: "/backups/sub/backup2.sql",
                            size: 2048,
                            server_modified: "2025-01-16T12:00:00Z",
                        },
                    ],
                    has_more: false,
                    cursor: "cursor1",
                },
            });

            const files = await DropboxAdapter.list(validConfig);

            expect(files).toHaveLength(2);
            expect(files[0]).toEqual({
                name: "backup1.sql",
                path: "backup1.sql",
                size: 1024,
                lastModified: new Date("2025-01-15T10:00:00Z"),
            });
            expect(files[1]).toEqual({
                name: "backup2.sql",
                path: "sub/backup2.sql",
                size: 2048,
                lastModified: new Date("2025-01-16T12:00:00Z"),
            });
        });

        it("should handle pagination with has_more", async () => {
            mockDbx.filesListFolder.mockResolvedValue({
                result: {
                    entries: [
                        {
                            ".tag": "file",
                            name: "file1.sql",
                            path_display: "/backups/file1.sql",
                            size: 100,
                            server_modified: "2025-01-10T00:00:00Z",
                        },
                    ],
                    has_more: true,
                    cursor: "page-cursor",
                },
            });

            mockDbx.filesListFolderContinue.mockResolvedValue({
                result: {
                    entries: [
                        {
                            ".tag": "file",
                            name: "file2.sql",
                            path_display: "/backups/file2.sql",
                            size: 200,
                            server_modified: "2025-01-11T00:00:00Z",
                        },
                    ],
                    has_more: false,
                    cursor: "page-cursor-2",
                },
            });

            const files = await DropboxAdapter.list(validConfig);

            expect(files).toHaveLength(2);
            expect(mockDbx.filesListFolderContinue).toHaveBeenCalledWith({
                cursor: "page-cursor",
            });
        });

        it("should skip folder entries", async () => {
            mockDbx.filesListFolder.mockResolvedValue({
                result: {
                    entries: [
                        {
                            ".tag": "folder",
                            name: "subfolder",
                            path_display: "/backups/subfolder",
                        },
                        {
                            ".tag": "file",
                            name: "backup.sql",
                            path_display: "/backups/backup.sql",
                            size: 512,
                            server_modified: "2025-01-12T00:00:00Z",
                        },
                    ],
                    has_more: false,
                    cursor: "c",
                },
            });

            const files = await DropboxAdapter.list(validConfig);

            expect(files).toHaveLength(1);
            expect(files[0].name).toBe("backup.sql");
        });

        it("should return empty array on error", async () => {
            mockDbx.filesListFolder.mockRejectedValue(new Error("API error"));

            const files = await DropboxAdapter.list(validConfig);

            expect(files).toEqual([]);
        });
    });

    // ====================================================================
    // delete()
    // ====================================================================
    describe("delete()", () => {
        it("should delete a file successfully", async () => {
            mockDbx.filesDeleteV2.mockResolvedValue({});

            const result = await DropboxAdapter.delete(validConfig, "daily/old-backup.sql");

            expect(result).toBe(true);
            expect(mockDbx.filesDeleteV2).toHaveBeenCalledWith({
                path: "/backups/daily/old-backup.sql",
            });
        });

        it("should return true when file is already gone (not_found)", async () => {
            mockDbx.filesDeleteV2.mockRejectedValue(
                new Error("path_lookup/not_found")
            );

            const result = await DropboxAdapter.delete(validConfig, "missing.sql");

            expect(result).toBe(true);
        });

        it("should return false on other errors", async () => {
            mockDbx.filesDeleteV2.mockRejectedValue(
                new Error("insufficient_permissions")
            );

            const result = await DropboxAdapter.delete(validConfig, "protected.sql");

            expect(result).toBe(false);
        });
    });
});
