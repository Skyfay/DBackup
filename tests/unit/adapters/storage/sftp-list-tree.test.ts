import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SFTPAdapter, endSftpClient, connectSFTP } from "@/lib/adapters/storage/sftp";
import { toRelativePath } from "@/lib/adapters/storage/common/download-directory";
import { resolveExcludePatterns } from "@/lib/exclude-groups";

const { mockSftpConnect, mockSftpEnd, mockSftpList, mockSftpExists, mockDestroy, rawSftpChannel } = vi.hoisted(() => ({
    mockSftpConnect: vi.fn().mockResolvedValue(undefined),
    mockSftpEnd: vi.fn().mockResolvedValue(undefined),
    mockSftpList: vi.fn(),
    mockSftpExists: vi.fn(),
    mockDestroy: vi.fn(),
    /** The raw ssh2 SFTP channel, which real connections expose and some do not. */
    rawSftpChannel: { current: undefined as unknown },
}));

vi.mock("ssh2-sftp-client", () => {
    class MockSFTPClient {
        connect = mockSftpConnect;
        end = mockSftpEnd;
        list = mockSftpList;
        exists = mockSftpExists;
        // The raw ssh2 client the wrapper holds - what endSftpClient reaches for.
        client = { destroy: mockDestroy };
        // ssh2-sftp-client has no readlink/symlink of its own, so the adapter reaches through
        // to this. Left undefined by default, which exercises the longname fallback.
        get sftp() { return rawSftpChannel.current; }
    }
    return { default: MockSFTPClient };
});

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    },
}));

const config = { host: "nas.local", port: 22, username: "backup", password: "pw" };

const dir = (name: string) => ({ name, type: "d", size: 0, modifyTime: 1_700_000_000_000 });
const file = (name: string, size = 10) => ({ name, type: "-", size, modifyTime: 1_700_000_000_000 });

/** Serves a tree keyed by absolute directory path. */
function serveTree(tree: Record<string, unknown[]>) {
    mockSftpExists.mockResolvedValue("d");
    mockSftpList.mockImplementation(async (path: string) => tree[path] ?? []);
}

