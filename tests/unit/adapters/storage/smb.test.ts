import { describe, it, expect, vi, beforeEach } from "vitest";
import { SMBAdapter } from "@/lib/adapters/storage/smb";

// --- Hoisted mocks ---
const { mockSendFile, mockGetFile, mockList, mockMkdir, mockDeleteFile, mockFsReadFile, mockFsWriteFile, mockFsUnlink, mockSambaCtorShouldThrow, mockDir, mockCtorOptions } = vi.hoisted(() => ({
    mockSendFile: vi.fn().mockResolvedValue(undefined),
    mockGetFile: vi.fn().mockResolvedValue(undefined),
    mockList: vi.fn(),
    mockDir: vi.fn().mockResolvedValue(""),
    mockCtorOptions: vi.fn(),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockDeleteFile: vi.fn().mockResolvedValue(undefined),
    mockFsReadFile: vi.fn().mockResolvedValue("smb file content"),
    mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
    mockFsUnlink: vi.fn().mockResolvedValue(undefined),
    mockSambaCtorShouldThrow: { value: false },
}));

vi.mock("samba-client", () => {
    class MockSambaClient {
        constructor(options?: unknown) {
            mockCtorOptions(options);
            if (mockSambaCtorShouldThrow.value) {
                throw new Error("SambaClient constructor failed");
            }
        }
        sendFile = mockSendFile;
        getFile = mockGetFile;
        list = mockList;
        dir = mockDir;
        mkdir = mockMkdir;
        deleteFile = mockDeleteFile;
    }
    return { default: MockSambaClient };
});

