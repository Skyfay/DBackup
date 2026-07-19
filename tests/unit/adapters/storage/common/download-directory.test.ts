import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFsMkdir } = vi.hoisted(() => ({
    mockFsMkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("fs/promises", () => ({
    default: { mkdir: (...args: unknown[]) => mockFsMkdir(...args) },
    mkdir: (...args: unknown[]) => mockFsMkdir(...args),
}));

import {
    downloadDirectory,
    downloadDirectoryGeneric,
    matchesAnyExcludePattern,
    toRelativePath,
} from "@/lib/adapters/storage/common/download-directory";
import type { StorageAdapter, FileInfo } from "@/lib/core/interfaces";

function makeFile(path: string, size: number): FileInfo {
    return { name: path.split("/").pop()!, path, size, lastModified: new Date("2026-01-01") };
}

function makeAdapter(
    files: FileInfo[],
    downloadImpl?: (config: unknown, remotePath: string, localPath: string) => Promise<boolean>
): StorageAdapter {
    return {
        id: "mock",
        type: "storage",
        name: "Mock",
        configSchema: {} as never,
        list: vi.fn().mockResolvedValue(files),
        download: vi.fn(downloadImpl ?? (() => Promise.resolve(true))),
        upload: vi.fn(),
        delete: vi.fn(),
    } as unknown as StorageAdapter;
}

describe("matchesAnyExcludePattern", () => {
    it("returns false when no patterns are given", () => {
        expect(matchesAnyExcludePattern("foo/bar.txt", undefined)).toBe(false);
        expect(matchesAnyExcludePattern("foo/bar.txt", [])).toBe(false);
    });

    it("matches a slash-free pattern against the basename at any depth", () => {
        expect(matchesAnyExcludePattern("a/b/cache.tmp", ["*.tmp"])).toBe(true);
        expect(matchesAnyExcludePattern("cache.tmp", ["*.tmp"])).toBe(true);
        expect(matchesAnyExcludePattern("a/b/keep.txt", ["*.tmp"])).toBe(false);
    });

    it("matches a pattern with a slash against the full relative path", () => {
        expect(matchesAnyExcludePattern("node_modules/pkg/index.js", ["node_modules/**"])).toBe(true);
        expect(matchesAnyExcludePattern("src/node_modules_helper.js", ["node_modules/**"])).toBe(false);
    });

    it("matches dotfiles", () => {
        expect(matchesAnyExcludePattern(".git/HEAD", [".git/**"])).toBe(true);
    });

    it("ignores blank patterns", () => {
        expect(matchesAnyExcludePattern("foo.txt", ["   "])).toBe(false);
    });
});

describe("toRelativePath", () => {
    it("strips the queried remotePath prefix", () => {
        expect(toRelativePath("Job/sub/file.txt", "Job")).toBe("sub/file.txt");
    });

    it("returns the path unchanged when there is no remotePath root", () => {
        expect(toRelativePath("file.txt", "")).toBe("file.txt");
    });

    it("handles a file path exactly equal to the root", () => {
        expect(toRelativePath("Job", "Job")).toBe("Job");
    });

    it("strips a leading slash from the file path", () => {
        expect(toRelativePath("/Job/sub/file.txt", "Job")).toBe("sub/file.txt");
    });
});

describe("downloadDirectoryGeneric", () => {
    beforeEach(() => {
        mockFsMkdir.mockClear();
    });

    it("downloads every listed file to its relative local path", async () => {
        const files = [makeFile("Job/a.txt", 100), makeFile("Job/sub/b.txt", 200)];
        const adapter = makeAdapter(files);

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job");

        expect(result.files).toBe(2);
        expect(result.bytes).toBe(300);
        expect(result.entries.map((e) => e.relativePath).sort()).toEqual(["a.txt", "sub/b.txt"]);
        expect(adapter.download).toHaveBeenCalledTimes(2);
    });

    it("skips files matching exclude patterns", async () => {
        const files = [makeFile("Job/keep.txt", 100), makeFile("Job/cache.tmp", 50)];
        const adapter = makeAdapter(files);

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", ["*.tmp"]);

        expect(result.files).toBe(1);
        expect(result.entries[0].relativePath).toBe("keep.txt");
        expect(adapter.download).toHaveBeenCalledTimes(1);
    });

    it("skips (without throwing) a file whose download fails", async () => {
        const files = [makeFile("Job/a.txt", 100), makeFile("Job/b.txt", 100)];
        const adapter = makeAdapter(files, async (_c, remotePath: string) => remotePath !== "Job/b.txt");

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job");

        expect(result.files).toBe(1);
        expect(result.entries[0].relativePath).toBe("a.txt");
    });

    it("reports progress after each successful file", async () => {
        const files = [makeFile("Job/a.txt", 100), makeFile("Job/b.txt", 200)];
        const adapter = makeAdapter(files);
        const onProgress = vi.fn();

        await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, onProgress);

        expect(onProgress).toHaveBeenLastCalledWith(300, 300, 2, 2);
    });

    it("creates the local directory for each file before downloading", async () => {
        const files = [makeFile("Job/sub/deep/c.txt", 10)];
        const adapter = makeAdapter(files);

        await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job");

        expect(mockFsMkdir).toHaveBeenCalledWith(expect.stringContaining(`sub${"/"}deep`), { recursive: true });
    });
});

describe("downloadDirectory (dispatcher)", () => {
    it("uses the adapter's native downloadDirectory when implemented", async () => {
        const nativeResult = { files: 1, bytes: 1, entries: [] };
        const adapter = makeAdapter([]);
        (adapter as StorageAdapter & { downloadDirectory: unknown }).downloadDirectory = vi.fn().mockResolvedValue(nativeResult);

        const result = await downloadDirectory(adapter, {}, "Job", "/local/job");

        expect(result).toBe(nativeResult);
        expect(adapter.list).not.toHaveBeenCalled();
    });

    it("falls back to the generic implementation when native downloadDirectory is absent", async () => {
        const files = [makeFile("Job/a.txt", 10)];
        const adapter = makeAdapter(files);

        const result = await downloadDirectory(adapter, {}, "Job", "/local/job");

        expect(result.files).toBe(1);
        expect(adapter.list).toHaveBeenCalled();
    });
});
