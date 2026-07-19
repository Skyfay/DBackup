import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
// child_process functions use callbacks, so promisify works when the mock calls its callback
const { mockExecCb, mockExecFileCb, mockRsyncExecute, mockFsWriteFile, mockFsUnlink, mockFsMkdir, mockFsReadFile } = vi.hoisted(() => ({
    mockExecCb: vi.fn(),
    mockExecFileCb: vi.fn(),
    mockRsyncExecute: vi.fn(),
    mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
    mockFsUnlink: vi.fn().mockResolvedValue(undefined),
    mockFsMkdir: vi.fn().mockResolvedValue(undefined),
    mockFsReadFile: vi.fn().mockResolvedValue("file content"),
}));

// child_process mock - exec/execFile call their last-arg callback so promisify works
vi.mock("child_process", () => ({
    exec: mockExecCb,
    execFile: mockExecFileCb,
    default: { exec: mockExecCb, execFile: mockExecFileCb },
}));

// rsync npm package mock - fluent API that chains, execute calls its first callback
vi.mock("rsync", () => {
    class MockRsync {
        flags() { return this; }
        set() { return this; }
        shell() { return this; }
        env() { return this; }
        source() { return this; }
        destination() { return this; }
        exclude() { return this; }
        execute = mockRsyncExecute;
    }
    return { default: MockRsync };
});

vi.mock("fs/promises", () => ({
    default: {
        writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
        unlink: (...args: unknown[]) => mockFsUnlink(...args),
        mkdir: (...args: unknown[]) => mockFsMkdir(...args),
        readFile: (...args: unknown[]) => mockFsReadFile(...args),
    },
    writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
    unlink: (...args: unknown[]) => mockFsUnlink(...args),
    mkdir: (...args: unknown[]) => mockFsMkdir(...args),
    readFile: (...args: unknown[]) => mockFsReadFile(...args),
}));

vi.mock("os", () => ({
    default: { tmpdir: () => "/tmp" },
    tmpdir: () => "/tmp",
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));

vi.mock("@/lib/logging/errors", () => ({
    wrapError: vi.fn((e) => e),
}));

// Import AFTER mocks so promisify captures the mock functions
import { RsyncAdapter } from "@/lib/adapters/storage/rsync";

// --- Helpers for default behaviors ---
function sshpassFound() {
    // execAsync("which sshpass") = promisify(exec) called with callback
    mockExecCb.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: null, result: { stdout: string }) => void;
        cb(null, { stdout: "/usr/bin/sshpass" });
    });
}

function sshpassNotFound() {
    mockExecCb.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error) => void;
        cb(new Error("sshpass: not found"));
    });
}

function sshSucceeds(stdout = "") {
    // execFileAsync(binary, args, opts) = promisify(execFile) with callback
    mockExecFileCb.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: null, result: { stdout: string }) => void;
        cb(null, { stdout });
    });
}

function sshFails(message = "SSH error") {
    mockExecFileCb.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error) => void;
        cb(new Error(message));
    });
}

function rsyncSucceeds() {
    mockRsyncExecute.mockImplementation((callback: (err: null, code: number, cmd: string) => void) => {
        callback(null, 0, "rsync ...");
    });
}

function rsyncFails(message = "rsync error") {
    mockRsyncExecute.mockImplementation((callback: (err: Error, code: number, cmd: string) => void) => {
        callback(new Error(message), 1, "rsync ...");
    });
}

// --- Configs ---
const agentConfig = {
    host: "backup.example.com",
    port: 22,
    username: "admin",
    authType: "agent" as const,
    pathPrefix: "/backups",
    options: undefined,
};

const keyConfig = {
    host: "backup.example.com",
    port: 22,
    username: "admin",
    authType: "privateKey" as const,
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
    pathPrefix: "/backups",
    options: undefined,
};

const passwordConfig = {
    host: "backup.example.com",
    port: 22,
    username: "admin",
    authType: "password" as const,
    password: "secret",
    pathPrefix: "/backups",
    options: undefined,
};