describe("SFTPAdapter.listTree", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSftpConnect.mockResolvedValue(undefined);
        mockSftpEnd.mockResolvedValue(undefined);
    });

    it("walks the whole tree when nothing is excluded", async () => {
        serveTree({
            ".": [file("a.txt"), dir("sub")],
            "sub": [file("b.txt")],
        });

        const result = await SFTPAdapter.listTree!(config, "");

        expect(result.files.map((f) => f.path).sort()).toEqual(["a.txt", "sub/b.txt"]);
        expect(result.pruned).toEqual([]);
    });

    it("never reads an excluded directory", async () => {
        serveTree({
            ".": [file("a.txt"), dir("node_modules")],
            "node_modules": [file("huge.js")],
        });

        const result = await SFTPAdapter.listTree!(config, "", { excludePatterns: ["node_modules/**"] });

        expect(result.files.map((f) => f.path)).toEqual(["a.txt"]);
        expect(result.pruned).toEqual([{ path: "node_modules", pattern: "node_modules/**" }]);
        // The saving is the listing that never happened, not a filter applied afterwards.
        expect(mockSftpList).not.toHaveBeenCalledWith("node_modules");
    });

    it("never reads a nested folder a group of DBackup names", async () => {
        serveTree({
            ".": [dir("app"), file("README.md")],
            "app": [file("index.js"), dir("node_modules"), dir(".git")],
            "app/node_modules": [dir("react")],
            "app/node_modules/react": [file("index.js")],
            "app/.git": [file("HEAD")],
        });

        const result = await SFTPAdapter.listTree!(config, "", { excludePatterns: resolveExcludePatterns({ groups: ["dev", "vcs"] }) });

        expect(result.files.map((f) => f.path).sort()).toEqual(["README.md", "app/index.js"]);
        expect(result.pruned).toEqual([
            { path: "app/node_modules", pattern: "**/node_modules/**" },
            { path: "app/.git", pattern: "**/.git/**" },
        ]);
        expect(mockSftpList).not.toHaveBeenCalledWith("app/node_modules");
        expect(mockSftpList).not.toHaveBeenCalledWith("app/.git");
    });

    it("walks a nested folder a pattern only names at the top", async () => {
        // A pattern with a slash matches from the top of the folder, the rule users write by.
        serveTree({
            ".": [dir("app")],
            "app": [dir("node_modules")],
            "app/node_modules": [file("x.js")],
        });

        const result = await SFTPAdapter.listTree!(config, "", { excludePatterns: ["node_modules/**"] });

        expect(mockSftpList).toHaveBeenCalledWith("app/node_modules");
        expect(result.files.map((f) => f.path)).toEqual(["app/node_modules/x.js"]);
        expect(result.pruned).toEqual([]);
    });

    it("still descends where a pattern only excludes some files", async () => {
        serveTree({
            ".": [dir("logs")],
            "logs": [file("app.log"), file("keep.txt")],
        });

        const result = await SFTPAdapter.listTree!(config, "", { excludePatterns: ["*.log"] });

        // Pruning must not act on a pattern that leaves files behind - the caller filters them.
        expect(mockSftpList).toHaveBeenCalledWith("logs");
        expect(result.files.map((f) => f.path).sort()).toEqual(["logs/app.log", "logs/keep.txt"]);
        expect(result.pruned).toEqual([]);
    });

    it("matches exclude patterns against the same relative path the caller derives", async () => {
        // The sharp edge: with a pathPrefix and a subdirectory query, the walk must apply
        // patterns relative to the queried directory, not to the adapter root.
        serveTree({
            "/srv/backups/docker": [dir("node_modules"), file("compose.yml")],
            "/srv/backups/docker/node_modules": [file("x.js")],
        });

        const prefixed = { ...config, pathPrefix: "/srv/backups" };
        const result = await SFTPAdapter.listTree!(prefixed, "docker", { excludePatterns: ["node_modules/**"] });

        expect(result.pruned).toEqual([{ path: "node_modules", pattern: "node_modules/**" }]);

        // And the returned path, once the caller strips the queried directory, is the path the
        // pattern was matched against.
        const relative = toRelativePath(result.files[0].path, "docker");
        expect(relative).toBe("compose.yml");
    });

    it("reports progress while it walks", async () => {
        serveTree({
            ".": [dir("one"), dir("two")],
            "one": [file("a.txt")],
            "two": [file("b.txt")],
        });

        const seen: { files: number; directories: number }[] = [];
        await SFTPAdapter.listTree!(config, "", {
            onProgress: ({ files, directories }) => seen.push({ files, directories }),
        });

        expect(seen.length).toBeGreaterThan(0);
        expect(seen.at(-1)).toEqual({ files: 2, directories: 3 });
    });

    it("stops when the signal is already aborted", async () => {
        serveTree({ ".": [file("a.txt")] });
        const controller = new AbortController();
        controller.abort();

        await expect(SFTPAdapter.listTree!(config, "", { signal: controller.signal })).rejects.toThrow();
        expect(mockSftpList).not.toHaveBeenCalled();
    });

    it("stops mid-walk when the signal fires, and closes its connections", async () => {
        const controller = new AbortController();
        mockSftpExists.mockResolvedValue("d");
        mockSftpList.mockImplementation(async (path: string) => {
            if (path === ".") return [dir("one"), dir("two")];
            controller.abort();
            return [];
        });

        await expect(
            SFTPAdapter.listTree!(config, "", { signal: controller.signal })
        ).rejects.toThrow();

        expect(mockSftpEnd).toHaveBeenCalled();
    });

    it("returns nothing when the directory does not exist", async () => {
        mockSftpExists.mockResolvedValue(false);

        const result = await SFTPAdapter.listTree!(config, "missing");

        expect(result).toEqual({ files: [], pruned: [] });
        expect(mockSftpList).not.toHaveBeenCalled();
    });

    it("bounds a concurrent source-tree walk to one reusable SSH connection", async () => {
        mockSftpExists.mockResolvedValue("d");
        mockSftpList.mockImplementation(async (remotePath: string) => {
            if (remotePath === ".") return [dir("one"), dir("two"), dir("three")];
            await new Promise((resolve) => setTimeout(resolve, 10));
            return [file(remotePath + ".txt")];
        });

        const result = await SFTPAdapter.listTree!(config, "", { concurrency: 8 });

        expect(result.files).toHaveLength(3);
        expect(mockSftpConnect).toHaveBeenCalledTimes(1);
        expect(mockSftpEnd).toHaveBeenCalledTimes(1);
    });

    it("retries a transient SSH handshake error just once for a source walk", async () => {
        serveTree({ ".": [file("a.txt")] });
        mockSftpConnect
            .mockRejectedValueOnce(new Error("Timed out while waiting for handshake"))
            .mockResolvedValueOnce(undefined);

        const result = await SFTPAdapter.listTree!(config, "", { concurrency: 8 });
        expect(result.files).toHaveLength(1);
        expect(mockSftpConnect).toHaveBeenCalledTimes(2);
    });

    it("disposes a failed handshake client before retrying a source scan", async () => {
        serveTree({ ".": [file("ok.txt")] });
        mockSftpConnect.mockRejectedValueOnce(new Error("ETIMEDOUT")).mockResolvedValueOnce(undefined);

        await SFTPAdapter.listTree!(config, "", { concurrency: 8 });

        expect(mockSftpConnect).toHaveBeenCalledTimes(2);
        expect(mockSftpEnd).toHaveBeenCalledTimes(2);
        expect(mockDestroy).toHaveBeenCalledTimes(2);
    });

    it("never retries a non-transient authentication failure", async () => {
        mockSftpConnect.mockRejectedValue(new Error("All configured authentication methods failed"));
        await expect(SFTPAdapter.listTree!(config, "")).rejects.toThrow("authentication methods");
        expect(mockSftpConnect).toHaveBeenCalledTimes(1);
    });

    it("opens one connection for a serial walk and closes it afterwards", async () => {
        serveTree({ ".": [file("a.txt")] });

        await SFTPAdapter.listTree!(config, "");

        expect(mockSftpConnect).toHaveBeenCalledTimes(1);
        expect(mockSftpEnd).toHaveBeenCalledTimes(1);
    });
});

