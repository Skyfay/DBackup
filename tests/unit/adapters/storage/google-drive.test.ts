import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleDriveAdapter } from "@/lib/adapters/storage/google-drive";
import { Readable } from "stream";

// --- Hoisted mocks (available in vi.mock factories) ---
const { mockDrive, mockSetCredentials, mockFs, mockPipeline } = vi.hoisted(() => ({
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
    mockPipeline: vi.fn().mockResolvedValue(undefined),
    mockFs: {
        stat: vi.fn(),
        mkdir: vi.fn(),
    },
}));

vi.mock("googleapis", () => {
    // Class-based mock so `new google.auth.OAuth2(...)` works
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
    default: {
        stat: (...args: unknown[]) => mockFs.stat(...args),
        mkdir: (...args: unknown[]) => mockFs.mkdir(...args),
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
    pipeline: mockPipeline,
    default: {
        pipeline: mockPipeline,
    },
}));

// --- Base config ---
const validConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    refreshToken: "test-refresh-token",
    folderId: "root-folder-id",
};

const unauthorizedConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
};

describe("GoogleDriveAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ====================================================================
    // Authorization guard
    // ====================================================================
    describe("authorization guard", () => {
        it("should fail test() when no refreshToken is set", async () => {
            const result = await GoogleDriveAdapter.test!(unauthorizedConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("not authorized");
        });

        it("should fail upload when no refreshToken is set", async () => {
            const result = await GoogleDriveAdapter.upload(
                unauthorizedConfig,
                "/tmp/file.sql",
                "backup.sql"
            );
            expect(result).toBe(false);
        });

        it("should fail download when no refreshToken is set", async () => {
            const result = await GoogleDriveAdapter.download(
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
        it("should succeed when folder is accessible and write/delete works", async () => {
            mockDrive.files.get.mockResolvedValue({
                data: {
                    id: "root-folder-id",
                    name: "Backups",
                    mimeType: "application/vnd.google-apps.folder",
                },
            });
            mockDrive.files.create.mockResolvedValue({
                data: { id: "test-file-id" },
            });
            mockDrive.files.delete.mockResolvedValue({});

            const result = await GoogleDriveAdapter.test!(validConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("Write/Delete verified");
        });

        it("should fail when folderId points to a file, not a folder", async () => {
            mockDrive.files.get.mockResolvedValue({
                data: {
                    id: "root-folder-id",
                    name: "SomeFile.txt",
                    mimeType: "text/plain",
                },
            });

            const result = await GoogleDriveAdapter.test!(validConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("not a folder");
        });

        it("should detect expired authorization", async () => {
            mockDrive.files.get.mockRejectedValue(
                new Error("invalid_grant: Token has been expired")
            );

            const result = await GoogleDriveAdapter.test!(validConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("expired");
        });

        it("should work without folderId (uses root)", async () => {
            const rootConfig = { ...validConfig, folderId: undefined };

            mockDrive.files.create.mockResolvedValue({
                data: { id: "test-file-id" },
            });
            mockDrive.files.delete.mockResolvedValue({});

            const result = await GoogleDriveAdapter.test!(rootConfig);

            expect(result.success).toBe(true);
            // folderId check should not happen without folderId
            expect(mockDrive.files.get).not.toHaveBeenCalled();
        });

        it("should handle generic network errors", async () => {
            mockDrive.files.get.mockRejectedValue(new Error("ECONNREFUSED"));

            const result = await GoogleDriveAdapter.test!(validConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("ECONNREFUSED");
        });
    });

    // ====================================================================
    // upload()
    // ====================================================================
    describe("upload()", () => {
        it("should create a new file when it does not exist", async () => {
            // resolveOrCreatePath - dir is "daily", find folder
            mockDrive.files.list
                .mockResolvedValueOnce({
                    // resolveOrCreatePath: lookup "daily" folder
                    data: {
                        files: [{ id: "daily-folder-id", name: "daily" }],
                    },
                })
                .mockResolvedValueOnce({
                    // findFile: backup.sql does not exist
                    data: { files: [] },
                });

            mockDrive.files.create.mockResolvedValue({
                data: { id: "new-file-id", name: "backup.sql", size: "1024" },
            });
            mockFs.stat.mockResolvedValue({ size: 1024 });

            const onProgress = vi.fn();
            const result = await GoogleDriveAdapter.upload(
                validConfig,
                "/tmp/dump.sql",
                "daily/backup.sql",
                onProgress
            );

            expect(result).toBe(true);
            expect(mockDrive.files.create).toHaveBeenCalled();
            expect(onProgress).toHaveBeenCalledWith(100);
        });

        it("should update existing file on overwrite", async () => {
            mockDrive.files.list
                .mockResolvedValueOnce({
                    // resolveOrCreatePath: no subdir needed (file at root)
                    data: { files: [] },
                })
                .mockResolvedValueOnce({
                    // resolveOrCreatePath: create folder
                    data: { files: [] },
                });

            // For simple file at root, we need different mocking
            // Let's use a rootConfig without subdirectory
            const rootConfig = { ...validConfig };

            // resolveOrCreatePath sees dirname="." → returns parentId directly
            // findFile: file exists
            mockDrive.files.list.mockReset();
            mockDrive.files.list.mockResolvedValueOnce({
                data: {
                    files: [{ id: "existing-file-id", name: "backup.sql", size: "500" }],
                },
            });

            mockDrive.files.update.mockResolvedValue({
                data: { id: "existing-file-id", name: "backup.sql", size: "1024" },
            });
            mockFs.stat.mockResolvedValue({ size: 1024 });

            const result = await GoogleDriveAdapter.upload(
                rootConfig,
                "/tmp/dump.sql",
                "backup.sql"
            );

            expect(result).toBe(true);
            expect(mockDrive.files.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    fileId: "existing-file-id",
                })
            );
        });

        it("should handle upload errors and return false", async () => {
            mockDrive.files.list.mockRejectedValue(new Error("API quota exceeded"));

            const onLog = vi.fn();
            const result = await GoogleDriveAdapter.upload(
                validConfig,
                "/tmp/dump.sql",
                "daily/backup.sql",
                undefined,
                onLog
            );

            expect(result).toBe(false);
            expect(onLog).toHaveBeenCalledWith(
                expect.stringContaining("API quota exceeded"),
                "error",
                "storage"
            );
        });
    });

    // ====================================================================
    // download()
    // ====================================================================
    describe("download()", () => {
        it("should download file successfully", async () => {
            // resolveOrCreatePath for "daily/backup.sql" → dirname = "daily"
            mockDrive.files.list
                .mockResolvedValueOnce({
                    data: {
                        files: [{ id: "daily-folder-id", name: "daily" }],
                    },
                })
                .mockResolvedValueOnce({
                    // findFile
                    data: {
                        files: [{
                            id: "file-id",
                            name: "backup.sql",
                            size: "2048",
                        }],
                    },
                });

            const mockStream = Readable.from(["file content"]);
            mockDrive.files.get.mockResolvedValue({ data: mockStream });
            mockFs.mkdir.mockResolvedValue(undefined);

            const result = await GoogleDriveAdapter.download(
                validConfig,
                "daily/backup.sql",
                "/tmp/restore.sql"
            );

            expect(result).toBe(true);
            expect(mockFs.mkdir).toHaveBeenCalled();
        });

        it("should return false when file is not found", async () => {
            // resolveOrCreatePath returns folderId
            mockDrive.files.list
                .mockResolvedValueOnce({
                    data: { files: [{ id: "folder-id" }] },
                })
                .mockResolvedValueOnce({
                    // findFile: empty
                    data: { files: [] },
                });

            mockFs.mkdir.mockResolvedValue(undefined);

            const onLog = vi.fn();
            const result = await GoogleDriveAdapter.download(
                validConfig,
                "daily/missing.sql",
                "/tmp/restore.sql",
                undefined,
                onLog
            );

            expect(result).toBe(false);
        });

        it("should handle download errors and return false", async () => {
            mockDrive.files.list.mockRejectedValue(new Error("Network error"));
            mockFs.mkdir.mockResolvedValue(undefined);

            const result = await GoogleDriveAdapter.download(
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
            // findFile at root (dirname = ".")
            mockDrive.files.list.mockResolvedValueOnce({
                data: {
                    files: [{
                        id: "meta-file-id",
                        name: "backup.meta.json",
                    }],
                },
            });

            mockDrive.files.get.mockResolvedValue({
                data: '{"iv":"abc","authTag":"def"}',
            });

            const result = await GoogleDriveAdapter.read!(validConfig, "backup.meta.json");

            expect(result).toBe('{"iv":"abc","authTag":"def"}');
        });

        it("should return null when file is not found", async () => {
            mockDrive.files.list.mockResolvedValueOnce({
                data: { files: [] },
            });

            const result = await GoogleDriveAdapter.read!(validConfig, "nonexistent.json");

            expect(result).toBeNull();
        });

        it("should return null on error", async () => {
            mockDrive.files.list.mockRejectedValue(new Error("API error"));

            const result = await GoogleDriveAdapter.read!(validConfig, "backup.meta.json");

            expect(result).toBeNull();
        });
    });

    // ====================================================================
    // list()
    // ====================================================================
    describe("list()", () => {
        it("should list files recursively from root folder", async () => {
            mockDrive.files.list.mockResolvedValueOnce({
                data: {
                    files: [
                        {
                            id: "file-1",
                            name: "backup1.sql",
                            size: "1024",
                            modifiedTime: "2025-01-15T10:00:00Z",
                            mimeType: "application/octet-stream",
                        },
                        {
                            id: "file-2",
                            name: "backup2.sql",
                            size: "2048",
                            modifiedTime: "2025-01-16T12:00:00Z",
                            mimeType: "application/octet-stream",
                        },
                    ],
                    nextPageToken: undefined,
                },
            });

            const files = await GoogleDriveAdapter.list(validConfig, "");

            expect(files).toHaveLength(2);
            expect(files[0]).toEqual({
                name: "backup1.sql",
                path: "backup1.sql",
                size: 1024,
                lastModified: new Date("2025-01-15T10:00:00Z"),
            });
        });

        it("should recurse into subfolders", async () => {
            // First call: root listing
            mockDrive.files.list.mockResolvedValueOnce({
                data: {
                    files: [
                        {
                            id: "subfolder-id",
                            name: "daily",
                            mimeType: "application/vnd.google-apps.folder",
                        },
                    ],
                    nextPageToken: undefined,
                },
            });

            // Second call: subfolder listing
            mockDrive.files.list.mockResolvedValueOnce({
                data: {
                    files: [
                        {
                            id: "nested-file",
                            name: "backup.sql",
                            size: "512",
                            modifiedTime: "2025-02-01T08:00:00Z",
                            mimeType: "application/octet-stream",
                        },
                    ],
                    nextPageToken: undefined,
                },
            });

            const files = await GoogleDriveAdapter.list(validConfig, "");

            expect(files).toHaveLength(1);
            expect(files[0].path).toBe("daily/backup.sql");
        });

        it("should handle pagination with nextPageToken", async () => {
            mockDrive.files.list
                .mockResolvedValueOnce({
                    data: {
                        files: [
                            {
                                id: "f1",
                                name: "file1.sql",
                                size: "100",
                                modifiedTime: "2025-01-10T00:00:00Z",
                                mimeType: "application/octet-stream",
                            },
                        ],
                        nextPageToken: "page2",
                    },
                })
                .mockResolvedValueOnce({
                    data: {
                        files: [
                            {
                                id: "f2",
                                name: "file2.sql",
                                size: "200",
                                modifiedTime: "2025-01-11T00:00:00Z",
                                mimeType: "application/octet-stream",
                            },
                        ],
                        nextPageToken: undefined,
                    },
                });

            const files = await GoogleDriveAdapter.list(validConfig, "");

            expect(files).toHaveLength(2);
        });

        it("should throw on error", async () => {
            mockDrive.files.list.mockRejectedValue(new Error("Forbidden"));

            await expect(GoogleDriveAdapter.list(validConfig, "")).rejects.toThrow("Forbidden");
        });
    });

    // ====================================================================
    // delete()
    // ====================================================================
    describe("delete()", () => {
        it("should delete a file successfully", async () => {
            // findFile
            mockDrive.files.list.mockResolvedValueOnce({
                data: {
                    files: [{
                        id: "file-to-delete",
                        name: "old-backup.sql",
                    }],
                },
            });
            mockDrive.files.delete.mockResolvedValue({});

            const result = await GoogleDriveAdapter.delete(validConfig, "old-backup.sql");

            expect(result).toBe(true);
            expect(mockDrive.files.delete).toHaveBeenCalledWith({
                fileId: "file-to-delete",
            });
        });

        it("should return true when file does not exist", async () => {
            mockDrive.files.list.mockResolvedValueOnce({
                data: { files: [] },
            });

            const result = await GoogleDriveAdapter.delete(validConfig, "already-gone.sql");

            expect(result).toBe(true);
            expect(mockDrive.files.delete).not.toHaveBeenCalled();
        });

        it("should return false on delete error", async () => {
            mockDrive.files.list.mockResolvedValueOnce({
                data: {
                    files: [{ id: "protected-file", name: "important.sql" }],
                },
            });
            mockDrive.files.delete.mockRejectedValue(
                new Error("Insufficient permissions")
            );

            const result = await GoogleDriveAdapter.delete(validConfig, "important.sql");

            expect(result).toBe(false);
        });

        it("should resolve path and delete a file in a subdirectory", async () => {
            // resolveOrCreatePath: find "daily" folder
            mockDrive.files.list
                .mockResolvedValueOnce({
                    data: { files: [{ id: "daily-folder", name: "daily" }] },
                })
                .mockResolvedValueOnce({
                    // findFile: find the file
                    data: { files: [{ id: "sub-file-id", name: "backup.sql" }] },
                });
            mockDrive.files.delete.mockResolvedValue({});

            const result = await GoogleDriveAdapter.delete(validConfig, "daily/backup.sql");

            expect(result).toBe(true);
            expect(mockDrive.files.delete).toHaveBeenCalledWith({ fileId: "sub-file-id" });
        });
    });

    // ====================================================================
    // download() with onProgress
    // ====================================================================
    describe("download() with onProgress", () => {
        it("should use tracker transform when onProgress is provided and file has size", async () => {
            // resolveOrCreatePath for "daily" folder
            mockDrive.files.list
                .mockResolvedValueOnce({
                    data: { files: [{ id: "daily-folder-id", name: "daily" }] },
                })
                .mockResolvedValueOnce({
                    data: {
                        files: [{ id: "dl-file-id", name: "backup.sql", size: "2048" }],
                    },
                });

            const mockStream = Readable.from(["file content"]);
            mockDrive.files.get.mockResolvedValue({ data: mockStream });
            mockFs.mkdir.mockResolvedValue(undefined);

            const onProgress = vi.fn();
            const result = await GoogleDriveAdapter.download(
                validConfig,
                "daily/backup.sql",
                "/tmp/restore.sql",
                onProgress
            );

            // With onProgress + file.size > 0, the tracker branch is entered
            expect(result).toBe(true);
        });
    });

    // ====================================================================
    // read() with subdirectory path
    // ====================================================================
    describe("read() with subdirectory path", () => {
        it("should resolve subdirectory via resolveOrCreatePath", async () => {
            // resolveOrCreatePath: find "subdir" folder
            mockDrive.files.list.mockResolvedValueOnce({
                data: { files: [{ id: "subdir-folder-id", name: "subdir" }] },
            });
            // findFile: find the meta file
            mockDrive.files.list.mockResolvedValueOnce({
                data: { files: [{ id: "meta-file-id", name: "backup.meta.json" }] },
            });

            mockDrive.files.get.mockResolvedValue({
                data: '{"iv":"abc"}',
            });

            const result = await GoogleDriveAdapter.read!(validConfig, "subdir/backup.meta.json");

            expect(result).toBe('{"iv":"abc"}');
        });
    });

    // ====================================================================
    // list() with non-empty dir
    // ====================================================================
    describe("list() with subdirectory dir", () => {
        it("should resolve the dir folder before listing", async () => {
            // resolveOrCreatePath: find "daily" folder
            mockDrive.files.list
                .mockResolvedValueOnce({
                    data: { files: [{ id: "daily-folder-id", name: "daily" }] },
                })
                .mockResolvedValueOnce({
                    // listFilesRecursive
                    data: {
                        files: [
                            {
                                id: "f1",
                                name: "backup.sql",
                                size: "512",
                                modifiedTime: "2025-01-01T00:00:00Z",
                                mimeType: "application/octet-stream",
                            },
                        ],
                        nextPageToken: undefined,
                    },
                });

            const result = await GoogleDriveAdapter.list(validConfig, "daily");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
        });
    });

    // ====================================================================
    // resolveOrCreatePath - folder creation (lines 75-83)
    // ====================================================================
    describe("resolveOrCreatePath - creates missing folders", () => {
        it("creates a new folder when it does not exist in Google Drive", async () => {
            // resolveOrCreatePath: "newdir" folder does not exist → create it
            mockDrive.files.list
                .mockResolvedValueOnce({ data: { files: [] } }) // folder missing
                .mockResolvedValueOnce({ data: { files: [] } }); // findFile: file missing

            mockDrive.files.create
                .mockResolvedValueOnce({ data: { id: "new-folder-id" } }) // folder creation
                .mockResolvedValueOnce({ data: { id: "new-file-id" } }); // file creation

            mockFs.stat.mockResolvedValue({ size: 100 });

            const result = await GoogleDriveAdapter.upload(
                validConfig,
                "/tmp/dump.sql",
                "newdir/backup.sql"
            );

            expect(result).toBe(true);
            // Verify folder create was called with folder mimeType
            expect(mockDrive.files.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestBody: expect.objectContaining({
                        mimeType: "application/vnd.google-apps.folder",
                    }),
                })
            );
        });
    });

    // ====================================================================
    // download() tracker transform body (lines 262-264)
    // ====================================================================
    describe("download() tracker transform body coverage", () => {
        it("invokes onProgress via the tracker transform callback", async () => {
            mockDrive.files.list
                .mockResolvedValueOnce({
                    data: { files: [{ id: "folder-id", name: "daily" }] },
                })
                .mockResolvedValueOnce({
                    data: { files: [{ id: "dl-id", name: "backup.sql", size: "1024" }] },
                });

            const mockStream = Readable.from(["chunk data"]);
            mockDrive.files.get.mockResolvedValue({ data: mockStream });
            mockFs.mkdir.mockResolvedValue(undefined);

            const onProgress = vi.fn();

            // Override pipeline to invoke the tracker's _transform so lines 262-264 run
            mockPipeline.mockImplementationOnce(async (_src: any, tracker: any, _dst: any) => {
                if (tracker && tracker._transform) {
                    tracker._transform(Buffer.from("chunk data"), "buffer", () => {});
                }
            });

            const result = await GoogleDriveAdapter.download(
                validConfig,
                "daily/backup.sql",
                "/tmp/restore.sql",
                onProgress
            );

            expect(result).toBe(true);
            expect(onProgress).toHaveBeenCalled();
        });
    });
});
