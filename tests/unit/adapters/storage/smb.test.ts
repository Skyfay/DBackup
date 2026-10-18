import { describe, it, expect, vi, beforeEach } from "vitest";
import { SMBAdapter } from "@/lib/adapters/storage/smb";

// --- Hoisted mocks ---
const { mockSendFile, mockGetFile, mockList, mockMkdir, mockDeleteFile, mockFsReadFile, mockFsWriteFile, mockFsUnlink, mockSambaCtorShouldThrow } = vi.hoisted(() => ({
    mockSendFile: vi.fn().mockResolvedValue(undefined),
    mockGetFile: vi.fn().mockResolvedValue(undefined),
    mockList: vi.fn(),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockDeleteFile: vi.fn().mockResolvedValue(undefined),
    mockFsReadFile: vi.fn().mockResolvedValue("smb file content"),
    mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
    mockFsUnlink: vi.fn().mockResolvedValue(undefined),
    mockSambaCtorShouldThrow: { value: false },
}));

vi.mock("samba-client", () => {
    class MockSambaClient {
        constructor() {
            if (mockSambaCtorShouldThrow.value) {
                throw new Error("SambaClient constructor failed");
            }
        }
        sendFile = mockSendFile;
        getFile = mockGetFile;
        list = mockList;
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
        it("returns files from directory walk", async () => {
            mockList.mockResolvedValue([
                { name: "backup.sql", type: "F", size: 1024, modifyTime: new Date() },
            ]);

            const result = await SMBAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
        });

        it("skips . and .. entries", async () => {
            mockList.mockResolvedValue([
                { name: ".", type: "D", size: 0, modifyTime: new Date() },
                { name: "..", type: "D", size: 0, modifyTime: new Date() },
                { name: "backup.sql", type: "F", size: 512, modifyTime: new Date() },
            ]);

            const result = await SMBAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
        });

        it("recurses into subdirectories", async () => {
            mockList
                .mockResolvedValueOnce([
                    { name: "subdir", type: "D", size: 0, modifyTime: new Date() },
                ])
                .mockResolvedValueOnce([
                    { name: "nested.sql", type: "F", size: 512, modifyTime: new Date() },
                ]);

            const result = await SMBAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("nested.sql");
        });

        it("strips pathPrefix from returned paths", async () => {
            mockList.mockResolvedValue([
                { name: "backup.sql", type: "F", size: 100, modifyTime: new Date() },
            ]);

            const result = await SMBAdapter.list(config, "Job");

            expect(result[0].path).not.toContain("backups/");
        });

        it("throws when root directory listing fails", async () => {
            mockList.mockRejectedValue(new Error("SMB connection error"));

            await expect(SMBAdapter.list(config, "Job")).rejects.toThrow("SMB connection error");
        });

        it("continues when a subdirectory listing fails", async () => {
            mockList
                .mockResolvedValueOnce([
                    { name: "subdir", type: "D", size: 0, modifyTime: new Date() },
                    { name: "backup.sql", type: "F", size: 512, modifyTime: new Date() },
                ])
                .mockRejectedValueOnce(new Error("Permission denied on subdir"));

            const result = await SMBAdapter.list(config, "Job");

            // The file at the root level is returned; the failed subdirectory is silently skipped.
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
        });
    });

    // ===== list() of a subfolder that is not there yet =====

    describe("list() of a subfolder nothing was written to yet", () => {
        /** How samba-client rejects: the error of execa, with what smbclient printed beside the command. */
        function smbclientFailure(printed: string, command = 'smbclient -U admin -c dir "backups\\tenants\\t1\\*"') {
            const output = `${printed}\n`;
            return Object.assign(new Error(`Command failed with exit code 1: ${command}\n${output}`), {
                exitCode: 1,
                stdout: output,
                stderr: "",
                all: output,
            });
        }

        it.each([
            ["the folder itself is missing", "NT_STATUS_OBJECT_NAME_NOT_FOUND listing \\backups\\tenants\\t1\\*"],
            ["a folder above it is missing", "NT_STATUS_OBJECT_PATH_NOT_FOUND listing \\backups\\tenants\\t1\\*"],
            ["the pattern matches nothing", "NT_STATUS_NO_SUCH_FILE listing \\backups\\tenants\\t1\\*"],
        ])("lists it as empty when %s", async (_case, printed) => {
            mockList.mockRejectedValue(smbclientFailure(printed));

            await expect(SMBAdapter.list(config, "tenants/t1")).resolves.toEqual([]);
            expect(mockList).toHaveBeenCalledWith("backups/tenants/t1/*");
        });

        it.each([
            ["a refused login", "session setup failed: NT_STATUS_LOGON_FAILURE"],
            ["a refused folder", "NT_STATUS_ACCESS_DENIED listing \\backups\\tenants\\t1\\*"],
            ["an unreachable server", "do_connect: Connection to 192.168.1.100 failed (Error NT_STATUS_HOST_UNREACHABLE)"],
        ])("still fails on %s", async (_case, printed) => {
            mockList.mockRejectedValue(smbclientFailure(printed));

            await expect(SMBAdapter.list(config, "tenants/t1")).rejects.toThrow(printed);
        });

        it("reads the status from the output of smbclient, not from a path in its command", async () => {
            mockList.mockRejectedValue(smbclientFailure(
                "NT_STATUS_ACCESS_DENIED listing \\backups\\NT_STATUS_NO_SUCH_FILE\\*",
                'smbclient -U admin -c dir "backups\\NT_STATUS_OBJECT_NAME_NOT_FOUND\\*"',
            ));

            await expect(SMBAdapter.list(config, "NT_STATUS_OBJECT_NAME_NOT_FOUND")).rejects.toThrow("NT_STATUS_ACCESS_DENIED");
        });

        it("still fails a missing root, so the storage numbers keep their last values", async () => {
            mockList.mockRejectedValue(smbclientFailure("NT_STATUS_OBJECT_NAME_NOT_FOUND listing \\backups\\*"));

            await expect(SMBAdapter.list(config, "")).rejects.toThrow("NT_STATUS_OBJECT_NAME_NOT_FOUND");
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

        it("runs no smbclient for an address of another form than //server/share", async () => {
            for (const address of ["-L 10.0.0.9", "fileserver/share"]) {
                const result = await SMBAdapter.test!({ ...config, address });

                expect(result.success, address).toBe(false);
                expect(result.message, address).toContain("//server/share");
            }
            expect(mockSendFile).not.toHaveBeenCalled();
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
