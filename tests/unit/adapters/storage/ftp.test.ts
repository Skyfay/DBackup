import { describe, it, expect, vi, beforeEach } from "vitest";
import { FTPAdapter } from "@/lib/adapters/storage/ftp";

// --- Hoisted mocks ---
const { mockAccess, mockClose, mockUploadFrom, mockDownloadTo, mockList, mockRemove, mockSize, mockEnsureDir, mockCd, mockTrackProgress, mockConstructed, MockFTPError } = vi.hoisted(() => ({
    // basic-ftp's FTPError, a refusal of the server that carries its reply code.
    MockFTPError: class extends Error {
        constructor(public code: number, message: string) {
            super(message);
            this.name = "FTPError";
        }
    },
    mockAccess: vi.fn(),
    mockClose: vi.fn(),
    mockUploadFrom: vi.fn().mockResolvedValue(undefined),
    mockDownloadTo: vi.fn().mockResolvedValue(undefined),
    mockList: vi.fn(),
    mockRemove: vi.fn().mockResolvedValue(undefined),
    mockSize: vi.fn().mockResolvedValue(1024),
    mockEnsureDir: vi.fn().mockResolvedValue(undefined),
    mockCd: vi.fn().mockResolvedValue(undefined),
    mockTrackProgress: vi.fn(),
    mockConstructed: [] as { closed: boolean }[],
}));

vi.mock("basic-ftp", () => {
    class MockClient {
        // basic-ftp's Client refuses a second operation while one is in flight; the pool has to
        // hand every parallel transfer its own instance, so the test counts instances.
        closed = false;
        constructor() { mockConstructed.push(this); }
        ftp = { verbose: false };
        access = mockAccess;
        close = mockClose;
        uploadFrom = mockUploadFrom;
        downloadTo = mockDownloadTo;
        list = mockList;
        remove = mockRemove;
        size = mockSize;
        ensureDir = mockEnsureDir;
        cd = mockCd;
        trackProgress = mockTrackProgress;
    }
    return { Client: MockClient, FTPError: MockFTPError };
});

vi.mock("fs", () => ({
    createReadStream: vi.fn(() => ({ pipe: vi.fn(), destroy: vi.fn() })),
    createWriteStream: vi.fn(() => ({ on: vi.fn(), end: vi.fn() })),
    default: {
        createReadStream: vi.fn(() => ({ pipe: vi.fn(), destroy: vi.fn() })),
        createWriteStream: vi.fn(() => ({ on: vi.fn(), end: vi.fn() })),
    },
}));