describe("connectSFTP", () => {
    beforeEach(() => vi.clearAllMocks());

    it("enables keepalive and a handshake timeout", async () => {
        await connectSFTP(config);

        // Without these ssh2 has no way to notice a connection that stopped being carried,
        // and a request waiting on it waits forever.
        expect(mockSftpConnect).toHaveBeenCalledWith(expect.objectContaining({
            readyTimeout: expect.any(Number),
            keepaliveInterval: expect.any(Number),
            keepaliveCountMax: expect.any(Number),
        }));
        const passed = mockSftpConnect.mock.calls[0][0];
        expect(passed.keepaliveInterval).toBeGreaterThan(0);
    });
});

describe("endSftpClient", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => vi.useRealTimers());

    it("returns once a polite disconnect completes", async () => {
        mockSftpEnd.mockResolvedValue(undefined);
        const client = await connectSFTP(config);

        await endSftpClient(client);

        expect(mockSftpEnd).toHaveBeenCalled();
    });

    it("gives up on a disconnect that never completes and drops the socket", async () => {
        // ssh2's end() is a graceful FIN and resolves only once the peer answers. A half-open
        // connection therefore leaves it pending forever, in a finally block, after the backup
        // has already done its work.
        mockSftpEnd.mockReturnValue(new Promise(() => { }));
        const client = await connectSFTP(config);

        const done = endSftpClient(client);
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(done).resolves.toBeUndefined();

        expect(mockDestroy).toHaveBeenCalled();
    });

    it("treats a failed disconnect as closed rather than propagating it", async () => {
        mockSftpEnd.mockRejectedValue(new Error("socket already gone"));
        const client = await connectSFTP(config);

        await expect(endSftpClient(client)).resolves.toBeUndefined();
        expect(mockDestroy).toHaveBeenCalled();
    });
});

describe("SFTPAdapter.listTree and symbolic links", () => {
    const link = (name: string, longname?: string) => ({
        name, type: "l", size: 0, modifyTime: 1_700_000_000_000, ...(longname ? { longname } : {}),
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockSftpConnect.mockResolvedValue(undefined);
        mockSftpEnd.mockResolvedValue(undefined);
    });

    afterEach(() => { rawSftpChannel.current = undefined; });

    it("reads a link's target through the raw ssh2 channel", async () => {
        // realPath() would resolve the link the whole way to its destination, which is exactly
        // the information a backup must not store - so readlink is what has to be used.
        rawSftpChannel.current = {
            readlink: (p: string, cb: (e: undefined, t: string) => void) =>
                cb(undefined, p.endsWith("cert.pem") ? "../archive/cert1.pem" : ""),
        };
        serveTree({
            ".": [dir("live"), dir("archive")],
            "live": [link("cert.pem")],
            "archive": [file("cert1.pem")],
        });

        const result = await SFTPAdapter.listTree!(config, "");

        const found = result.files.find((f) => f.path === "live/cert.pem")!;
        expect(found.linkTarget).toBe("../archive/cert1.pem");
        expect(found.size).toBe(0);
        expect(result.unsupportedSymlinks).toBeUndefined();
    });

    it("falls back to parsing the target out of longname", async () => {
        // No readlink on this connection, but most servers put the target in the ls -l style
        // long name of a listing, which is enough to store the link faithfully.
        serveTree({
            ".": [link("cert.pem", "lrwxrwxrwx 1 u g 24 Jan  1 00:00 cert.pem -> ../archive/cert1.pem")],
        });

        const result = await SFTPAdapter.listTree!(config, "");

        expect(result.files[0].linkTarget).toBe("../archive/cert1.pem");
    });

    it("reports a link whose target it cannot read at all", async () => {
        serveTree({ ".": [link("cert.pem"), file("real.txt")] });

        const result = await SFTPAdapter.listTree!(config, "");

        // Named rather than dropped: a link missing from a backup that nobody was told about
        // is the failure mode that only surfaces during a restore.
        expect(result.files.map((f) => f.path)).toEqual(["real.txt"]);
        expect(result.unsupportedSymlinks).toEqual(["cert.pem"]);
    });

    it("does not descend into a link that points at a directory", async () => {
        rawSftpChannel.current = {
            readlink: (_p: string, cb: (e: undefined, t: string) => void) => cb(undefined, "real"),
        };
        serveTree({
            ".": [link("alias"), dir("real")],
            "real": [file("inside.txt")],
            "alias": [file("should-not-be-listed.txt")],
        });

        const result = await SFTPAdapter.listTree!(config, "");

        expect(result.files.map((f) => f.path).sort()).toEqual(["alias", "real/inside.txt"]);
    });
});
