import { describe, it, expect, vi, beforeEach } from "vitest";
import { SFTPAdapter } from "@/lib/adapters/storage/sftp";

// --- Hoisted mocks ---
const { mockSftpConnect, mockSftpEnd, mockSftpPut, mockSftpGet, mockSftpFastGet, mockSftpFastPut, mockSftpList, mockSftpExists, mockSftpMkdir, mockSftpDelete, mockSftpStat, mockSftpCwd, mockFsStat } = vi.hoisted(() => ({
    mockSftpConnect: vi.fn(),
    mockSftpEnd: vi.fn().mockResolvedValue(undefined),
    mockSftpPut: vi.fn().mockResolvedValue(undefined),
    mockSftpGet: vi.fn().mockResolvedValue(undefined),
    mockSftpFastGet: vi.fn().mockResolvedValue(undefined),
    mockSftpList: vi.fn(),
    mockSftpExists: vi.fn(),
    mockSftpMkdir: vi.fn().mockResolvedValue(undefined),
    mockSftpDelete: vi.fn().mockResolvedValue(undefined),
    mockSftpStat: vi.fn(),
    mockSftpCwd: vi.fn(),
    mockSftpFastPut: vi.fn().mockResolvedValue(undefined),
    mockFsStat: vi.fn().mockResolvedValue({ size: 1024 }),
}));

vi.mock("ssh2-sftp-client", () => {
    class MockSFTPClient {
        connect = mockSftpConnect;
        end = mockSftpEnd;
        put = mockSftpPut;
        get = mockSftpGet;
        fastGet = mockSftpFastGet;
        list = mockSftpList;
        exists = mockSftpExists;
        mkdir = mockSftpMkdir;
        delete = mockSftpDelete;
        stat = mockSftpStat;
        cwd = mockSftpCwd;
        fastPut = mockSftpFastPut;
    }
    return { default: MockSFTPClient };
});

