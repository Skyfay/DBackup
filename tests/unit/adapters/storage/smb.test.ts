import { describe, it, expect, vi, beforeEach } from "vitest";
import { SMBAdapter } from "@/lib/adapters/storage/smb";
import { ListingTooLargeError } from "@/lib/adapters/storage/common/listing-limits";

// --- Hoisted mocks ---
const { mockSendFile, mockGetFile, mockList, mockMkdir, mockDeleteFile, mockFsReadFile, mockFsWriteFile, mockFsUnlink, mockFsMkdtemp, mockFsRm, mockFsOpen, mockSambaCtorShouldThrow } = vi.hoisted(() => ({
    mockFsMkdtemp: vi.fn(async (prefix: string) => `${prefix}Xy7Q2a`),
    mockFsRm: vi.fn().mockResolvedValue(undefined),
    mockSendFile: vi.fn().mockResolvedValue(undefined),
    mockGetFile: vi.fn().mockResolvedValue(undefined),
    mockList: vi.fn(),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockDeleteFile: vi.fn().mockResolvedValue(undefined),
    mockFsReadFile: vi.fn().mockResolvedValue("smb file content"),
    // The file smbclient wrote for read(), read back through a handle.
    mockFsOpen: vi.fn(async () => ({
        stat: async () => ({ size: 16 }),
        readFile: async () => Buffer.from("smb file content"),
        close: async () => undefined,
    })),
    mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
    mockFsUnlink: vi.fn().mockResolvedValue(undefined),
    mockSambaCtorShouldThrow: { value: false },
}));

// smbclient itself, which every command of samba-client reaches through the adapter's client.
const mockRunSmbclient = vi.hoisted(() => vi.fn(async () => ""));
vi.mock("@/lib/adapters/storage/smb-run", () => ({ runSmbclient: mockRunSmbclient }));