vi.mock("fs/promises", () => ({
    default: {
        readFile: mockFsReadFile,
        writeFile: mockFsWriteFile,
        unlink: mockFsUnlink,
    },
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
    unlink: mockFsUnlink,
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

// --- Config ---
const config = {
    address: "//192.168.1.100/Backups",
    username: "admin",
    password: "secret",
    domain: "WORKGROUP",
    maxProtocol: "SMB3",
    pathPrefix: "backups",
};

describe("SMBAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSambaCtorShouldThrow.value = false;
        mockSendFile.mockResolvedValue(undefined);
        mockGetFile.mockResolvedValue(undefined);
        mockMkdir.mockResolvedValue(undefined);
        mockDeleteFile.mockResolvedValue(undefined);
        mockDir.mockReset().mockResolvedValue("");
        mockList.mockReset().mockResolvedValue([]);
        mockFsReadFile.mockResolvedValue("smb file content");
        mockFsWriteFile.mockResolvedValue(undefined);
        mockFsUnlink.mockResolvedValue(undefined);
    });

    // ===== upload() =====

    describe("upload()", () => {
        it("returns true on successful upload", async () => {
            const result = await SMBAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockSendFile).toHaveBeenCalled();
        });

        it("creates parent directory before upload", async () => {
            await SMBAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockMkdir).toHaveBeenCalled();
        });

        it("returns false when sendFile throws", async () => {
            mockSendFile.mockRejectedValue(new Error("Access denied"));

            const result = await SMBAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("calls onProgress(100) after successful upload", async () => {
            const onProgress = vi.fn();

            await SMBAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", onProgress);

            expect(onProgress).toHaveBeenCalledWith(100);
        });

        it("calls onLog with address info", async () => {
            const onLog = vi.fn();

            await SMBAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", undefined, onLog);

            expect(onLog).toHaveBeenCalledWith(expect.stringContaining("192.168.1.100"), "info", "storage");
        });

        it("respects pathPrefix in destination path", async () => {
            await SMBAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            const destArg = mockSendFile.mock.calls[0][1];
            expect(destArg).toContain("backups");
        });
    });

    // ===== download() =====

    describe("download()", () => {
        it("returns true on successful download", async () => {
            const result = await SMBAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(true);
            expect(mockGetFile).toHaveBeenCalled();
        });

        it("returns false when getFile throws", async () => {
            mockGetFile.mockRejectedValue(new Error("File not found"));

            const result = await SMBAdapter.download(config, "Job/missing.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });
    });

    // ===== read() =====

    describe("read()", () => {
        it("returns file content after temp download", async () => {
            const result = await SMBAdapter.read!(config, "Job/backup.sql.meta.json");

            expect(typeof result).toBe("string");
            expect(mockGetFile).toHaveBeenCalled();
        });

        it("returns null when getFile throws", async () => {
            mockGetFile.mockRejectedValue(new Error("No such file"));

            const result = await SMBAdapter.read!(config, "Job/missing.meta.json");

            expect(result).toBeNull();
        });
    });

    // ===== list() =====

    describe("list()", () => {

        it("preserves numeric and double-space filenames without phantom entries", async () => {
            mockList.mockResolvedValue([]);
            mockDir.mockResolvedValue([
                "  x 1 2                         A        7  Sun Oct  4 12:34:56 2026",
                "  report 5 100  final.txt       AHS       8  Sun Oct  4 12:34:56 2026",
                "  a  double  space  b.tar       An        9  Sun Oct  4 12:34:56 2026",
                "        12345 blocks of size 1024. 999 blocks available",
            ].join("\n"));

            const files = await SMBAdapter.list(config);

            expect(files.map(({ name, size, lastModified }) => ({ name, size, lastModified }))).toEqual([
                { name: "x 1 2", size: 7, lastModified: new Date("2026-10-04T12:34:56Z") },
                { name: "report 5 100  final.txt", size: 8, lastModified: new Date("2026-10-04T12:34:56Z") },
                { name: "a  double  space  b.tar", size: 9, lastModified: new Date("2026-10-04T12:34:56Z") },
            ]);
        });

        it("does not recurse into a lowercase device attribute", async () => {
            mockList.mockResolvedValue([]);
            mockDir.mockResolvedValueOnce("  device                        Ad        7  Sun Oct  4 12:34:56 2026");
            const files = await SMBAdapter.list(config);
            expect(files.map((file) => file.name)).toEqual(["device"]);
            expect(mockDir).toHaveBeenCalledTimes(1);
        });

        it("returns files and strips the configured prefix", async () => {
            mockDir.mockResolvedValue("  backup.sql A 1024  Sun Oct  4 12:34:56 2026");
            const files = await SMBAdapter.list(config, "Job");
            expect(files).toEqual([{
                name: "backup.sql", path: "Job/backup.sql", size: 1024,
                lastModified: new Date("2026-10-04T12:34:56Z"),
            }]);
            expect(mockDir).toHaveBeenCalledWith("backups/Job/*");
            expect(mockDir).toHaveBeenCalledTimes(1);
            expect(mockList).not.toHaveBeenCalled();
        });

        it("skips dot entries and a disk-space footer", async () => {
            mockDir.mockResolvedValue([
                "  . D 0  Sun Oct  4 12:34:56 2026",
                "  .. D 0  Sun Oct  4 12:34:56 2026",
                "  backup.sql A 512  Sun Oct  4 12:34:56 2026",
                "        12345 blocks of size 1024. 999 blocks available",
            ].join("\n"));
            expect(await SMBAdapter.list(config)).toHaveLength(1);
        });

        it("recurses through uppercase directory flags with lowercase modifiers", async () => {
            mockDir
                .mockResolvedValueOnce("  snapshot-run Dn 0  Sat Oct 10 01:20:00 2026")
                .mockResolvedValueOnce("  archive.tar An 8192  Sat Oct 10 01:20:00 2026");
            const files = await SMBAdapter.list(config, "Job");
            expect(files).toHaveLength(1);
            expect(files[0].path).toBe("Job/snapshot-run/archive.tar");
            expect(mockDir).toHaveBeenNthCalledWith(2, "backups/Job/snapshot-run/*");
        });

        it("includes both short and long archive names once", async () => {
            mockDir.mockResolvedValue(
                "  short.index A 100  Sat Oct 10 01:20:00 2026\n" +
                "  Critical_Backups_2026-10-10_01-20-00_full-000.tar A 2580549120  Sat Oct 10 01:20:00 2026\n"
            );
            const files = await SMBAdapter.list(config, "Job");
            expect(files.map((file) => [file.name, file.size])).toEqual([
                ["short.index", 100],
                ["Critical_Backups_2026-10-10_01-20-00_full-000.tar", 2580549120],
            ]);
            expect(mockDir).toHaveBeenCalledTimes(1);
            expect(mockList).not.toHaveBeenCalled();
        });

        it("passes paths with spaces to the library for quoting", async () => {
            await SMBAdapter.list(config, "Team Archives/run 2026");
            expect(mockDir).toHaveBeenCalledWith("backups/Team Archives/run 2026/*");
            expect(mockCtorOptions).not.toHaveBeenCalledWith(expect.objectContaining({ directory: expect.anything() }));
        });

        it("handles Buffer output at the share root", async () => {
            mockDir.mockResolvedValue(Buffer.from("  backup.sql A 7  Sat Oct 10 01:20:00 2026"));
            const files = await SMBAdapter.list({ ...config, pathPrefix: "" });
            expect(files[0].path).toBe("backup.sql");
            expect(mockDir).toHaveBeenCalledWith("*");
        });

        it("throws when root directory listing fails", async () => {
            mockDir.mockRejectedValueOnce(new Error("Access denied"));
            await expect(SMBAdapter.list(config)).rejects.toThrow("Access denied");
        });

        it("continues when a subdirectory listing fails", async () => {
            mockDir
                .mockResolvedValueOnce(
                    "  restricted D 0  Sun Oct  4 12:34:56 2026\n" +
                    "  backup.sql A 7  Sun Oct  4 12:34:56 2026"
                )
                .mockRejectedValueOnce(new Error("Access denied"));
            expect((await SMBAdapter.list(config)).map((file) => file.name)).toEqual(["backup.sql"]);
        });
    });

    describe("browseDirectories()", () => {
        it("includes hidden directories and distinguishes device flags", async () => {
            mockDir.mockResolvedValue([
                "  . D 0  Sun Oct  4 12:34:56 2026",
                "  .. D 0  Sun Oct  4 12:34:56 2026",
                "  hidden folder DH 0  Sun Oct  4 12:34:56 2026",
                "  no index Dn 0  Sun Oct  4 12:34:56 2026",
                "  device Ad 7  Sun Oct  4 12:34:56 2026",
                "  report AHS 8  Sun Oct  4 12:34:56 2026",
            ].join("\n"));
            const dirs = await SMBAdapter.browseDirectories!(config, "Team Archives");
            expect(dirs).toEqual([
                { name: "hidden folder", path: "Team Archives/hidden folder" },
                { name: "no index", path: "Team Archives/no index" },
            ]);
            expect(mockDir).toHaveBeenCalledWith("backups/Team Archives/*");
            expect(mockList).not.toHaveBeenCalled();
        });
    });

    // ===== delete() =====

    describe("delete()", () => {
        it("returns true on successful delete", async () => {
            const result = await SMBAdapter.delete(config, "Job/backup.sql");

            expect(result).toBe(true);
        });

        it("returns false when deleteFile throws", async () => {
            mockDeleteFile.mockRejectedValue(new Error("Permission denied"));

            const result = await SMBAdapter.delete(config, "Job/backup.sql");

            expect(result).toBe(false);
        });
    });

    // ===== test() =====

    describe("test()", () => {
        it("returns success when write+delete succeed", async () => {
            const result = await SMBAdapter.test!(config);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successful");
        });

        it("returns failure when sendFile throws", async () => {
            mockSendFile.mockRejectedValue(new Error("ECONNREFUSED"));

            const result = await SMBAdapter.test!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("ECONNREFUSED");
        });

        it("attempts remote cleanup when sendFile throws (partial upload guard)", async () => {
            // Simulate: file was created on the SMB share but sendFile threw before
            // the client received the final ACK (e.g. network hiccup mid-transfer).
            mockSendFile.mockRejectedValue(new Error("connection reset"));

            await SMBAdapter.test!(config);

            // deleteFile must be called in the finally block even though sendFile threw,
            // so orphaned .connection-test-* files cannot accumulate on the share.
            expect(mockDeleteFile).toHaveBeenCalled();
        });

        it("does not leave orphaned files when deleteFile throws after successful upload", async () => {
            // sendFile succeeds, deleteFile fails on first attempt (server-side error),
            // but the finally block retries it unconditionally.
            mockDeleteFile.mockRejectedValueOnce(new Error("NT_STATUS_SHARING_VIOLATION"));

            const result = await SMBAdapter.test!(config);

            expect(result.success).toBe(false);
            // finally block must have retried deleteFile after the explicit call failed
            expect(mockDeleteFile).toHaveBeenCalledTimes(2);
        });
    });

    // ===== resolvePath without pathPrefix =====

    describe("upload() without pathPrefix", () => {
        it("uses relativePath directly when no pathPrefix is set", async () => {
            const noPrefix = { ...config, pathPrefix: undefined };
            const result = await SMBAdapter.upload(noPrefix, "/tmp/backup.sql", "backup.sql");

            expect(result).toBe(true);
            const destArg = mockSendFile.mock.calls[0][1];
            // no prefix - path should just be the relativePath
            expect(destArg).not.toContain("backups/");
        });
    });

    // ===== test() mkdir catch branch =====

    describe("test() mkdir resilience", () => {
        it("succeeds even when mkdir throws (directory already exists)", async () => {
            mockMkdir.mockRejectedValue(new Error("NT_STATUS_OBJECT_NAME_COLLISION"));

            const result = await SMBAdapter.test!(config);

            expect(result.success).toBe(true);
        });
    });

    // ====================================================================
    // list() outer catch - when SambaClient constructor throws (lines 180-181)
    // ====================================================================
    describe("list() outer catch when SambaClient constructor throws", () => {
        it("throws when SambaClient constructor fails", async () => {
            mockSambaCtorShouldThrow.value = true;

            await expect(SMBAdapter.list(config, "Job")).rejects.toThrow("SambaClient constructor failed");
        });
    });
});
