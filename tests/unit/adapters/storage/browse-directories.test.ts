/**
 * Folder browsing for the adapters that lacked it.
 *
 * This is what the job form uses to show a checkbox tree of the source server's folders.
 * None of these four was missing it for a protocol reason - each one's `list()` already
 * distinguished directories - so the gap was simply that only one tree level was never
 * exposed. These tests pin the per-protocol detail that makes each one work: the attribute
 * string on SMB, `isDirectory` on FTP, the collection type on WebDAV, and the delimiter
 * that makes object storage report prefixes as folders at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── SMB ──────────────────────────────────────────────────────────────────
const smbList = vi.fn();
vi.mock("samba-client", () => ({
    default: class {
        list = (...args: unknown[]) => smbList(...args);
    },
}));

// ── FTP ──────────────────────────────────────────────────────────────────
const ftpList = vi.fn();
const ftpClose = vi.fn();
vi.mock("basic-ftp", () => ({
    Client: class {
        ftp = { verbose: false };
        access = vi.fn();
        list = (...args: unknown[]) => ftpList(...args);
        close = ftpClose;
    },
}));

// ── WebDAV ───────────────────────────────────────────────────────────────
const davContents = vi.fn();
vi.mock("webdav", () => ({
    createClient: vi.fn(() => ({ getDirectoryContents: davContents })),
}));

// ── S3 ───────────────────────────────────────────────────────────────────
const s3Send = vi.fn();
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
    return {
        ...actual,
        S3Client: class {
            send = (...args: unknown[]) => s3Send(...args);
            destroy = vi.fn();
        },
    };
});

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { SMBAdapter } = await import("@/lib/adapters/storage/smb");
const { FTPAdapter } = await import("@/lib/adapters/storage/ftp");
const { WebDAVAdapter } = await import("@/lib/adapters/storage/webdav");
const { S3GenericAdapter, S3R2Adapter } = await import("@/lib/adapters/storage/s3");

beforeEach(() => vi.clearAllMocks());

describe("SMB browseDirectories", () => {
    const config = { address: "//nas/share", username: "u", password: "p", maxProtocol: "SMB3" } as never;

    it("returns only directories, dropping . and ..", async () => {
        smbList.mockResolvedValue([
            { name: ".", type: "D", size: 0, modifyTime: new Date() },
            { name: "..", type: "D", size: 0, modifyTime: new Date() },
            { name: "data", type: "D", size: 0, modifyTime: new Date() },
            { name: "notes.txt", type: "A", size: 12, modifyTime: new Date() },
        ]);

        expect(await SMBAdapter.browseDirectories!(config, "")).toEqual([
            { name: "data", path: "data" },
        ]);
    });

    it("recognises a directory whose attributes carry more than D", async () => {
        // smbclient reports a flag string: "DH" is a hidden directory, "DA" an archived one.
        smbList.mockResolvedValue([
            { name: "hidden", type: "DH", size: 0, modifyTime: new Date() },
            { name: "archived", type: "DA", size: 0, modifyTime: new Date() },
            { name: "plain.txt", type: "A", size: 1, modifyTime: new Date() },
        ]);

        const names = (await SMBAdapter.browseDirectories!(config, "")).map((e) => e.name);
        expect(names).toEqual(["hidden", "archived"]);
    });

    it("asks for the folder's contents, not the folder itself", async () => {
        smbList.mockResolvedValue([]);
        await SMBAdapter.browseDirectories!(config, "projects");
        expect(smbList).toHaveBeenCalledWith("projects/*");
    });

    it("builds nested paths relative to the adapter root", async () => {
        smbList.mockResolvedValue([{ name: "inner", type: "D", size: 0, modifyTime: new Date() }]);
        expect(await SMBAdapter.browseDirectories!(config, "outer")).toEqual([
            { name: "inner", path: "outer/inner" },
        ]);
    });
});

describe("FTP browseDirectories", () => {
    const config = { host: "ftp.example.com", user: "u", password: "p", port: 21 } as never;

    it("returns only directories", async () => {
        ftpList.mockResolvedValue([
            { name: "backups", isDirectory: true },
            { name: "readme.txt", isDirectory: false },
        ]);

        expect(await FTPAdapter.browseDirectories!(config, "")).toEqual([
            { name: "backups", path: "backups" },
        ]);
    });

    it("closes the connection even when listing fails", async () => {
        ftpList.mockRejectedValue(new Error("550 Permission denied"));

        await expect(FTPAdapter.browseDirectories!(config, "")).rejects.toThrow();
        expect(ftpClose).toHaveBeenCalled();
    });
});

describe("WebDAV browseDirectories", () => {
    const config = { url: "https://dav.example.com", username: "u", password: "p" } as never;

    it("returns only collections", async () => {
        davContents.mockResolvedValue([
            { basename: "documents", filename: "/documents", type: "directory" },
            { basename: "note.md", filename: "/note.md", type: "file" },
        ]);

        expect(await WebDAVAdapter.browseDirectories!(config, "")).toEqual([
            { name: "documents", path: "documents" },
        ]);
    });
});

describe("S3 browseDirectories", () => {
    const config = {
        endpoint: "https://s3.example.com", region: "us-east-1", bucket: "b",
        accessKeyId: "k", secretAccessKey: "s",
    } as never;

    it("turns common prefixes into one level of folders", async () => {
        // Object storage has no directories; the delimiter is what makes S3 group keys.
        s3Send.mockResolvedValue({
            CommonPrefixes: [{ Prefix: "data/" }, { Prefix: "logs/" }],
            IsTruncated: false,
        });

        expect(await S3GenericAdapter.browseDirectories!(config, "")).toEqual([
            { name: "data", path: "data" },
            { name: "logs", path: "logs" },
        ]);

        const sent = s3Send.mock.calls[0][0] as { input: Record<string, unknown> };
        expect(sent.input.Delimiter).toBe("/");
    });

    it("follows pagination, so a bucket with many prefixes is not cut short", async () => {
        s3Send
            .mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: "a/" }], IsTruncated: true, NextContinuationToken: "t1" })
            .mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: "b/" }], IsTruncated: false });

        const names = (await S3GenericAdapter.browseDirectories!(config, "")).map((e) => e.name);

        expect(names).toEqual(["a", "b"]);
        expect(s3Send).toHaveBeenCalledTimes(2);
    });

    it("strips the queried prefix from nested folder names", async () => {
        s3Send.mockResolvedValue({ CommonPrefixes: [{ Prefix: "data/2026/" }], IsTruncated: false });

        expect(await S3GenericAdapter.browseDirectories!(config, "data")).toEqual([
            { name: "2026", path: "data/2026" },
        ]);
    });

    it("scopes browsing to the adapter's path prefix (R2)", async () => {
        // R2/AWS/Hetzner previously dropped the prefix here, so browsing an adapter rooted
        // at "test/" listed the whole bucket. It must list only what is under the prefix,
        // and return paths relative to it.
        const r2Config = {
            accountId: "acc", bucket: "b", accessKeyId: "k", secretAccessKey: "s", pathPrefix: "test",
        } as never;
        s3Send.mockResolvedValue({ CommonPrefixes: [{ Prefix: "test/restore/" }], IsTruncated: false });

        const result = await S3R2Adapter.browseDirectories!(r2Config, "");

        // The listing request is scoped to the prefix...
        const sent = s3Send.mock.calls[0][0] as { input: Record<string, unknown> };
        expect(sent.input.Prefix).toBe("test/");
        // ...and the returned folder is relative to it, so the picker and the backup/restore
        // paths that consume it stay prefix-relative.
        expect(result).toEqual([{ name: "restore", path: "restore" }]);
    });
});