// The real client underneath, so a test can let a call through to the command line it builds.
vi.mock("samba-client", async () => {
    const Actual = (await vi.importActual<{ default: new (options: unknown) => object }>("samba-client")).default;
    class MockSambaClient extends Actual {
        constructor(options: unknown) {
            super(options);
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
        mkdtemp: mockFsMkdtemp,
        rm: mockFsRm,
        open: mockFsOpen,
    },
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
    unlink: mockFsUnlink,
    mkdtemp: mockFsMkdtemp,
    rm: mockFsRm,
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

        it("creates every missing folder of a nested path below the folder setting, one after the other", async () => {
            await SMBAdapter.upload(config, "/tmp/backup.tar", "tenants/t-globex/Nightly/backup.tar");

            expect(mockMkdir.mock.calls.map((call) => call[0])).toEqual(["backups/tenants", "backups/tenants/t-globex", "backups/tenants/t-globex/Nightly"]);
            expect(mockSendFile).toHaveBeenCalledWith("/tmp/backup.tar", "backups/tenants/t-globex/Nightly/backup.tar");
        });

        it("goes on when a folder of the path exists already, and makes each folder once in a session", async () => {
            mockMkdir.mockRejectedValueOnce(new Error("NT_STATUS_OBJECT_NAME_COLLISION making remote directory"));
            const session = await SMBAdapter.openSession!(config);

            await expect(session.upload("/tmp/a.tar", "tenants/t-globex/Nightly/a.tar")).resolves.toBe(true);
            await expect(session.upload("/tmp/b.tar", "tenants/t-globex/Weekly/b.tar")).resolves.toBe(true);
            expect(mockMkdir.mock.calls.map((call) => call[0])).toEqual(["backups/tenants", "backups/tenants/t-globex", "backups/tenants/t-globex/Nightly", "backups/tenants/t-globex/Weekly"]);
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

            expect(result).toBe("smb file content");
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

        it("ends an endless tree of folders on the server as it walks, since folders pass the guard too", async () => {
            // A loop of folders on the share, like a junction to a folder above, which the names
            // alone cannot show: every folder holds one more and never a file.
            mockList.mockResolvedValue([{ name: "loop".repeat(2000), type: "D", size: 0, modifyTime: new Date() }]);

            await expect(SMBAdapter.list(config, "Job")).rejects.toBeInstanceOf(ListingTooLargeError);
            expect(mockList.mock.calls.length).toBeLessThanOrEqual(5);
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

        it("writes its test file into a new folder of its own, never under a name in the shared temp folder, and removes the folder", async () => {
            const result = await SMBAdapter.test!(config);

            expect(result.success).toBe(true);
            const folder = await mockFsMkdtemp.mock.results[0].value;
            expect(mockFsMkdtemp.mock.calls[0][0]).toMatch(/smb-test-$/);
            const [file, , options] = mockFsWriteFile.mock.calls[0];
            expect(String(file).startsWith(`${folder}/`)).toBe(true);
            expect(options).toEqual(expect.objectContaining({ flag: "wx" }));
            expect(mockSendFile).toHaveBeenCalledWith(file, expect.any(String));
            expect(mockFsRm).toHaveBeenCalledWith(folder, expect.objectContaining({ recursive: true }));
        });

        it("runs no smbclient for an address the local network check would read otherwise", async () => {
            for (const address of ["//10.0.0.9#20/share", "//ncacn_ip_tcp:10.0.0.9[135]/share", "//[fd00::9]/share"]) {
                const result = await SMBAdapter.test!({ ...config, address });

                expect(result.success, address).toBe(false);
            }
            expect(mockSendFile).not.toHaveBeenCalled();
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

/**
 * smbclient takes its commands through `-c` as one line, split at every semicolon whatever the quotes
 * say, and samba-client puts each path into double quotes without escaping it. A name with a
 * semicolon, a double quote or a control character would end the command and run another, like a
 * `put` of the database of DBackup to the share. Such a path never reaches smbclient, and a listing
 * leaves such an entry out.
 */
describe("names smbclient would read as part of its command", () => {
    const BREAKERS = [
        ["a semicolon", "Job/x;put /app/data/dbackup.db loot"],
        ["a double quote", "Job/x\" \"/etc/cron.d/dbackup"],
        ["a line break", "Job/x\nput /app/data/dbackup.db loot"],
        ["a carriage return", "Job/x\r.tar"],
        ["a NUL", "Job/x\u0000.tar"],
        ["a DEL", "Job/x\u007f.tar"],
    ] as const;
    const REFUSED = "smbclient reads as part of its command";

    beforeEach(() => {
        vi.clearAllMocks();
        mockSambaCtorShouldThrow.value = false;
        mockSendFile.mockResolvedValue(undefined);
        mockGetFile.mockResolvedValue(undefined);
        mockMkdir.mockResolvedValue(undefined);
        mockDeleteFile.mockResolvedValue(undefined);
        mockList.mockResolvedValue([]);
    });

    it.each(BREAKERS)("refuses every command on a path with %s", async (_case, remotePath) => {
        await expect(SMBAdapter.upload(config, "/tmp/backup.tar", remotePath)).resolves.toBe(false);
        await expect(SMBAdapter.download(config, remotePath, "/tmp/out.tar")).resolves.toBe(false);
        await expect(SMBAdapter.read!(config, remotePath)).resolves.toBeNull();
        await expect(SMBAdapter.delete(config, remotePath)).resolves.toBe(false);
        await expect(SMBAdapter.list(config, remotePath)).rejects.toThrow(REFUSED);
        await expect(SMBAdapter.browseDirectories!(config, remotePath)).rejects.toThrow(REFUSED);

        for (const call of [mockSendFile, mockGetFile, mockDeleteFile, mockMkdir, mockList]) expect(call).not.toHaveBeenCalled();
    });

    it.each(BREAKERS)("refuses a folder setting with %s", async (_case, pathPrefix) => {
        const bad = { ...config, pathPrefix };

        await expect(SMBAdapter.upload(bad, "/tmp/backup.tar", "Job/backup.tar")).resolves.toBe(false);
        const ping = await SMBAdapter.ping!(bad);
        expect(ping.success).toBe(false);
        expect(ping.message).toContain(REFUSED);
        const test = await SMBAdapter.test!(bad);
        expect(test.success).toBe(false);
        expect(test.message).toContain(REFUSED);

        for (const call of [mockSendFile, mockMkdir, mockList, mockDeleteFile]) expect(call).not.toHaveBeenCalled();
    });

    it("refuses a local file whose name goes into the command", async () => {
        await expect(SMBAdapter.upload(config, "/tmp/x;put y z.tar", "Job/backup.tar")).resolves.toBe(false);
        await expect(SMBAdapter.download(config, "Job/backup.tar", "/tmp/out\" \"x.tar")).resolves.toBe(false);

        expect(mockSendFile).not.toHaveBeenCalled();
        expect(mockGetFile).not.toHaveBeenCalled();
    });

    it("leaves out entries of a listing whose names no later command can carry, and never lists into them", async () => {
        const at = new Date();
        mockList.mockResolvedValueOnce([
            { name: "Nightly;put x y", type: "D", size: 0, modifyTime: at },
            { name: "a\"b.tar", type: "A", size: 1, modifyTime: at },
            { name: "line\nbreak.tar", type: "A", size: 1, modifyTime: at },
            { name: "a;b.tar", type: "A", size: 1, modifyTime: at },
            { name: "ok.tar", type: "A", size: 1, modifyTime: at },
        ]);

        const files = await SMBAdapter.list(config, "Job");

        expect(files.map((file) => file.path)).toEqual(["Job/ok.tar"]);
        expect(mockList).toHaveBeenCalledTimes(1);
    });

    it("offers no folder in the browser whose name no later command can carry", async () => {
        const at = new Date();
        mockList.mockResolvedValueOnce([
            { name: "x;put y z", type: "D", size: 0, modifyTime: at },
            { name: "x\"y", type: "D", size: 0, modifyTime: at },
            { name: "Nightly", type: "D", size: 0, modifyTime: at },
        ]);

        await expect(SMBAdapter.browseDirectories!(config, "")).resolves.toEqual([{ name: "Nightly", path: "Nightly" }]);
    });

    it("hands smbclient one command per call, each path in one pair of quotes, and nothing for a name that would break it", async () => {
        type Library = { prototype: Record<string, (...args: unknown[]) => unknown> };
        const Actual = (await vi.importActual<{ default: Library }>("samba-client")).default;
        const argvs: string[][] = [];
        const passwords: (string | undefined)[] = [];
        mockRunSmbclient.mockImplementation((async (argv: string[], options: { password?: string }) => {
            argvs.push(argv);
            passwords.push(options.password);
            return "";
        }) as never);
        const throughLibrary = [[mockSendFile, "sendFile"], [mockGetFile, "getFile"], [mockMkdir, "mkdir"], [mockDeleteFile, "deleteFile"], [mockList, "list"]] as const;
        for (const [mock, method] of throughLibrary) {
            mock.mockImplementation(function (this: object, ...args: unknown[]) {
                return Actual.prototype[method].apply(this, args);
            });
        }

        try {
            for (const [, name] of BREAKERS) {
                await SMBAdapter.upload(config, "/tmp/backup.tar", name);
                await SMBAdapter.download(config, name, "/tmp/out.tar");
                await SMBAdapter.delete(config, name);
                await SMBAdapter.list(config, name).catch(() => undefined);
                await SMBAdapter.ping!({ ...config, pathPrefix: name });
            }
            expect(argvs).toEqual([]);

            await expect(SMBAdapter.upload(config, "/tmp/backup.tar", "Nightly/backup.tar")).resolves.toBe(true);
            await expect(SMBAdapter.download(config, "Nightly/backup.tar", "/tmp/out.tar")).resolves.toBe(true);
            await expect(SMBAdapter.delete(config, "Nightly/backup.tar")).resolves.toBe(true);
            await expect(SMBAdapter.list(config, "Nightly")).resolves.toEqual([]);

            const commands = argvs.map((argv) => argv[argv.indexOf("-c") + 1]);
            expect(commands).toEqual([
                "mkdir \"backups\\Nightly\"",
                "put \"backup.tar\" \"backups\\Nightly\\backup.tar\"",
                "get \"backups\\Nightly\\backup.tar\" \"/tmp/out.tar\"",
                "del \"backups\\Nightly\\backup.tar\"",
                "dir \"backups\\Nightly\\*\"",
            ]);
            for (const argv of argvs) {
                expect(argv.filter((arg) => arg === "-c")).toHaveLength(1);
                expect(argv).toContain(config.address);
                // DNS alone, never a NetBIOS broadcast into the local network the check of a tenant cannot see.
                expect(argv).toContain("--option=name resolve order=host");
                // The password goes into the environment of smbclient, never into argv, where the process table shows it.
                expect(argv).not.toContain(config.password);
                expect(argv).not.toContain("--password");
                expect(argv).not.toContain("-N");
            }
            expect(passwords.every((password) => password === config.password)).toBe(true);
        } finally {
            mockRunSmbclient.mockReset();
            for (const [mock] of throughLibrary) mock.mockReset();
        }
    });
});

describe("names of a listing that are no plain name of their folder", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSambaCtorShouldThrow.value = false;
    });

    it("leaves out names with a separator or of dots alone, and never lists into them", async () => {
        // A server answers `dir` with whatever it likes, and such a name would name a file
        // outside the folder of the source once the collection joins it on.
        const at = new Date();
        mockList.mockResolvedValueOnce([
            { name: "..\\..\\etc", type: "D", size: 0, modifyTime: at },
            { name: "../escape.tar", type: "A", size: 1, modifyTime: at },
            { name: "a\\b.tar", type: "A", size: 1, modifyTime: at },
            { name: "...", type: "D", size: 0, modifyTime: at },
            { name: "...", type: "A", size: 1, modifyTime: at },
            { name: "ok.tar", type: "A", size: 1, modifyTime: at },
            { name: "..ok.tar", type: "A", size: 1, modifyTime: at },
        ]);

        const files = await SMBAdapter.list(config, "Job");

        expect(files.map((file) => file.path)).toEqual(["Job/ok.tar", "Job/..ok.tar"]);
        expect(mockList).toHaveBeenCalledTimes(1);
    });
});

describe("a % in the user name or the domain", () => {
    // smbclient and rpcclient read `-U user%secret` as the password, which wins over the one
    // DBackup hands over in PASSWD, checked against Samba 4.22 with the share of the dev lab.
    beforeEach(() => {
        vi.clearAllMocks();
        mockSambaCtorShouldThrow.value = false;
        mockList.mockResolvedValue([]);
    });

    it.each([
        ["the user name", { username: "admin%guess" }],
        ["the domain", { domain: "WORKGROUP%guess" }],
    ])("refuses %s before smbclient runs", async (_case, login) => {
        const bad = { ...config, ...login };

        await expect(SMBAdapter.upload(bad, "/tmp/backup.tar", "Job/backup.tar")).rejects.toThrow("cannot hold a %");
        await expect(SMBAdapter.download(bad, "Job/backup.tar", "/tmp/out.tar")).resolves.toBe(false);
        await expect(SMBAdapter.list(bad, "Job")).rejects.toThrow("cannot hold a %");
        const test = await SMBAdapter.test!(bad);
        expect(test.success).toBe(false);
        expect(test.message).toContain("cannot hold a %");

        for (const call of [mockSendFile, mockGetFile, mockList, mockMkdir]) expect(call).not.toHaveBeenCalled();
        expect(mockRunSmbclient).not.toHaveBeenCalled();
    });

    it("is refused by the schema of the connection", async () => {
        const { SMBSchema } = await import("@/lib/adapters/definitions");
        expect(SMBSchema.safeParse({ ...config, username: "admin%x" }).success).toBe(false);
        expect(SMBSchema.safeParse({ ...config, domain: "WG%x" }).success).toBe(false);
        expect(SMBSchema.safeParse(config).success).toBe(true);
    });
});