describe("RsyncAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sshpassFound(); // default: sshpass is available
        sshSucceeds();  // default: SSH commands succeed
        rsyncSucceeds(); // default: rsync succeeds
        mockFsWriteFile.mockResolvedValue(undefined);
        mockFsUnlink.mockResolvedValue(undefined);
        mockFsMkdir.mockResolvedValue(undefined);
        mockFsReadFile.mockResolvedValue("file content");
    });

    // ===== adapter metadata =====

    it("has correct id, type, and name", () => {
        expect(RsyncAdapter.id).toBe("rsync");
        expect(RsyncAdapter.type).toBe("storage");
        expect(RsyncAdapter.name).toBe("Rsync (SSH)");
    });

    // ===== upload() =====

    describe("upload()", () => {
        it("returns true on successful upload (agent auth)", async () => {
            const result = await RsyncAdapter.upload(agentConfig, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockRsyncExecute).toHaveBeenCalled();
        });

        it("returns true on successful upload (private key auth)", async () => {
            const result = await RsyncAdapter.upload(keyConfig, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockFsWriteFile).toHaveBeenCalled(); // temp key written
            expect(mockFsUnlink).toHaveBeenCalled();    // temp key cleaned up
        });

        it("returns true on successful upload (password auth)", async () => {
            const result = await RsyncAdapter.upload(passwordConfig, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
        });

        it("returns false when rsync execution fails", async () => {
            rsyncFails("Permission denied");

            const result = await RsyncAdapter.upload(agentConfig, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("continues when SSH mkdir fails (rsync handles directory creation)", async () => {
            sshFails("mkdir: cannot create directory"); // SSH mkdir fails

            const result = await RsyncAdapter.upload(agentConfig, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true); // rsync itself succeeds
        });

        it("calls onProgress with 100 after successful upload", async () => {
            const onProgress = vi.fn();

            await RsyncAdapter.upload(agentConfig, "/tmp/backup.sql", "Job/backup.sql", onProgress);

            expect(onProgress).toHaveBeenCalledWith(100);
        });

        it("parses progress percentage from rsync stdout", async () => {
            mockRsyncExecute.mockImplementation(
                (callback: (e: null, c: number, s: string) => void, stdout: (d: Buffer) => void) => {
                    stdout(Buffer.from("   1024 55% some-hash:00:00"));
                    callback(null, 0, "rsync ...");
                }
            );
            const onProgress = vi.fn();

            await RsyncAdapter.upload(agentConfig, "/tmp/backup.sql", "Job/backup.sql", onProgress);

            expect(onProgress).toHaveBeenCalledWith(55);
            expect(onProgress).toHaveBeenCalledWith(100);
        });

        it("calls onLog with upload info", async () => {
            const onLog = vi.fn();

            await RsyncAdapter.upload(agentConfig, "/tmp/backup.sql", "Job/backup.sql", undefined, onLog);

            expect(onLog).toHaveBeenCalledWith(expect.stringContaining("backup.example.com"), "info", "storage");
        });

        it("cleans up temp key even on upload error (private key)", async () => {
            rsyncFails("upload error");

            await RsyncAdapter.upload(keyConfig, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockFsUnlink).toHaveBeenCalled();
        });

        it("handles rsync stderr log output", async () => {
            mockRsyncExecute.mockImplementation(
                (callback: (e: null, c: number, s: string) => void, _stdout: unknown, stderr: (d: Buffer) => void) => {
                    stderr(Buffer.from("rsync: warning: some-warning"));
                    callback(null, 0, "rsync ...");
                }
            );
            const onLog = vi.fn();

            const result = await RsyncAdapter.upload(agentConfig, "/tmp/backup.sql", "Job/backup.sql", undefined, onLog);

            expect(result).toBe(true);
        });

        it("applies extra options (single-char flags, long options, key=value)", async () => {
            const configWithOpts = {
                ...agentConfig,
                options: "-v --checksum --bwlimit=1000",
            };

            const result = await RsyncAdapter.upload(configWithOpts, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
        });
    });

    // ===== download() =====

    describe("download()", () => {
        it("returns true on successful download (agent auth)", async () => {
            const result = await RsyncAdapter.download(agentConfig, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(true);
            expect(mockRsyncExecute).toHaveBeenCalled();
        });

        it("returns true on successful download (private key auth)", async () => {
            const result = await RsyncAdapter.download(keyConfig, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(true);
            expect(mockFsWriteFile).toHaveBeenCalled();
        });

        it("returns false when rsync execution fails", async () => {
            rsyncFails("connection refused");

            const result = await RsyncAdapter.download(agentConfig, "Job/missing.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });

        it("calls onProgress with byte count from rsync stdout", async () => {
            mockRsyncExecute.mockImplementation(
                (callback: (e: null, c: number, s: string) => void, stdout: (d: Buffer) => void) => {
                    stdout(Buffer.from("   512,345 55% some-hash:00:00"));
                    callback(null, 0, "rsync ...");
                }
            );
            const onProgress = vi.fn();

            await RsyncAdapter.download(agentConfig, "Job/backup.sql", "/tmp/out.sql", onProgress);

            expect(onProgress).toHaveBeenCalled();
        });

        it("calls onLog during download", async () => {
            const onLog = vi.fn();

            await RsyncAdapter.download(agentConfig, "Job/backup.sql", "/tmp/out.sql", undefined, onLog);

            expect(onLog).toHaveBeenCalledWith(expect.stringContaining("backup.example.com"), "info", "storage");
        });
    });

    // ===== read() =====

    describe("read()", () => {
        it("returns file content via SSH cat (agent auth)", async () => {
            sshSucceeds('{"checksum":"abc"}');

            const result = await RsyncAdapter.read!(agentConfig, "Job/meta.json");

            expect(result).toBe('{"checksum":"abc"}');
        });

        it("falls back to rsync when SSH cat fails", async () => {
            // SSH cat fails (first execFile call)
            mockExecFileCb
                .mockImplementationOnce((...args: unknown[]) => {
                    const cb = args[args.length - 1] as (err: Error) => void;
                    cb(new Error("cat: file not found"));
                })
                // subsequent rsync SSH mkdir call would succeed
                .mockImplementation((...args: unknown[]) => {
                    const cb = args[args.length - 1] as (err: null, result: { stdout: string }) => void;
                    cb(null, { stdout: "" });
                });

            mockFsReadFile.mockResolvedValue("fallback file content");

            const result = await RsyncAdapter.read!(agentConfig, "Job/meta.json");

            expect(result).toBe("fallback file content");
        });

        it("returns null when both SSH and rsync fail", async () => {
            sshFails("SSH error");
            rsyncFails("rsync error");

            const result = await RsyncAdapter.read!(agentConfig, "Job/missing.meta.json");

            expect(result).toBeNull();
        });

        it("uses private key auth when configured", async () => {
            sshSucceeds("key-file-content");

            const result = await RsyncAdapter.read!(keyConfig, "Job/meta.json");

            expect(result).not.toBeNull();
            expect(mockFsWriteFile).toHaveBeenCalled(); // temp key written
        });
    });

    // ===== list() =====

    describe("list()", () => {
        it("parses find output and returns file list", async () => {
            sshSucceeds(
                "/backups/Job/backup.sql\t1024\t1700000000.0\n/backups/Job/backup2.sql\t2048\t1700001000.0"
            );

            const result = await RsyncAdapter.list!(agentConfig, "Job");

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe("backup.sql");
            expect(result[0].size).toBe(1024);
        });

        it("returns empty array when SSH returns no output", async () => {
            sshSucceeds("");

            const result = await RsyncAdapter.list!(agentConfig, "");

            expect(result).toEqual([]);
        });

        it("throws on SSH error", async () => {
            sshFails("SSH connection refused");

            await expect(RsyncAdapter.list!(agentConfig, "Job")).rejects.toThrow("SSH connection refused");
        });

        it("skips lines without enough tab-separated fields", async () => {
            sshSucceeds("incomplete-line\n/backups/ok.sql\t100\t1700000000\n");

            const result = await RsyncAdapter.list!(agentConfig, "");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("ok.sql");
        });

        it("strips pathPrefix from returned relative paths", async () => {
            sshSucceeds("/backups/Job/backup.sql\t100\t1700000000\n");

            const result = await RsyncAdapter.list!(agentConfig, "Job");

            expect(result[0].path).not.toContain("/backups/");
        });

        it("uses private key auth and cleans up temp file", async () => {
            sshSucceeds("/backups/a.sql\t100\t1700000000\n");

            await RsyncAdapter.list!(keyConfig, "");

            expect(mockFsWriteFile).toHaveBeenCalled();
            expect(mockFsUnlink).toHaveBeenCalled();
        });
    });

    // ===== delete() =====

    describe("delete()", () => {
        it("returns true on successful delete (agent auth)", async () => {
            const result = await RsyncAdapter.delete!(agentConfig, "Job/backup.sql");

            expect(result).toBe(true);
        });

        it("returns true on successful delete (private key auth)", async () => {
            const result = await RsyncAdapter.delete!(keyConfig, "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockFsWriteFile).toHaveBeenCalled();
            expect(mockFsUnlink).toHaveBeenCalled();
        });

        it("returns true on successful delete (password auth)", async () => {
            const result = await RsyncAdapter.delete!(passwordConfig, "Job/backup.sql");

            expect(result).toBe(true);
        });

        it("returns false on SSH error", async () => {
            sshFails("Permission denied");

            const result = await RsyncAdapter.delete!(agentConfig, "Job/backup.sql");

            expect(result).toBe(false);
        });
    });

    // ===== test() =====

    describe("test()", () => {
        it("returns success when connection test passes (agent auth)", async () => {
            const result = await RsyncAdapter.test!(agentConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successful");
        });

        it("returns success with private key auth and cleans up temp key", async () => {
            const result = await RsyncAdapter.test!(keyConfig);

            expect(result.success).toBe(true);
            expect(mockFsWriteFile).toHaveBeenCalled();
            expect(mockFsUnlink).toHaveBeenCalled();
        });

        it("returns permission denied message when mkdir reports permission denied", async () => {
            mockExecFileCb.mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: Error) => void;
                cb(new Error("mkdir: Permission denied creating /backups"));
            });

            const result = await RsyncAdapter.test!(agentConfig);

            expect(result.success).toBe(false);
            expect(result.message.toLowerCase()).toContain("permission denied");
        });

        it("returns failure when rsync test upload fails", async () => {
            // SSH mkdir succeeds
            mockExecFileCb.mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, result: { stdout: string }) => void;
                cb(null, { stdout: "" });
            });
            rsyncFails("Connection refused");

            const result = await RsyncAdapter.test!(agentConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("failed");
        });

        it("returns success with password auth", async () => {
            const result = await RsyncAdapter.test!(passwordConfig);

            expect(result.success).toBe(true);
        });

        it("re-throws non-permission-denied mkdir errors (line 491)", async () => {
            // SSH mkdir fails with a generic connection error
            mockExecFileCb.mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: Error) => void;
                cb(new Error("Connection refused: host unreachable"));
            });

            const result = await RsyncAdapter.test!(agentConfig);

            expect(result.success).toBe(false);
            expect(result.message.toLowerCase()).not.toContain("permission denied");
        });
    });

    // ====================================================================
    // sshpass not found - module isolation for _sshpassAvailable = false
    // (covers lines 153, 173, 238)
    // ====================================================================
    describe("sshpass unavailable paths (module isolation)", () => {
        it("caches _sshpassAvailable=false and throws in test() password auth (lines 153, 173)", async () => {
            vi.resetModules();

            // sshpass check fails, SSH execFile still succeeds
            sshpassNotFound();
            sshSucceeds();
            rsyncSucceeds();
            mockFsWriteFile.mockResolvedValue(undefined);
            mockFsUnlink.mockResolvedValue(undefined);
            mockFsMkdir.mockResolvedValue(undefined);

            const { RsyncAdapter: freshRsync } = await import("@/lib/adapters/storage/rsync");

            // test() with password auth calls execSSH first → checkSshpass fails → throw
            const result = await freshRsync.test!(passwordConfig);

            expect(result.success).toBe(false);
        });

        it("throws in createRsyncInstance when sshpass not available (line 238)", async () => {
            vi.resetModules();

            sshpassNotFound();
            sshSucceeds();
            rsyncSucceeds();

            const { RsyncAdapter: freshRsync } = await import("@/lib/adapters/storage/rsync");

            // upload() with password auth calls createRsyncInstance → checkSshpass fails → throw
            const result = await freshRsync.upload(passwordConfig, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });
    });

    // ===== downloadDirectory() =====
    // Native directory-sync capability used by directory-source (JobSource) backups.

    describe("downloadDirectory()", () => {
        beforeEach(() => {
            mockFsMkdir.mockResolvedValue(undefined);
        });

        it("lists the remote directory, syncs it with rsync, and returns the file index", async () => {
            sshSucceeds(
                "/backups/Job/a.txt\t100\t1700000000.0\n/backups/Job/sub/b.txt\t200\t1700000100.0"
            );
            rsyncSucceeds();

            const result = await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            expect(result.files).toBe(2);
            expect(result.bytes).toBe(300);
            expect(result.entries.map((e) => e.relativePath).sort()).toEqual(["a.txt", "sub/b.txt"]);
            expect(mockFsMkdir).toHaveBeenCalledWith("/local/job", { recursive: true });
        });

        it("returns an empty result without invoking rsync when the directory has no files", async () => {
            sshSucceeds("");

            const result = await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            expect(result).toEqual({ files: 0, bytes: 0, entries: [] });
            expect(mockRsyncExecute).not.toHaveBeenCalled();
        });

        it("excludes files matching the given glob patterns before transfer", async () => {
            sshSucceeds(
                "/backups/Job/keep.txt\t100\t1700000000.0\n/backups/Job/cache.tmp\t50\t1700000000.0"
            );
            rsyncSucceeds();

            const result = await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job", ["*.tmp"]);

            expect(result.files).toBe(1);
            expect(result.entries[0].relativePath).toBe("keep.txt");
        });

        it("reports aggregate progress parsed from rsync --info=progress2 output", async () => {
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            mockRsyncExecute.mockImplementation(
                (callback: (err: null, code: number, cmd: string) => void, stdoutCb: (data: Buffer) => void) => {
                    stdoutCb(Buffer.from(" 100  100%   1.00MB/s    0:00:00  (xfr#1, to-chk=0/1)\n"));
                    callback(null, 0, "rsync ...");
                }
            );

            const onProgress = vi.fn();
            await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job", undefined, onProgress);

            expect(onProgress).toHaveBeenCalledWith(100, 100, 1, 1);
        });

        it("propagates rsync failure", async () => {
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncFails("rsync connection reset");

            await expect(RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job")).rejects.toThrow();
        });
    });
});