vi.mock("fs/promises", () => ({
    default: {
        stat: vi.fn().mockResolvedValue({ size: 1024 }),
        readFile: vi.fn().mockResolvedValue("file content"),
        unlink: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
    },
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
    readFile: vi.fn().mockResolvedValue("file content"),
    unlink: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
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
    host: "ftp.example.com",
    port: 21,
    username: "ftpuser",
    password: "secret",
    tls: false,
    pathPrefix: "/backups",
};

describe("FTPAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAccess.mockResolvedValue(undefined);
        mockClose.mockReturnValue(undefined);
        mockUploadFrom.mockResolvedValue(undefined);
        mockDownloadTo.mockResolvedValue(undefined);
        mockRemove.mockResolvedValue(undefined);
        mockSize.mockResolvedValue(1024);
        mockEnsureDir.mockResolvedValue(undefined);
        mockCd.mockResolvedValue(undefined);
        mockTrackProgress.mockReturnValue(undefined);
        mockConstructed.length = 0;
    });

    // ===== openSession() =====

    describe("openSession() pooling", () => {
        it("never runs two transfers through one client", async () => {
            // basic-ftp's Client holds a single control connection and rejects a second operation
            // while one is in flight with "User launched a task while another one is still
            // running". That is not a recoverable error: it closes the client, so one collision
            // takes every other transfer queued behind it down as well - which is how a restore
            // ended up with 112 of 129 files failing.
            const inUse = new Set<unknown>();
            let overlapped = false;
            // `this` is the client the call actually ran on, which is the whole question here.
            mockUploadFrom.mockImplementation(async function (this: unknown) {
                if (inUse.has(this)) overlapped = true;
                inUse.add(this);
                await new Promise((r) => setTimeout(r, 5));
                inUse.delete(this);
            });

            const session = await FTPAdapter.openSession!(config, undefined, { concurrency: 3 });
            const results = await Promise.all(
                Array.from({ length: 9 }, (_, i) => session.upload(`/tmp/f${i}`, `Job/f${i}`))
            );
            await session.close();

            expect(results.every(Boolean)).toBe(true);
            expect(overlapped).toBe(false);
            expect(mockConstructed.length).toBeLessThanOrEqual(3);
        });

        it("opens a single client when no concurrency is requested", async () => {
            const session = await FTPAdapter.openSession!(config);

            await session.upload("/tmp/a", "Job/a");
            await session.upload("/tmp/b", "Job/b");
            await session.close();

            expect(mockConstructed.length).toBe(1);
        });

        it("serves downloads over the session's clients too", async () => {
            const session = await FTPAdapter.openSession!(config, undefined, { concurrency: 2 });

            await Promise.all([
                session.download!("Job/a", "/tmp/a"),
                session.download!("Job/b", "/tmp/b"),
            ]);
            await session.close();

            expect(mockDownloadTo).toHaveBeenCalledTimes(2);
            expect(mockConstructed.length).toBeLessThanOrEqual(2);
        });

        it("closes every client it opened", async () => {
            const session = await FTPAdapter.openSession!(config, undefined, { concurrency: 2 });

            await Promise.all([session.upload("/tmp/a", "Job/a"), session.upload("/tmp/b", "Job/b")]);
            const opened = mockConstructed.length;
            await session.close();

            expect(mockClose).toHaveBeenCalledTimes(opened);
        });
    });

    // ===== upload() =====

    describe("upload()", () => {
        it("returns true on successful upload", async () => {
            const result = await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockUploadFrom).toHaveBeenCalled();
            expect(mockClose).toHaveBeenCalled();
        });

        it("calls cd('/') after ensureDir to reset CWD", async () => {
            await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockCd).toHaveBeenCalledWith("/");
        });

        it("returns false when connect fails", async () => {
            mockAccess.mockRejectedValue(new Error("Connection refused"));

            const result = await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("returns false when uploadFrom throws", async () => {
            mockUploadFrom.mockRejectedValue(new Error("Disk full"));

            const result = await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("always calls close() even on failure", async () => {
            mockUploadFrom.mockRejectedValue(new Error("Error"));

            await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockClose).toHaveBeenCalled();
        });

        it("calls onLog with connection info", async () => {
            const onLog = vi.fn();

            await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", undefined, onLog);

            expect(onLog).toHaveBeenCalledWith(expect.stringContaining("ftp.example.com"), "info", "storage");
        });
    });

    // ===== download() =====

    describe("download()", () => {
        it("returns true on successful download", async () => {
            const result = await FTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(true);
            expect(mockDownloadTo).toHaveBeenCalled();
        });

        it("returns false when downloadTo throws", async () => {
            mockDownloadTo.mockRejectedValue(new Error("550 File not found"));

            const result = await FTPAdapter.download(config, "Job/missing.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });

        it("always closes client", async () => {
            mockDownloadTo.mockRejectedValue(new Error("Error"));

            await FTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(mockClose).toHaveBeenCalled();
        });
    });

    // ===== list() =====

    describe("list()", () => {
        it("returns files from directory walk", async () => {
            mockList.mockResolvedValue([
                { name: "backup.sql", isFile: true, isDirectory: false, size: 1024, modifiedAt: new Date() },
            ]);

            const result = await FTPAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
        });

        it("recurses into subdirectories", async () => {
            mockList
                .mockResolvedValueOnce([
                    { name: "subdir", isFile: false, isDirectory: true, size: 0, modifiedAt: new Date() },
                ])
                .mockResolvedValueOnce([
                    { name: "nested.sql", isFile: true, isDirectory: false, size: 512, modifiedAt: new Date() },
                ]);

            const result = await FTPAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("nested.sql");
        });

        it("skips . and .. entries", async () => {
            mockList.mockResolvedValue([
                { name: ".", isFile: false, isDirectory: true, size: 0, modifiedAt: new Date() },
                { name: "..", isFile: false, isDirectory: true, size: 0, modifiedAt: new Date() },
                { name: "backup.sql", isFile: true, isDirectory: false, size: 100, modifiedAt: new Date() },
            ]);

            const result = await FTPAdapter.list(config, "Job");

            expect(result.map((f) => f.name)).not.toContain(".");
            expect(result.map((f) => f.name)).not.toContain("..");
            expect(result).toHaveLength(1);
        });

        it("throws on connection error", async () => {
            mockAccess.mockRejectedValue(new Error("Auth failed"));

            await expect(FTPAdapter.list(config, "Job")).rejects.toThrow("Auth failed");
        });

        it("throws when initial directory listing fails after connection", async () => {
            mockList.mockRejectedValue(new Error("550 Permission denied"));

            await expect(FTPAdapter.list(config, "Job")).rejects.toThrow("550 Permission denied");
        });
    });

    // ===== delete() =====

    describe("delete()", () => {
        it("returns true on successful delete", async () => {
            const result = await FTPAdapter.delete(config, "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockRemove).toHaveBeenCalled();
        });

        it("returns false when remove throws", async () => {
            mockRemove.mockRejectedValue(new Error("550 No such file"));

            const result = await FTPAdapter.delete(config, "Job/missing.sql");

            expect(result).toBe(false);
        });
    });

    // ===== read() =====

    describe("read()", () => {
        it("returns file content as string", async () => {
            const result = await FTPAdapter.read!(config, "Job/backup.sql.meta.json");

            expect(typeof result).toBe("string");
            expect(mockDownloadTo).toHaveBeenCalled();
        });

        it("returns null when download fails", async () => {
            mockDownloadTo.mockRejectedValue(new Error("File not found"));

            const result = await FTPAdapter.read!(config, "Job/missing.meta.json");

            expect(result).toBeNull();
        });
    });

    // ===== test() =====

    describe("test()", () => {
        it("returns success when write+delete succeed", async () => {
            const result = await FTPAdapter.test!(config);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successful");
        });

        it("returns failure when connection fails", async () => {
            mockAccess.mockRejectedValue(new Error("Connection refused"));

            const result = await FTPAdapter.test!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Connection refused");
        });
    });

    // ===== upload() progress tracking =====

    describe("upload() progress tracking", () => {
        it("invokes onProgress when trackProgress callback fires", async () => {
            let progressCb: ((info: { bytesOverall: number }) => void) | undefined;
            mockTrackProgress.mockImplementation((cb?: (info: { bytesOverall: number }) => void) => {
                if (cb) progressCb = cb;
            });

            const onProgress = vi.fn();
            await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", onProgress);

            // Simulate progress event
            progressCb?.({ bytesOverall: 512 });
            expect(onProgress).toHaveBeenCalledWith(50); // 512/1024 * 100 = 50
            expect(onProgress).toHaveBeenCalledWith(100); // final
        });
    });

    // ===== download() progress tracking =====

    describe("download() progress tracking", () => {
        it("invokes onProgress when download trackProgress callback fires", async () => {
            let progressCb: ((info: { bytesOverall: number }) => void) | undefined;
            mockTrackProgress.mockImplementation((cb?: (info: { bytesOverall: number }) => void) => {
                if (cb) progressCb = cb;
            });

            const onProgress = vi.fn();
            await FTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            progressCb?.({ bytesOverall: 256 });
            expect(onProgress).toHaveBeenCalledWith(256, 1024);
        });

        it("proceeds when client.size() throws (size not supported)", async () => {
            mockSize.mockRejectedValue(new Error("SIZE not implemented"));

            let progressCb: ((info: { bytesOverall: number }) => void) | undefined;
            mockTrackProgress.mockImplementation((cb?: (info: { bytesOverall: number }) => void) => {
                if (cb) progressCb = cb;
            });

            const onProgress = vi.fn();
            const result = await FTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            // After size fails, total=0, onProgress uses bytesOverall for both
            progressCb?.({ bytesOverall: 100 });
            expect(onProgress).toHaveBeenCalledWith(100, 100);
            expect(result).toBe(true);
        });
    });

    // ===== list() - a subfolder that is not there yet =====

    describe("list() of a subfolder nothing was written to yet", () => {
        it("lists it as empty when the server answers 550 and the folder cannot be entered either", async () => {
            mockList.mockRejectedValue(new MockFTPError(550, "550 /backups/tenants/t1: No such file or directory"));
            mockCd.mockRejectedValue(new MockFTPError(550, "550 Failed to change directory."));

            const result = await FTPAdapter.list(config, "tenants/t1");

            expect(result).toEqual([]);
            expect(mockCd).toHaveBeenCalledWith("/backups/tenants/t1");
        });

        it("lists it as empty on ProFTPD, which answers the LIST of a missing folder with 450", async () => {
            mockList.mockRejectedValue(new MockFTPError(450, "450 /backups/tenants/t1: No such file or directory"));
            mockCd.mockRejectedValue(new MockFTPError(550, "550 /backups/tenants/t1: No such file or directory"));

            await expect(FTPAdapter.list(config, "tenants/t1")).resolves.toEqual([]);
        });

        it("still fails when the folder is there and only its listing was refused", async () => {
            mockList.mockRejectedValue(new MockFTPError(550, "550 Permission denied"));
            mockCd.mockResolvedValue(undefined);

            await expect(FTPAdapter.list(config, "tenants/t1")).rejects.toThrow("550 Permission denied");
        });

        it("still fails when the folder cannot be entered for another reason than a missing folder", async () => {
            mockList.mockRejectedValue(new MockFTPError(550, "550 Requested action not taken"));
            mockCd.mockRejectedValue(new MockFTPError(421, "421 Service not available"));

            await expect(FTPAdapter.list(config, "tenants/t1")).rejects.toThrow("550 Requested action not taken");
        });

        it("still fails on a timeout, without asking the server about the folder", async () => {
            mockList.mockRejectedValue(new Error("Timeout (control socket)"));

            await expect(FTPAdapter.list(config, "tenants/t1")).rejects.toThrow("Timeout (control socket)");
            expect(mockCd).not.toHaveBeenCalled();
        });

        it("still fails a missing root, so the storage numbers keep their last values", async () => {
            mockList.mockRejectedValue(new MockFTPError(550, "550 /backups: No such file or directory"));
            mockCd.mockRejectedValue(new MockFTPError(550, "550 Failed to change directory."));

            await expect(FTPAdapter.list(config, "")).rejects.toThrow("550 /backups: No such file or directory");
            expect(mockCd).not.toHaveBeenCalled();
        });
    });

    // ===== list() - walk catch =====

    describe("list() walk error handling", () => {
        it("continues when list() throws for a subdirectory", async () => {
            mockList
                .mockResolvedValueOnce([
                    { name: "subdir", isFile: false, isDirectory: true, size: 0, modifiedAt: new Date() },
                ])
                .mockRejectedValueOnce(new Error("Subdirectory listing failed"));

            const result = await FTPAdapter.list(config, "Job");

            // walk catches the error and continues - result is empty but no throw
            expect(result).toEqual([]);
        });
    });

    // ===== resolvePath without pathPrefix (line 49) =====

    describe("resolvePath without pathPrefix", () => {
        it("uses remotePath directly when no pathPrefix is configured", async () => {
            const noPrefix = { ...config, pathPrefix: undefined };

            const result = await FTPAdapter.upload(noPrefix, "/tmp/backup.sql", "backup.sql");

            expect(result).toBe(true);
            expect(mockUploadFrom).toHaveBeenCalled();
        });

        it("list() works without pathPrefix", async () => {
            const noPrefix = { ...config, pathPrefix: undefined };
            mockList.mockResolvedValue([
                { name: "backup.sql", isFile: true, isDirectory: false, size: 512, modifiedAt: new Date() },
            ]);

            const result = await FTPAdapter.list(noPrefix, "");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
        });
    });
});