vi.mock("fs", () => ({
    createReadStream: vi.fn(() => ({ pipe: vi.fn(), destroy: vi.fn() })),
    default: {
        createReadStream: vi.fn(() => ({ pipe: vi.fn(), destroy: vi.fn() })),
    },
    promises: {
        stat: mockFsStat,
    },
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

// --- Base config ---
const config = {
    host: "sftp.example.com",
    port: 22,
    username: "backupuser",
    password: "secret",
    pathPrefix: "/backups",
};

describe("SFTPAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSftpConnect.mockResolvedValue(undefined);
        mockSftpEnd.mockResolvedValue(undefined);
        mockSftpPut.mockResolvedValue(undefined);
        mockSftpDelete.mockResolvedValue(undefined);
        mockSftpMkdir.mockResolvedValue(undefined);
        mockSftpExists.mockResolvedValue("d");
        mockSftpCwd.mockResolvedValue("/");
        mockSftpFastPut.mockResolvedValue(undefined);
        mockSftpFastGet.mockResolvedValue(undefined);
        mockFsStat.mockResolvedValue({ size: 1024 });
    });

    // ===== upload() =====

    describe("upload()", () => {
        it("returns true on successful upload", async () => {
            mockSftpExists.mockResolvedValue("d"); // dir exists

            const result = await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockSftpFastPut).toHaveBeenCalled();
            expect(mockSftpEnd).toHaveBeenCalled();
        });

        it("creates remote directory when it does not exist", async () => {
            // The configured path exists, the job folder below it does not.
            mockSftpExists.mockImplementation(async (p: string) => (p === '/backups' ? 'd' : false));
            mockSftpMkdir.mockResolvedValue(undefined);
            mockSftpPut.mockResolvedValue(undefined);

            await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockSftpMkdir).toHaveBeenCalledWith('/backups/Job');
        });

        it("fails with the configured path when that path is unreachable", async () => {
            // Rather than climbing upwards and reporting a permission error on a path the
            // user never entered - which is what made the original failure so confusing.
            mockSftpExists.mockResolvedValue(false);
            mockSftpPut.mockResolvedValue(undefined);

            const ok = await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(ok).toBe(false);
            expect(mockSftpMkdir).not.toHaveBeenCalled();
        });

        it("returns false when connection fails", async () => {
            mockSftpConnect.mockRejectedValue(new Error("ECONNREFUSED"));

            const result = await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("returns false when the upload throws", async () => {
            mockSftpExists.mockResolvedValue("d");
            mockSftpFastPut.mockRejectedValue(new Error("Disk full"));

            const result = await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("always calls end() even on failure", async () => {
            mockSftpExists.mockResolvedValue("d");
            mockSftpFastPut.mockRejectedValue(new Error("Error"));

            await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockSftpEnd).toHaveBeenCalled();
        });

        it("keeps many requests in flight instead of one per round trip", async () => {
            // A stream put sends one WRITE and waits for the acknowledgement before the next,
            // which caps a transfer at one chunk per round trip - about 3 MB/s over a 20 ms path
            // however fast the link is. fastPut keeps `concurrency` chunks outstanding.
            mockSftpExists.mockResolvedValue("d");

            await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockSftpFastPut).toHaveBeenCalledWith(
                "/tmp/backup.sql",
                "/backups/Job/backup.sql",
                expect.objectContaining({ concurrency: 64, chunkSize: 32768 })
            );
            expect(mockSftpPut).not.toHaveBeenCalled();
        });

        it("survives two parallel transfers creating the same folder", async () => {
            // Restoring several files at once puts two of them in the same new folder: both see
            // it missing, both call mkdir, one loses. The server reports that as a permission
            // error, indistinguishable from a real one - which is how a single file out of 130
            // failed on a folder the other 129 wrote into.
            let created = false;
            mockSftpExists.mockImplementation(async (p: string) => {
                if (p === '/backups') return 'd';
                if (p === '/backups/Job') return created ? 'd' : false;
                return false;
            });
            mockSftpMkdir.mockImplementation(async () => {
                // The race partner won between our exists() and this call.
                created = true;
                throw new Error('permission denied');
            });

            const ok = await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(ok).toBe(true);
            expect(mockSftpFastPut).toHaveBeenCalled();
        });

        it("still reports a genuine failure to create a folder", async () => {
            // The mutation guard for the test above: swallowing every mkdir error would turn a
            // real rights problem into an upload that silently writes nowhere.
            mockSftpExists.mockImplementation(async (p: string) => (p === '/backups' ? 'd' : false));
            mockSftpMkdir.mockRejectedValue(new Error('permission denied'));

            const ok = await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(ok).toBe(false);
        });

        it("logs connection and start messages", async () => {
            mockSftpExists.mockResolvedValue("d");
            mockSftpPut.mockResolvedValue(undefined);
            const onLog = vi.fn();

            await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", undefined, onLog);

            expect(onLog).toHaveBeenCalledWith(expect.stringContaining("sftp.example.com"), "info", "storage");
        });
    });

    // ===== openSession() connection reuse =====

    describe("openSession() pooling", () => {
        it("transfers many files over the connections it was allowed, not one per file", async () => {
            // The point of the session: 130 files used to mean 130 handshakes, which is slow and
            // is what makes an SSH server start refusing connections mid-backup.
            mockSftpExists.mockResolvedValue("d");
            const session = await SFTPAdapter.openSession!(config, undefined, { concurrency: 4 });

            await Promise.all(Array.from({ length: 30 }, (_, i) =>
                session.upload(`/tmp/f${i}`, `Job/f${i}`)));
            await session.close();

            expect(mockSftpConnect.mock.calls.length).toBeLessThanOrEqual(4);
            expect(mockSftpFastPut).toHaveBeenCalledTimes(30);
        });

        it("serves downloads over the same connections as uploads", async () => {
            // Backup collection reads through the session too - without that, a file backup from
            // an SFTP source still paid a handshake per file even though the session existed.
            const session = await SFTPAdapter.openSession!(config, undefined, { concurrency: 2 });

            await Promise.all(Array.from({ length: 10 }, (_, i) =>
                session.download!(`Job/f${i}`, `/tmp/f${i}`)));
            await session.close();

            expect(mockSftpConnect.mock.calls.length).toBeLessThanOrEqual(2);
            expect(mockSftpFastGet).toHaveBeenCalledTimes(10);
        });

        it("opens a single connection when no concurrency is requested", async () => {
            mockSftpExists.mockResolvedValue("d");
            const session = await SFTPAdapter.openSession!(config);

            await session.upload("/tmp/a", "Job/a");
            await session.upload("/tmp/b", "Job/b");
            await session.close();

            expect(mockSftpConnect).toHaveBeenCalledTimes(1);
        });

        it("checks a directory once for the whole session rather than once per file", async () => {
            // The directory cache is shared across the pool because which folders exist is a
            // property of the server, not of the connection that asked.
            mockSftpExists.mockResolvedValue("d");
            const session = await SFTPAdapter.openSession!(config, undefined, { concurrency: 4 });

            for (let i = 0; i < 5; i++) await session.upload(`/tmp/f${i}`, `Job/f${i}`);
            await session.close();

            expect(mockSftpExists).toHaveBeenCalledTimes(1);
        });

        it("closes every connection it opened", async () => {
            mockSftpExists.mockResolvedValue("d");
            const session = await SFTPAdapter.openSession!(config, undefined, { concurrency: 3 });

            await Promise.all(Array.from({ length: 9 }, (_, i) => session.upload(`/tmp/f${i}`, `Job/f${i}`)));
            const opened = mockSftpConnect.mock.calls.length;
            await session.close();

            expect(mockSftpEnd).toHaveBeenCalledTimes(opened);
        });
    });

    // ===== download() =====

    describe("download()", () => {
        it("returns true on successful download (no progress)", async () => {
            const result = await SFTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(true);
            expect(mockSftpFastGet).toHaveBeenCalled();
        });

        it("returns false when the download throws", async () => {
            mockSftpFastGet.mockRejectedValue(new Error("No such file"));

            const result = await SFTPAdapter.download(config, "Job/missing.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });

        it("uses the pipelined transfer even when nobody watches progress", async () => {
            // Which transfer algorithm runs must not depend on whether a caller passed a
            // callback. Directory collection reports progress per file, not per byte, and passes
            // none - which put every file of a file backup on the slow single-request path.
            await SFTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(mockSftpFastGet).toHaveBeenCalledWith(
                "/backups/Job/backup.sql",
                "/tmp/out.sql",
                expect.objectContaining({ concurrency: 64, chunkSize: 32768 })
            );
            expect(mockSftpGet).not.toHaveBeenCalled();
        });

        it("does not stat the file when no progress is reported", async () => {
            // The size is only needed to turn bytes into a percentage - fetching it regardless
            // would spend a round trip per file on a number nobody reads.
            await SFTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(mockSftpStat).not.toHaveBeenCalled();
        });

        it("uses fastGet when onProgress is provided", async () => {
            mockSftpStat.mockResolvedValue({ size: 2048 });
            mockSftpFastGet.mockResolvedValue(undefined);

            const onProgress = vi.fn();
            const result = await SFTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            expect(result).toBe(true);
            expect(mockSftpFastGet).toHaveBeenCalled();
        });
    });

    // ===== list() =====

    describe("list()", () => {
        it("returns files from directory walk", async () => {
            mockSftpExists.mockResolvedValue("d");
            mockSftpList.mockResolvedValue([
                { name: "backup.sql", type: "-", size: 1024, modifyTime: Date.now() },
            ]);

            const result = await SFTPAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
        });

        it("returns empty array when directory does not exist", async () => {
            mockSftpExists.mockResolvedValue(false);

            const result = await SFTPAdapter.list(config, "NonExistent");

            expect(result).toEqual([]);
        });

        it("throws on connection error", async () => {
            mockSftpConnect.mockRejectedValue(new Error("Auth failed"));

            await expect(SFTPAdapter.list(config, "Job")).rejects.toThrow("Auth failed");
        });

        it("recurses into subdirectories", async () => {
            mockSftpExists.mockResolvedValue("d");
            mockSftpList
                .mockResolvedValueOnce([
                    { name: "subdir", type: "d", size: 0, modifyTime: Date.now() },
                ])
                .mockResolvedValueOnce([
                    { name: "nested.sql", type: "-", size: 512, modifyTime: Date.now() },
                ]);

            const result = await SFTPAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("nested.sql");
        });

        it("strips pathPrefix from returned paths", async () => {
            mockSftpExists.mockResolvedValue("d");
            mockSftpList.mockResolvedValue([
                { name: "backup.sql", type: "-", size: 100, modifyTime: Date.now() },
            ]);

            const result = await SFTPAdapter.list(config, "Job");

            // path should be relative to pathPrefix, not including /backups
            expect(result[0].path).not.toContain("/backups");
        });

        it("strips a prefix typed with a double slash, a dot or a slash at the end, so a view finds the folder of the customers", async () => {
            for (const pathPrefix of ["/srv//backups/", "/srv/./backups", "/srv/backups/"]) {
                mockSftpExists.mockResolvedValue("d");
                mockSftpList
                    .mockResolvedValueOnce([{ name: "tenants", type: "d", size: 0, modifyTime: Date.now() }])
                    .mockResolvedValueOnce([{ name: "acme", type: "d", size: 0, modifyTime: Date.now() }])
                    .mockResolvedValueOnce([{ name: "shop.tar", type: "-", size: 10, modifyTime: Date.now() }]);

                const result = await SFTPAdapter.list({ ...config, pathPrefix }, "");

                expect(result.map((file) => file.path), pathPrefix).toEqual(["tenants/acme/shop.tar"]);
            }
        });
    });

    // ===== delete() =====

    describe("delete()", () => {
        it("returns true on successful delete", async () => {
            mockSftpDelete.mockResolvedValue(undefined);

            const result = await SFTPAdapter.delete(config, "Job/backup.sql");

            expect(result).toBe(true);
        });

        it("returns false when delete() throws", async () => {
            mockSftpDelete.mockRejectedValue(new Error("Permission denied"));

            const result = await SFTPAdapter.delete(config, "Job/backup.sql");

            expect(result).toBe(false);
        });
    });

    // ===== test() =====

    describe("test()", () => {
        it("returns success when connect succeeds", async () => {
            const result = await SFTPAdapter.test!(config);

            expect(result.success).toBe(true);
            expect(mockSftpEnd).toHaveBeenCalled();
        });

        it("returns failure when connection throws", async () => {
            mockSftpConnect.mockRejectedValue(new Error("Host unreachable"));

            const result = await SFTPAdapter.test!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Host unreachable");
        });

        it("creates only the directories below the configured path", async () => {
            // The configured path exists; everything under it does not yet.
            mockSftpExists.mockImplementation(async (p: string) => (p === '/backups' ? 'd' : false));

            const result = await SFTPAdapter.test!(config);

            expect(result.success).toBe(true);
            // Segment by segment, never the prefix itself and never a recursive walk that
            // could climb above it.
            expect(mockSftpMkdir).toHaveBeenCalledWith('/backups/.dbackup');
            expect(mockSftpMkdir).toHaveBeenCalledWith('/backups/.dbackup/test');
            const targets = mockSftpMkdir.mock.calls.map((c) => c[0] as string);
            expect(targets).not.toContain('/backups');
            expect(targets.every((t) => t.startsWith('/backups/'))).toBe(true);
        });

        it("never tries to create anything above the configured path", async () => {
            // The case from a NAS: the account may write inside its share but cannot stat the
            // volume above it, so exists() says false for everything. The library's recursive
            // mkdir climbed to the root and failed with "Permission denied /volume1" - a path
            // the user never configured. It must report the configured path instead.
            const nasConfig = { ...config, pathPrefix: '/volume1/Transfer/restore' };
            mockSftpExists.mockResolvedValue(false);

            const result = await SFTPAdapter.test!(nasConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain('/volume1/Transfer/restore');
            expect(mockSftpMkdir).not.toHaveBeenCalled();
        });

        it("names the exact segment of the path that stops being reachable", async () => {
            // "Path not reachable" cannot be acted on. Knowing that the share is visible but the
            // folder inside it is not turns it into a permissions fix on one specific folder.
            mockSftpExists.mockImplementation(async (p: string) => (p === '/volume1' || p === '/volume1/Transfer' ? 'd' : false));

            const result = await SFTPAdapter.test!({ ...config, pathPrefix: '/volume1/Transfer/restore' });

            expect(result.message).toContain('"/volume1/Transfer" is reachable');
            expect(result.message).toContain('"/volume1/Transfer/restore" inside it is not');
        });

        it("names the corrected path when SFTP is confined below the filesystem root", async () => {
            // The Synology case: SFTP shows /volume1 as "/", so a path written from the real
            // filesystem's point of view carries a segment that cannot exist inside it. Both
            // halves are known here, so the fix is computed rather than left as a deduction.
            mockSftpExists.mockResolvedValue(false);
            mockSftpCwd.mockResolvedValue('/');
            mockSftpList.mockResolvedValue([
                { name: 'Transfer', type: 'd' },
                { name: 'homes', type: 'd' },
            ]);

            // Only the rewritten path resolves - the configured one is what failed.
            mockSftpExists.mockImplementation(async (p: string) => (p === '/Transfer/restore' ? 'd' : false));

            const result = await SFTPAdapter.test!({ ...config, pathPrefix: '/volume1/Transfer/restore' });

            expect(result.message).toContain('Use "/Transfer/restore" as the path instead');
        });

        it("keeps as much of the configured path as possible when suggesting", async () => {
            // The outermost match wins. Matching the innermost segment would suggest "/restore"
            // and silently drop a level the user does want.
            mockSftpCwd.mockResolvedValue('/');
            mockSftpList.mockResolvedValue([
                { name: 'Transfer', type: 'd' },
                { name: 'restore', type: 'd' },
            ]);
            // Both rewrites resolve, so only the preference decides which one is offered.
            mockSftpExists.mockImplementation(async (p: string) =>
                (p === '/Transfer/restore' || p === '/restore' ? 'd' : false));

            const result = await SFTPAdapter.test!({ ...config, pathPrefix: '/volume1/Transfer/restore' });

            expect(result.message).toContain('Use "/Transfer/restore" as the path instead');
        });

        it("does not offer a rewritten path that the server does not have either", async () => {
            // A folder name can line up by coincidence. Offering an unverified guess would send
            // the user to a path that fails exactly the same way, so it is checked first.
            mockSftpExists.mockResolvedValue(false);
            mockSftpCwd.mockResolvedValue('/');
            mockSftpList.mockResolvedValue([{ name: 'Transfer', type: 'd' }]);

            const result = await SFTPAdapter.test!({ ...config, pathPrefix: '/volume1/Transfer/restore' });

            expect(result.message).not.toMatch(/as the path instead/);
            // Falls back to the listing, which is the most useful thing left to offer.
            expect(result.message).toContain('starts at "/"');
        });

        it("suggests nothing when the path's own first segment is the visible one", async () => {
            // Then the path is already written from the right root and the cause is elsewhere -
            // proposing the identical path back would be noise dressed up as a fix.
            mockSftpExists.mockResolvedValue(false);
            mockSftpCwd.mockResolvedValue('/');
            mockSftpList.mockResolvedValue([{ name: 'Transfer', type: 'd' }]);

            const result = await SFTPAdapter.test!({ ...config, pathPrefix: '/Transfer/restore' });

            expect(result.message).not.toMatch(/as the path instead/);
        });

        it("falls back to listing what the account can see when nothing matches", async () => {
            // No overlap between the path and the visible folders means there is nothing to
            // compute - the listing is then the most useful thing left to offer.
            mockSftpExists.mockResolvedValue(false);
            mockSftpCwd.mockResolvedValue('/homes/backupuser');
            mockSftpList.mockResolvedValue([
                { name: 'Documents', type: 'd' },
                { name: 'notes.txt', type: '-' },
            ]);

            const result = await SFTPAdapter.test!({ ...config, pathPrefix: '/volume1/Transfer' });

            expect(result.message).toContain('starts at "/homes/backupuser"');
            expect(result.message).toContain('Documents');
            // Files are noise here - only folders can be a path prefix.
            expect(result.message).not.toContain('notes.txt');
            expect(result.message).toMatch(/relative to it/i);
        });

        it("says how many folders it left out rather than looking complete", async () => {
            // A capped list that does not admit to being capped is worse than no list: a folder
            // below the cut-off looks like a folder that does not exist, which sends the user
            // looking for the wrong problem.
            mockSftpExists.mockResolvedValue(false);
            mockSftpCwd.mockResolvedValue('/');
            mockSftpList.mockResolvedValue(
                Array.from({ length: 15 }, (_, i) => ({ name: `folder${i}`, type: 'd' }))
            );

            const result = await SFTPAdapter.test!({ ...config, pathPrefix: '/volume1/Transfer' });

            expect(result.message).toContain('(and 3 more)');
        });

        it("still reports the configured path when the server refuses every diagnostic probe", async () => {
            // A locked-down server may answer neither cwd nor list. The primary message has to
            // survive that - a diagnostic failure must never replace the actual error.
            mockSftpExists.mockResolvedValue(false);
            mockSftpCwd.mockRejectedValue(new Error('permission denied'));
            mockSftpList.mockRejectedValue(new Error('permission denied'));

            const result = await SFTPAdapter.test!({ ...config, pathPrefix: '/volume1/Transfer' });

            expect(result.success).toBe(false);
            expect(result.message).toContain('/volume1/Transfer');
        });
    });

    // ===== download() fastGet step callback =====

    describe("download() fastGet step callback", () => {
        it("reports transferred and total bytes from the transfer itself", async () => {
            let stepCb: ((transferred: number, chunk: number, total: number) => void) | undefined;
            mockSftpFastGet.mockImplementation((_src: unknown, _dst: unknown, opts: { step?: (t: number, c: number, total: number) => void }) => {
                stepCb = opts?.step;
                return Promise.resolve(undefined);
            });

            const onProgress = vi.fn();
            await SFTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            stepCb?.(1024, 512, 2048);
            expect(onProgress).toHaveBeenCalledWith(1024, 2048);
        });

        it("does not stat the file just to learn its size", async () => {
            mockSftpFastGet.mockResolvedValue(undefined);

            await SFTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", vi.fn());

            // One stat per file is a full round trip on the adapter where round trips are the
            // bottleneck, and the size already arrives with the transfer.
            expect(mockSftpStat).not.toHaveBeenCalled();
        });
    });

    // ===== read() non-Buffer result =====

    describe("read() non-Buffer result", () => {
        it("returns null when sftp.get() returns non-Buffer value", async () => {
            mockSftpGet.mockResolvedValue(null);

            const result = await SFTPAdapter.read!(config, "Job/meta.json");

            expect(result).toBeNull();
        });

        it("returns null when sftp.get() throws", async () => {
            mockSftpGet.mockRejectedValue(new Error("File not found"));

            const result = await SFTPAdapter.read!(config, "Job/missing.meta.json");

            expect(result).toBeNull();
        });

        it("works without pathPrefix (uses remotePath directly)", async () => {
            const noPrefix = { ...config, pathPrefix: undefined };
            mockSftpGet.mockResolvedValue(Buffer.from("content"));

            const result = await SFTPAdapter.read!(noPrefix, "backup.meta.json");

            expect(result).toBe("content");
        });
    });

    // ====================================================================
    // upload() step callback progress (lines 76-80)
    // ====================================================================
    describe("upload() step callback progress", () => {
        it("invokes onProgress via the upload step callback when totalSize > 0", async () => {
            mockSftpExists.mockResolvedValue("d");

            let stepCb: ((transferred: number, chunk: unknown, total: number) => void) | undefined;
            mockSftpFastPut.mockImplementation((_src: unknown, _dst: unknown, opts: any) => {
                stepCb = opts?.step;
                return Promise.resolve(undefined);
            });

            const onProgress = vi.fn();
            await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", onProgress);

            // Simulate data transfer: 1024 of 2048 bytes transferred
            stepCb?.(1024, null, 2048);

            expect(onProgress).toHaveBeenCalledWith(50); // 1024/2048 * 100 = 50
        });

        it("does not call onProgress when totalSize is 0", async () => {
            mockSftpExists.mockResolvedValue("d");
            mockFsStat.mockResolvedValue({ size: 0 });

            let stepCb: ((transferred: number, chunk: unknown, total: number) => void) | undefined;
            mockSftpPut.mockImplementation((_src: unknown, _dst: unknown, opts: any) => {
                stepCb = opts?.step;
                return Promise.resolve(undefined);
            });

            const onProgress = vi.fn();
            await SFTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", onProgress);

            stepCb?.(0, null, 0);

            // totalSize = 0 → step callback guard: if (totalSize > 0) is false → no call
            expect(onProgress).not.toHaveBeenCalled();
        });
    });
});
