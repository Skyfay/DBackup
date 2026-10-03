import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
// child_process functions use callbacks, so promisify works when the mock calls its callback
const { mockExecCb, mockExecFileCb, mockRsyncExecute, mockFsWriteFile, mockFsUnlink, mockFsMkdir, mockFsReadFile, mockRsyncShell, mockRsyncSet, mockRsyncFlags, mockRsyncExclude } = vi.hoisted(() => ({
    mockExecCb: vi.fn(),
    mockExecFileCb: vi.fn(),
    mockRsyncExecute: vi.fn(),
    mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
    mockFsUnlink: vi.fn().mockResolvedValue(undefined),
    mockFsMkdir: vi.fn().mockResolvedValue(undefined),
    mockFsReadFile: vi.fn().mockResolvedValue("file content"),
    // The `--rsh` command rsync is told to use. This is where the bulk of the SSH logins happen,
    // so a test that only inspects execFile calls would miss the transfers entirely.
    mockRsyncShell: vi.fn(),
    mockRsyncSet: vi.fn(),
    mockRsyncFlags: vi.fn(),
    mockRsyncExclude: vi.fn(),
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
        flags(...args: unknown[]) { mockRsyncFlags(...args); return this; }
        set(...args: unknown[]) { mockRsyncSet(...args); return this; }
        shell(cmd: string) { mockRsyncShell(cmd); return this; }
        env() { return this; }
        source() { return this; }
        destination() { return this; }
        exclude(...args: unknown[]) { mockRsyncExclude(...args); return this; }
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
import { Minimatch } from "minimatch";
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

            expect(result).toEqual({ files: 0, bytes: 0, entries: [], failures: [] });
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

    // ===== downloadDirectory() and what the transfer takes =====

    describe("downloadDirectory() transfers what the index lists", () => {
        /** One line of the remote `find`, as the listing parses it. */
        const found = (relativePath: string, size = 10) => `/backups/Job/${relativePath}\t${size}\t1700000000.0\tf\t`;

        /**
         * rsync's own --exclude rules, for the shapes used here (man rsync, INCLUDE/EXCLUDE
         * PATTERN RULES), checked against rsync 3.4.3: an unanchored pattern with a slash
         * matches at every depth, and a slash-free one matches every part of a path, folders
         * included, which drops the whole folder. The index uses other rules, which is the bug.
         */
        function rsyncExcludes(relativePath: string, pattern: string): boolean {
            const parts = relativePath.split("/");
            const glob = new Minimatch(pattern, { dot: true });
            if (!pattern.includes("/")) return parts.some((part) => glob.match(part));
            return parts.some((_, index) => glob.match(parts.slice(index).join("/")));
        }

        /** What rsync copies for the options the adapter set: the list it was handed, or everything its excludes leave. */
        function copiedBy(listed: string[]): string[] {
            const fromList = mockRsyncSet.mock.calls.find(([option]) => option === "files-from")?.[1] as string | undefined;
            if (fromList) {
                const written = mockFsWriteFile.mock.calls.find(([file]) => file === fromList)?.[1] as string;
                return written.split("\0").filter(Boolean);
            }
            const patterns = mockRsyncExclude.mock.calls.flatMap(([value]) => (Array.isArray(value) ? value : [value])) as string[];
            return listed.filter((relativePath) => !patterns.some((pattern) => rsyncExcludes(relativePath, pattern)));
        }

        it("copies every file the index keeps, also where rsync would read the patterns otherwise", async () => {
            const listed = ["app/index.js", "app/node_modules/react/index.js", "node_modules/top.js", "foo.log/notes.txt", "app.log"];
            sshSucceeds(listed.map((relativePath) => found(relativePath)).join("\n"));

            const result = await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job", ["node_modules/**", "*.log"]);

            // The index follows the rule every other adapter uses: node_modules/** only at the
            // top, *.log only on file names. A nested node_modules and a folder named foo.log stay.
            const indexed = result.entries.map((entry) => entry.relativePath).sort();
            expect(indexed).toEqual(["app/index.js", "app/node_modules/react/index.js", "foo.log/notes.txt"]);
            // Every file of the index has to arrive, or hashing it fails the run with ENOENT.
            expect(copiedBy(listed).sort()).toEqual(indexed);
        });

        it("hands rsync the list separated by NUL, so no file name can break it", async () => {
            // Spaces and glob characters stay literal in a list, where a pattern would read them.
            sshSucceeds([found("a.txt"), found("odd dir/[weird]*.txt")].join("\n"));

            await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job", ["*.tmp"]);

            const fromList = mockRsyncSet.mock.calls.find(([option]) => option === "files-from")?.[1];
            expect(fromList).toMatch(/^\/tmp\/rsync-files-/);
            expect(mockRsyncSet).toHaveBeenCalledWith("from0");
            expect(mockFsWriteFile).toHaveBeenCalledWith(fromList, "a.txt\0odd dir/[weird]*.txt\0", { mode: 0o600 });
            // rsync's own excludes would read the patterns by other rules, so none are passed.
            expect(mockRsyncExclude).not.toHaveBeenCalled();
        });

        it("removes the list after the transfer", async () => {
            sshSucceeds(found("a.txt"));

            await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            const fromList = mockRsyncSet.mock.calls.find(([option]) => option === "files-from")?.[1];
            expect(mockFsUnlink).toHaveBeenCalledWith(fromList);
        });

        it("removes the list when rsync fails too", async () => {
            sshSucceeds(found("a.txt"));
            rsyncFails("connection reset");

            await expect(RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job")).rejects.toThrow();

            const fromList = mockRsyncSet.mock.calls.find(([option]) => option === "files-from")?.[1];
            expect(mockFsUnlink).toHaveBeenCalledWith(fromList);
        });

        it("reports what the patterns kept out, like the other adapters", async () => {
            sshSucceeds([found("keep.txt"), found("node_modules/a.js", 500), found("cache.tmp", 50)].join("\n"));
            const onLog = vi.fn();

            await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job", ["node_modules/**", "*.tmp"], undefined, onLog);

            const summary = onLog.mock.calls.find(([message]) => String(message).includes("skipped by exclude patterns"));
            expect(summary, "expected a summary line").toBeTruthy();
            expect(summary![0]).toContain("2 file(s)");
            expect(summary![3]).toContain("node_modules/**");
        });
    });

    // ===== downloadDirectory() on an incremental run =====

    describe("downloadDirectory() incremental", () => {
        /** One line of the remote `find`, as the listing parses it. */
        const found = (relativePath: string, size = 10) => `/backups/Job/${relativePath}\t${size}\t1700000000.0\tf\t`;
        /** The same for a symbolic link, which carries its target in the last column. */
        const foundLink = (relativePath: string, target: string) => `/backups/Job/${relativePath}\t7\t1700000000.0\tl\t${target}`;

        /** The relative paths rsync was handed through --files-from. */
        function handedToRsync(): string[] {
            const fromList = mockRsyncSet.mock.calls.find(([option]) => option === "files-from")?.[1] as string | undefined;
            if (!fromList) return [];
            const written = mockFsWriteFile.mock.calls.find(([file]) => file === fromList)?.[1] as string;
            return written.split("\0").filter(Boolean);
        }

        it("hands rsync only the changed files and carries the rest forward", async () => {
            sshSucceeds([found("changed.txt", 100), found("same.txt", 200), found("also-same.txt", 300)].join("\n"));

            const result = await RsyncAdapter.downloadDirectory!(
                agentConfig, "Job", "/local/job", undefined, undefined, undefined,
                { shouldDownload: (entry) => entry.relativePath === "changed.txt" }
            );

            // The destination tree is new on every run, so rsync cannot work this out itself.
            expect(handedToRsync()).toEqual(["changed.txt"]);
            // Every file still belongs to the snapshot. The two that did not move are marked
            // unchanged, which is what the runner turns into a carry-forward reference.
            expect(result.entries.map((e) => [e.relativePath, e.unchanged ?? false])).toEqual([
                ["changed.txt", false],
                ["same.txt", true],
                ["also-same.txt", true],
            ]);
            expect(result.files).toBe(3);
            // Only what moved, so the run reports the bandwidth it actually spent.
            expect(result.bytes).toBe(100);
        });

        it("never asks about a symbolic link and always transfers it", async () => {
            sshSucceeds([found("a.txt"), foundLink("link", "/etc/hosts")].join("\n"));
            const shouldDownload = vi.fn().mockReturnValue(false);

            const result = await RsyncAdapter.downloadDirectory!(
                agentConfig, "Job", "/local/job", undefined, undefined, undefined, { shouldDownload }
            );

            // Marking a link unchanged would hand it to the carry-forward path, which links do
            // not take part in, and it would disappear from the snapshot.
            expect(shouldDownload).toHaveBeenCalledTimes(1);
            expect(shouldDownload).toHaveBeenCalledWith(expect.objectContaining({ relativePath: "a.txt" }));
            expect(handedToRsync()).toEqual(["link"]);
            expect(result.entries.find((e) => e.relativePath === "link")?.unchanged).toBeUndefined();
        });

        it("starts no transfer at all when nothing changed", async () => {
            sshSucceeds([found("a.txt", 10), found("b.txt", 20)].join("\n"));
            const onLog = vi.fn();

            const result = await RsyncAdapter.downloadDirectory!(
                agentConfig, "Job", "/local/job", undefined, undefined, onLog, { shouldDownload: () => false }
            );

            // An empty list is legal, but running rsync to copy nothing still costs an SSH login.
            expect(mockRsyncExecute).not.toHaveBeenCalled();
            expect(result).toEqual({
                files: 2,
                bytes: 0,
                entries: [
                    { relativePath: "a.txt", size: 10, lastModified: new Date(1700000000000), unchanged: true },
                    { relativePath: "b.txt", size: 20, lastModified: new Date(1700000000000), unchanged: true },
                ],
                failures: [],
            });
            expect(onLog.mock.calls.map(([message]) => String(message)))
                .toContain("2 of 2 file(s) unchanged, not transferred");
        });

        it("counts the files it skipped towards the progress it reports", async () => {
            sshSucceeds([found("changed.txt", 100), found("same.txt", 200)].join("\n"));
            mockRsyncExecute.mockImplementation(
                (callback: (err: null, code: number, cmd: string) => void, stdoutCb: (data: Buffer) => void) => {
                    stdoutCb(Buffer.from(" 100  100%   1.00MB/s    0:00:00  (xfr#1, to-chk=0/1)\n"));
                    callback(null, 0, "rsync ...");
                }
            );
            const onProgress = vi.fn();

            await RsyncAdapter.downloadDirectory!(
                agentConfig, "Job", "/local/job", undefined, onProgress, undefined,
                { shouldDownload: (entry) => entry.relativePath === "changed.txt" }
            );

            // rsync counts only the one file it was given. Reported against the whole source,
            // or an incremental would start at zero out of two and jump at the end.
            expect(onProgress).toHaveBeenCalledWith(100, 100, 2, 2);
        });

        it("transfers everything when no predicate is given, as a full run does", async () => {
            sshSucceeds([found("a.txt", 10), found("b.txt", 20)].join("\n"));

            const result = await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            expect(handedToRsync()).toEqual(["a.txt", "b.txt"]);
            expect(result.entries.every((e) => e.unchanged === undefined)).toBe(true);
            expect(result.bytes).toBe(30);
        });
    });

    // ===== downloadDirectory() cancellation =====

    describe("downloadDirectory() cancel", () => {
        const found = (relativePath: string, size = 10) => `/backups/Job/${relativePath}\t${size}\t1700000000.0\tf\t`;

        /**
         * A transfer that stays alive until something kills it, as a large file would.
         *
         * Returns the kill spy and a way to let the process report its own exit, so a test
         * can choose whether it dies on the signal or ignores it.
         */
        function rsyncHangs() {
            const kill = vi.fn();
            let report: ((error: Error | null) => void) | undefined;
            mockRsyncExecute.mockImplementation((callback: (err: Error | null, code: number, cmd: string) => void) => {
                report = (error) => callback(error, error ? 20 : 0, "rsync ...");
                return { kill };
            });
            return { kill, started: () => report !== undefined, exits: (error: Error | null) => report!(error) };
        }

        it("ends the running transfer instead of waiting it out", async () => {
            sshSucceeds(found("big.bin", 1_000_000_000));
            const proc = rsyncHangs();
            const controller = new AbortController();

            const pending = RsyncAdapter.downloadDirectory!(
                agentConfig, "Job", "/local/job", undefined, undefined, undefined, { signal: controller.signal }
            );
            await vi.waitFor(() => expect(proc.started()).toBe(true));

            // rsync has no way to be asked to stop, so the process is signalled.
            controller.abort(new Error("Cancelled by the user"));
            expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

            // The cancel answers now. Waiting for the process to report its own death would
            // hang the run on a child that cannot be reached at all.
            await expect(pending).rejects.toThrow("Cancelled by the user");
        });

        it("kills a transfer outright when it does not end on the signal", async () => {
            vi.useFakeTimers();
            try {
                sshSucceeds(found("big.bin", 1_000_000_000));
                const proc = rsyncHangs();
                const controller = new AbortController();

                const pending = RsyncAdapter.downloadDirectory!(
                    agentConfig, "Job", "/local/job", undefined, undefined, undefined, { signal: controller.signal }
                );
                await vi.waitFor(() => expect(proc.started()).toBe(true));
                controller.abort(new Error("Cancelled by the user"));
                await expect(pending).rejects.toThrow("Cancelled by the user");

                // A transfer blocked on a socket whose other end is gone never handles
                // SIGTERM, so without this a cancel waits out the TCP timeout.
                expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");
                vi.advanceTimersByTime(5000);
                expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
            } finally {
                vi.useRealTimers();
            }
        });

        it("leaves a transfer that ends on the signal alone afterwards", async () => {
            vi.useFakeTimers();
            try {
                sshSucceeds(found("big.bin", 1_000_000_000));
                const proc = rsyncHangs();
                const controller = new AbortController();

                const pending = RsyncAdapter.downloadDirectory!(
                    agentConfig, "Job", "/local/job", undefined, undefined, undefined, { signal: controller.signal }
                );
                await vi.waitFor(() => expect(proc.started()).toBe(true));
                controller.abort(new Error("Cancelled by the user"));
                await expect(pending).rejects.toThrow("Cancelled by the user");

                // It reported its exit, so there is nothing left to escalate against. A
                // SIGKILL at this point would land on whatever reused the process id.
                proc.exits(new Error("rsync error: received SIGTERM"));
                vi.advanceTimersByTime(5000);
                expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");
            } finally {
                vi.useRealTimers();
            }
        });

        it("reports a cancelled run as cancelled, not as a source that failed", async () => {
            sshSucceeds(found("big.bin", 1_000_000_000));
            const proc = rsyncHangs();
            const controller = new AbortController();
            const onLog = vi.fn();

            const pending = RsyncAdapter.downloadDirectory!(
                agentConfig, "Job", "/local/job", undefined, undefined, onLog, { signal: controller.signal }
            );
            await vi.waitFor(() => expect(proc.started()).toBe(true));
            controller.abort(new Error("Cancelled by the user"));
            await expect(pending).rejects.toThrow("Cancelled by the user");
            proc.exits(new Error("rsync error: received SIGTERM"));

            // A red line in the history of a run whose only story is that someone stopped it.
            expect(onLog.mock.calls.filter(([, level]) => level === "error")).toEqual([]);
        });

        it("opens no SSH session when the run was cancelled before it started", async () => {
            const controller = new AbortController();
            controller.abort(new Error("Cancelled by the user"));

            await expect(RsyncAdapter.downloadDirectory!(
                agentConfig, "Job", "/local/job", undefined, undefined, undefined, { signal: controller.signal }
            )).rejects.toThrow("Cancelled by the user");

            // Checked before the listing, so a cancel during an earlier source does not cost
            // this one a login and a `find` over the whole tree.
            expect(mockExecFileCb).not.toHaveBeenCalled();
            expect(mockRsyncExecute).not.toHaveBeenCalled();
        });

        it("transfers to the end when no signal is given", async () => {
            sshSucceeds(found("a.txt"));

            const result = await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            expect(result.files).toBe(1);
            expect(mockRsyncExecute).toHaveBeenCalled();
        });
    });

    // ===== browseDirectories() =====

    describe("browseDirectories()", () => {
        /** The command the listing ran over SSH, the last argument handed to ssh. */
        const listingCommand = () => String(mockExecFileCb.mock.calls.at(-1)![1].at(-1));

        it("lists the folders with a find that GNU, BSD and BusyBox all know", async () => {
            // Whole paths come back, since -printf is GNU only: the find of macOS and BusyBox refuse it.
            sshSucceeds("/srv/backups\n/srv/space dir\n/srv/.cache");

            const entries = await RsyncAdapter.browseDirectories!({ ...agentConfig, pathPrefix: "/" }, "srv");

            expect(entries).toEqual([
                { name: "backups", path: "srv/backups" },
                { name: "space dir", path: "srv/space dir" },
                { name: ".cache", path: "srv/.cache" },
            ]);
            expect(listingCommand()).toBe("find '/srv' -mindepth 1 -maxdepth 1 -type d 2>/dev/null");
        });

        it("answers an empty folder with no entries", async () => {
            sshSucceeds("");

            expect(await RsyncAdapter.browseDirectories!(agentConfig, "")).toEqual([]);
        });
    });

    // ===== openSession() =====

    describe("openSession() connection reuse", () => {
        /** The `-o ControlPath=...` value shared by every SSH invocation of a session. */
        function controlPathsUsed(): string[] {
            return mockExecFileCb.mock.calls
                .flatMap((call) => (Array.isArray(call[1]) ? (call[1] as string[]) : []))
                .filter((arg) => typeof arg === "string" && arg.startsWith("ControlPath="));
        }

        it("routes every transfer through one shared SSH connection", async () => {
            // rsync starts a process per file, each authenticating over SSH again - a 129-file
            // restore made well over 129 logins in under a minute. That is slow, and it is what
            // an SSH server's connection-rate limiting exists to stop: OpenSSH's MaxStartups
            // drops a share at random, which rsync reports as a bare exit code 255.
            sshSucceeds();
            rsyncSucceeds();
            const session = await RsyncAdapter.openSession!(agentConfig);

            await session.upload("/tmp/a", "Job/a");
            await session.upload("/tmp/b", "Job/b");

            // The transfers themselves, not just the remote mkdir: rsync is told to reuse the
            // socket via its --rsh command, which is where the per-file logins would otherwise be.
            const shellCommands = mockRsyncShell.mock.calls.map((c) => String(c[0]));
            expect(shellCommands.length).toBe(2);
            for (const cmd of shellCommands) {
                expect(cmd).toContain("ControlMaster=auto");
                expect(cmd).toContain("ControlPath=");
            }

            const sockets = new Set([
                ...controlPathsUsed().map((p) => p.replace("ControlPath=", "")),
                ...shellCommands.map((c) => c.match(/ControlPath=(\S+)/)?.[1] ?? ""),
            ]);
            expect(sockets.size).toBe(1);
        });

        it("opens the shared connection once, before any transfer runs", async () => {
            // Left to whichever transfer starts first, several beginning at the same moment would
            // each find no socket and open a master of their own - the very thing this avoids.
            sshSucceeds();
            rsyncSucceeds();

            await RsyncAdapter.openSession!(agentConfig);

            expect(mockExecFileCb).toHaveBeenCalled();
            expect(controlPathsUsed().length).toBeGreaterThan(0);
        });

        it("shuts the shared connection down instead of leaving it authenticated", async () => {
            // Deleting the socket file alone would orphan the master, which then holds an open
            // authenticated connection until ControlPersist runs out.
            sshSucceeds();
            rsyncSucceeds();
            const session = await RsyncAdapter.openSession!(agentConfig);
            mockExecFileCb.mockClear();

            await session.close();

            const exitCall = mockExecFileCb.mock.calls.find((call) =>
                Array.isArray(call[1]) && (call[1] as string[]).includes("-O") && (call[1] as string[]).includes("exit"));
            expect(exitCall, "expected an `ssh -O exit`").toBeTruthy();
        });

        it("still transfers when the server refuses a shared connection", async () => {
            // Multiplexing is an optimisation, not a requirement. A server that rejects it must
            // not take the whole restore with it - the transfers just pay a login each, as before.
            sshFails("multiplexing not supported");
            rsyncSucceeds();

            const session = await RsyncAdapter.openSession!(agentConfig);
            const ok = await session.upload("/tmp/a", "Job/a");
            await session.close();

            expect(ok).toBe(true);
        });
    });

    // ===== rsync capability probing =====

    describe("downloadDirectory() flag support", () => {
        // The probe result is cached for the process, which is right in production and wrong
        // here: each case needs its own rsync. Reloading the module gives it a fresh cache.
        // The vi.mock registrations above survive resetModules, so the mocks still apply.
        let Adapter: typeof RsyncAdapter;
        beforeEach(async () => {
            vi.resetModules();
            ({ RsyncAdapter: Adapter } = await import("@/lib/adapters/storage/rsync"));
        });

        function rsyncVersion(output: string) {
            mockExecCb.mockImplementation((cmd: unknown, ...rest: unknown[]) => {
                const cb = rest[rest.length - 1] as (err: Error | null, result?: { stdout: string }) => void;
                if (String(cmd).includes("--version")) return cb(null, { stdout: output });
                if (String(cmd).includes("which sshpass")) return cb(null, { stdout: "/usr/bin/sshpass" });
                cb(null, { stdout: "" });
            });
        }

        function infoFlagUsed(): boolean {
            return mockRsyncSet.mock.calls.some((c) => c[0] === "info" && c[1] === "progress2");
        }

        it("asks for aggregate progress where rsync understands it", async () => {
            rsyncVersion("rsync  version 3.2.7  protocol version 31");
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncSucceeds();

            await Adapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            expect(infoFlagUsed()).toBe(true);
        });

        it("leaves it out for openrsync, which aborts on an option it does not know", async () => {
            // Apple made openrsync the default `rsync` in macOS 15. It reports itself as "2.6.9
            // compatible" and refuses --info=progress2 outright, failing the whole collection -
            // so the flag has to be asked for, not assumed.
            rsyncVersion("openrsync: protocol version 29\nrsync version 2.6.9 compatible");
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncSucceeds();

            await Adapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            expect(infoFlagUsed()).toBe(false);
        });

        it("leaves it out for openrsync even when it claims a newer compatibility", async () => {
            // The guard for the version check: openrsync states which rsync it is compatible
            // *with*, and that claim has moved up over time. It still does not implement the
            // flag, so the name is what decides - not the number next to it.
            rsyncVersion("openrsync: protocol version 29\nrsync version 3.2.7 compatible");
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncSucceeds();

            await Adapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            expect(infoFlagUsed()).toBe(false);
        });

        it("leaves it out for an rsync older than 3.1", async () => {
            rsyncVersion("rsync  version 2.6.9  protocol version 29");
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncSucceeds();

            await Adapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            expect(infoFlagUsed()).toBe(false);
        });

        it("leaves it out when the version cannot be read at all", async () => {
            // An unreadable probe must not cost the transfer: the older behaviour works everywhere.
            mockExecCb.mockImplementation((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: Error) => void;
                cb(new Error("rsync: not found"));
            });
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncSucceeds();

            await Adapter.downloadDirectory!(agentConfig, "Job", "/local/job");

            expect(infoFlagUsed()).toBe(false);
        });
    });

    // ===== rsync output handling =====

    describe("downloadDirectory() logging and progress", () => {
        /** Feeds rsync's stdout/stderr the way the real process does: in chunks, not lines. */
        function rsyncEmits(stdout: string[], stderr: string[] = []) {
            mockRsyncExecute.mockImplementation((
                done: (err: null, code: number, cmd: string) => void,
                onOut: (b: Buffer) => void,
                onErr: (b: Buffer) => void
            ) => {
                for (const chunk of stdout) onOut(Buffer.from(chunk));
                for (const chunk of stderr) onErr(Buffer.from(chunk));
                done(null, 0, "rsync ...");
            });
        }

        it("keeps rsync's per-file narration out of the execution log", async () => {
            // Execution logs live as one JSON string on the run, so a line per file lands in the
            // database on every backup - thousands of them for a real source, burying the events
            // that matter. The transfer is summarised instead.
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncEmits([
                "Java/rt.jar\n     51656928 100%   17.29MB/s    0:00:02 (xfer#99, to-check=102/132)\n",
                "Java/sax2.jar\n        33188 100%    9.03MB/s    0:00:00 (xfer#101, to-check=104/132)\n",
            ]);
            const onLog = vi.fn();

            await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job", undefined, undefined, onLog);

            const messages = onLog.mock.calls.map((c) => String(c[0]));
            expect(messages.some((m) => m.includes("Java/rt.jar"))).toBe(false);
            expect(messages.some((m) => m.includes("to-check="))).toBe(false);
            expect(messages.some((m) => m.includes("125 file(s)") || m.includes("file(s),"))).toBe(true);
        });

        it("still reports what rsync sends to stderr", async () => {
            // The guard for the test above: silencing the narration must not silence a refusal.
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncEmits(["Java/rt.jar\n"], ["some files vanished before they could be transferred\n"]);
            const onLog = vi.fn();

            await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job", undefined, undefined, onLog);

            const warnings = onLog.mock.calls.filter((c) => c[1] === "warning").map((c) => String(c[0]));
            expect(warnings.some((m) => m.includes("vanished"))).toBe(true);
        });

        it("reports each stderr line separately rather than as one blob", async () => {
            // stderr is what survives the filter now, so it is worth reading. rsync writes it in
            // chunks, and two refusals arriving together would otherwise become one entry whose
            // second half is easy to miss.
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncEmits([], ["some files vanished before they could be transferred\nrsync: chgrp failed\n"]);
            const onLog = vi.fn();

            await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job", undefined, undefined, onLog);

            const warnings = onLog.mock.calls.filter((c) => c[1] === "warning").map((c) => String(c[0]));
            expect(warnings.some((m) => m.includes("vanished") && !m.includes("chgrp"))).toBe(true);
            expect(warnings.some((m) => m.includes("chgrp") && !m.includes("vanished"))).toBe(true);
        });

        it("reads progress from both rsync dialects", async () => {
            // `to-chk` comes from rsync 3's --info=progress2, `to-check` from the 2.6.9 format
            // that openrsync also speaks - and a chunk can carry the filename and the figures
            // together, which a line-anchored parse would miss.
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncEmits([
                "Java/rt.jar\n     51656928 100%   17.29MB/s    0:00:02 (xfer#99, to-check=102/132)\n",
                " 1,234,567  45%   12.34MB/s    0:00:05 (xfr#12, to-chk=34/56)\n",
            ]);
            const onProgress = vi.fn();

            await RsyncAdapter.downloadDirectory!(agentConfig, "Job", "/local/job", undefined, onProgress);

            const byteValues = onProgress.mock.calls.map((c) => c[0]);
            expect(byteValues).toContain(51656928);
            expect(byteValues).toContain(1234567);
        });
    });

    // ===== transfer flags =====

    describe("transfer flags", () => {
        it("does not compress in transit", async () => {
            // `-z` costs CPU on both ends and changes nothing about what is stored: each archive
            // entry is compressed in the packing stage afterwards, so it is the same work twice.
            // It only pays off on compressible data, and a backup source is mostly the opposite.
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncSucceeds();

            await RsyncAdapter.upload!(agentConfig, "/tmp/a", "Job/a");

            const flags = mockRsyncFlags.mock.calls.map((c) => String(c[0]));
            expect(flags).toContain("a");
            expect(flags.some((f) => f.includes("z"))).toBe(false);
        });

        it("still lets a connection ask for compression explicitly", async () => {
            // The guard for the test above: dropping it from the defaults must not put it out of
            // reach, because on a slow link with compressible data it genuinely helps.
            sshSucceeds("/backups/Job/a.txt\t100\t1700000000.0\n");
            rsyncSucceeds();

            await RsyncAdapter.upload!({ ...agentConfig, options: "-z" }, "/tmp/a", "Job/a");

            expect(mockRsyncFlags.mock.calls.map((c) => String(c[0]))).toContain("z");
        });
    });




});
