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
    toRelativePath,
} from "@/lib/adapters/storage/common/download-directory";
import { resolveExcludePatterns } from "@/lib/exclude-groups";
import { matchesAnyExcludePattern } from "@/lib/exclude-patterns";
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

    it("matches a pattern starting with **/ at any depth, the top included", () => {
        expect(matchesAnyExcludePattern("node_modules/pkg/index.js", ["**/node_modules/**"])).toBe(true);
        expect(matchesAnyExcludePattern("apps/web/node_modules/pkg/index.js", ["**/node_modules/**"])).toBe(true);
        expect(matchesAnyExcludePattern("apps/web/.git/objects/ab/cdef", ["**/.git/**"])).toBe(true);
        expect(matchesAnyExcludePattern("apps/web/src/node_modules_helper.js", ["**/node_modules/**"])).toBe(false);
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

    it("reports what the exclude patterns kept out, grouped per pattern", async () => {
        // Excluding files silently is the failure mode that only shows up when the backup is
        // needed. Reported per pattern, not per file, so a node_modules does not write
        // thousands of lines into the execution log.
        const files = [
            makeFile("Job/keep.txt", 100),
            makeFile("Job/node_modules/a.js", 500),
            makeFile("Job/node_modules/b.js", 700),
            makeFile("Job/cache.tmp", 50),
        ];
        const adapter = makeAdapter(files);
        const onLog = vi.fn();

        await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", ["node_modules/**", "*.tmp"], undefined, onLog);

        const summary = onLog.mock.calls.find(([msg]) => (msg as string).includes("skipped by exclude patterns"));
        expect(summary, "expected a summary line").toBeTruthy();
        expect(summary![0]).toContain("3 file(s)");
        // The per-pattern breakdown rides along as details, which the log viewer expands.
        expect(summary![3]).toContain("node_modules/**");
        expect(summary![3]).toContain("*.tmp");
    });

    it("leaves out a nested node_modules and .git when a preset follows the groups of DBackup", async () => {
        const files = [
            makeFile("Job/app/src/index.ts", 100),
            makeFile("Job/app/node_modules/react/index.js", 500),
            makeFile("Job/libs/ui/node_modules/.bin/tsc", 50),
            makeFile("Job/libs/ui/.git/HEAD", 20),
        ];
        const adapter = makeAdapter(files);

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", resolveExcludePatterns({ groups: ["dev", "vcs"] }));

        expect(result.entries.map((e) => e.relativePath)).toEqual(["app/src/index.ts"]);
        expect(adapter.download).toHaveBeenCalledTimes(1);
    });

    it("says nothing about exclusions when no file was excluded", async () => {
        const adapter = makeAdapter([makeFile("Job/keep.txt", 100)]);
        const onLog = vi.fn();

        await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", ["*.tmp"], undefined, onLog);

        expect(onLog.mock.calls.some(([msg]) => (msg as string).includes("skipped by exclude"))).toBe(false);
    });

    it("skips (without throwing) a file whose download fails", async () => {
        const files = [makeFile("Job/a.txt", 100), makeFile("Job/b.txt", 100)];
        const adapter = makeAdapter(files, async (_c, remotePath: string) => remotePath !== "Job/b.txt");

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job");

        expect(result.files).toBe(1);
        expect(result.entries[0].relativePath).toBe("a.txt");
    });

    it("hides an adapter's per-file info chatter but keeps its warnings and errors", async () => {
        // A chatty adapter (Google Drive logs a start and a finish per file) would otherwise
        // put hundreds of lines in the execution history. Progress is reported separately, so
        // only warnings and errors earn a history line here.
        type Log = (msg: string, level?: string) => void;
        const files = [makeFile("Job/a.txt", 100), makeFile("Job/b.txt", 100)];
        const adapter = makeAdapter(files, (async (_c: unknown, remotePath: string, _l: string, _p: unknown, onLog?: Log) => {
            onLog?.(`Starting download: ${remotePath}`, "info");
            onLog?.(`Download completed: ${remotePath}`, "info");
            if (remotePath === "Job/b.txt") onLog?.("Retrying after a transient error", "warning");
            return true;
        }) as never);

        const onLog = vi.fn();
        await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, undefined, onLog);

        const messages = onLog.mock.calls.map((c) => c[0] as string);
        expect(messages.some((m) => m.includes("Starting download"))).toBe(false);
        expect(messages.some((m) => m.includes("Download completed"))).toBe(false);
        expect(messages).toContain("Retrying after a transient error");
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

    it("downloads files in parallel up to the concurrency limit", async () => {
        // Each download blocks on a shared gate so several are provably in flight at once;
        // the peak in-flight count must match the requested concurrency, not exceed it.
        const files = Array.from({ length: 12 }, (_, i) => makeFile(`Job/f${i}.txt`, 10));
        let inFlight = 0;
        let peak = 0;
        const adapter = makeAdapter(files, async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            return true;
        });

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, undefined, undefined, { concurrency: 4 });

        expect(peak).toBe(4);
        expect(result.files).toBe(12);
    });

    it("defaults to serial when no concurrency is given", async () => {
        // The mutation guard for the test above: without the option the loop must run one at
        // a time, so this pins the historical behaviour and proves the option is what lifts it.
        const files = Array.from({ length: 5 }, (_, i) => makeFile(`Job/f${i}.txt`, 10));
        let inFlight = 0;
        let peak = 0;
        const adapter = makeAdapter(files, async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 2));
            inFlight--;
            return true;
        });

        await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job");

        expect(peak).toBe(1);
    });

    it("keeps result entries in listing order despite out-of-order completion", async () => {
        // Later files finish first (shorter sleep), so if the result order tracked completion
        // instead of input order this would come back reversed.
        const files = [makeFile("Job/slow.txt", 10), makeFile("Job/fast.txt", 20)];
        const adapter = makeAdapter(files, async (_c, remotePath: string) => {
            await new Promise((r) => setTimeout(r, remotePath.endsWith("slow.txt") ? 10 : 1));
            return true;
        });

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, undefined, undefined, { concurrency: 2 });

        expect(result.entries.map((e) => e.relativePath)).toEqual(["slow.txt", "fast.txt"]);
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

describe("listTree capability", () => {
    beforeEach(() => vi.clearAllMocks());

    function withListTree(adapter: StorageAdapter, impl: ReturnType<typeof vi.fn>): StorageAdapter {
        (adapter as unknown as Record<string, unknown>).listTree = impl;
        return adapter;
    }

    it("prefers the adapter's own walker and hands it the exclude patterns", async () => {
        const adapter = withListTree(
            makeAdapter([]),
            vi.fn().mockResolvedValue({ files: [makeFile("Job/a.txt", 10)], pruned: [] })
        );

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", ["node_modules/**"]);

        expect(result.files).toBe(1);
        expect(adapter.list).not.toHaveBeenCalled();
        expect((adapter as unknown as { listTree: ReturnType<typeof vi.fn> }).listTree)
            .toHaveBeenCalledWith({}, "Job", expect.objectContaining({ excludePatterns: ["node_modules/**"] }));
    });

    it("still filters what the walker returned, so a buggy walker cannot smuggle files in", async () => {
        // Pruning decides what gets looked at. What ends up in the backup stays the caller's
        // decision, and this is the invariant that keeps a broken adapter from changing it.
        const adapter = withListTree(
            makeAdapter([]),
            vi.fn().mockResolvedValue({
                files: [makeFile("Job/keep.txt", 10), makeFile("Job/skip.log", 10)],
                pruned: [],
            })
        );

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", ["*.log"]);

        expect(result.entries.map((e) => e.relativePath)).toEqual(["keep.txt"]);
    });

    it("reports pruned directories rather than letting them vanish from the summary", async () => {
        const adapter = withListTree(
            makeAdapter([]),
            vi.fn().mockResolvedValue({
                files: [],
                pruned: [{ path: "node_modules", pattern: "node_modules/**" }],
            })
        );

        const onLog = vi.fn();
        await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", ["node_modules/**"], undefined, onLog);

        const summary = onLog.mock.calls.find(([msg]) => String(msg).includes("not scanned"));
        expect(summary).toBeDefined();
        expect(String(summary![0])).toContain("1 director(ies) not scanned");
    });

    it("falls back to list() for an adapter without the capability", async () => {
        const adapter = makeAdapter([makeFile("Job/a.txt", 10)]);

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job");

        expect(result.files).toBe(1);
        expect(adapter.list).toHaveBeenCalled();
    });
});

describe("cancellation", () => {
    beforeEach(() => vi.clearAllMocks());

    it("refuses to start when the signal is already aborted", async () => {
        const adapter = makeAdapter([makeFile("Job/a.txt", 10)]);
        const controller = new AbortController();
        controller.abort();

        await expect(
            downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, undefined, undefined, {
                signal: controller.signal,
            })
        ).rejects.toThrow();
        expect(adapter.list).not.toHaveBeenCalled();
    });

    it("interrupts a transfer already running instead of waiting it out", async () => {
        // The reported bug: cancel worked on a source of 766 small files and did nothing on one
        // of 2 large files. With two files and two workers there is no next iteration to check
        // the signal at, so the only way out is dropping the connection underneath.
        //
        // The transfer here NEVER settles, not even once the session is closed. That is what a
        // torn-down SFTP transfer actually does: ssh2-sftp-client suppresses the close event
        // that would reject it, and ssh2 then waits on a CLOSE reply that never arrives. A first
        // attempt at this fix closed the session and waited for the library to report the
        // failure, which left the run hanging exactly as before.
        const controller = new AbortController();
        let closed = false;

        const adapter = makeAdapter([makeFile("Job/a.bin", 200_000_000), makeFile("Job/b.bin", 200_000_000)]);
        (adapter as unknown as Record<string, unknown>).openSession = vi.fn().mockResolvedValue({
            download: () => new Promise<boolean>(() => { /* never settles, by design */ }),
            close: async () => { closed = true; },
        });

        const run = downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, undefined, undefined, {
            signal: controller.signal,
            concurrency: 2,
        });

        // Both workers are now inside a transfer, with no iteration left to check at.
        await new Promise((r) => setTimeout(r, 10));
        controller.abort();

        await expect(run).rejects.toThrow();
        // Stopped waiting, and let go of the sockets on the way out.
        expect(closed).toBe(true);
    });

    it("does not report a cancelled transfer as a file missing from the backup", async () => {
        const controller = new AbortController();

        const adapter = makeAdapter([makeFile("Job/a.bin", 100)], async () => {
            controller.abort();
            // What a dropped connection looks like to the caller.
            return false;
        });

        const onLog = vi.fn();
        await expect(
            downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, undefined, onLog, {
                signal: controller.signal,
                concurrency: 1,
            })
        ).rejects.toThrow();

        // "MISSING from this backup" on every in-flight file would turn a deliberate cancel
        // into an alarming report about data that is not actually gone.
        expect(onLog.mock.calls.some(([msg]) => String(msg).includes("Failed to download"))).toBe(false);
    });

    it("stops downloading the rest of the source once cancelled", async () => {
        const files = Array.from({ length: 20 }, (_, i) => makeFile(`Job/f${i}.txt`, 1));
        const controller = new AbortController();
        let downloaded = 0;

        const adapter = makeAdapter(files, async () => {
            downloaded++;
            if (downloaded === 3) controller.abort();
            return true;
        });

        await expect(
            downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, undefined, undefined, {
                signal: controller.signal,
                concurrency: 1,
            })
        ).rejects.toThrow();

        // Bounded by the transfers already in flight, not by the rest of the source.
        expect(downloaded).toBeLessThan(files.length);
    });
});

describe("per-file transfer progress", () => {
    beforeEach(() => vi.clearAllMocks());

    it("passes a progress callback down so a large file is not silence", async () => {
        // Without this a single big file reports nothing until it has fully arrived, which is
        // indistinguishable from a stalled run.
        const adapter = makeAdapter([makeFile("Job/big.bin", 1000)], async (_c, _r, _l) => true);

        await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, vi.fn());

        const downloadCall = (adapter.download as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(typeof downloadCall[3]).toBe("function");
    });
});

describe("symbolic links during collection", () => {
    beforeEach(() => vi.clearAllMocks());

    function makeLink(path: string, target: string): FileInfo {
        return { name: path.split("/").pop()!, path, size: 0, lastModified: new Date("2026-01-01"), linkTarget: target };
    }

    it("carries a link through without downloading anything for it", async () => {
        const adapter = makeAdapter([
            makeFile("Job/archive/cert1.pem", 100),
            makeLink("Job/live/cert.pem", "../archive/cert1.pem"),
        ]);

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job");

        // Downloading a link would fetch whatever it points at and store those bytes under the
        // link's own path, which is a different tree than the one being backed up.
        expect((adapter.download as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]))
            .toEqual(["Job/archive/cert1.pem"]);

        const link = result.entries.find((e) => e.relativePath === "live/cert.pem")!;
        expect(link.linkTarget).toBe("../archive/cert1.pem");
        expect(link.size).toBe(0);
        expect(link.unchanged, "a link is never marked unchanged - it does not carry forward").toBeUndefined();
    });

    it("never asks shouldDownload about a link", async () => {
        // If it did and the answer were "unchanged", the link would be queued for carry-forward
        // and then dropped by carryForward(), vanishing from the incremental entirely.
        const adapter = makeAdapter([makeLink("Job/live/cert.pem", "../archive/cert1.pem")]);
        const shouldDownload = vi.fn().mockReturnValue(false);

        const result = await downloadDirectoryGeneric(
            adapter, {}, "Job", "/local/job", undefined, undefined, undefined, { shouldDownload }
        );

        expect(shouldDownload).not.toHaveBeenCalled();
        expect(result.entries[0].linkTarget).toBe("../archive/cert1.pem");
    });

    it("still applies exclude patterns to links", async () => {
        const adapter = makeAdapter([makeLink("Job/live/cert.pem", "../archive/cert1.pem")]);

        const result = await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", ["live/**"]);

        expect(result.entries).toEqual([]);
    });

    it("names the links an adapter could not describe instead of dropping them silently", async () => {
        const adapter = makeAdapter([makeFile("Job/a.txt", 10)]);
        adapter.listTree = vi.fn().mockResolvedValue({
            files: [makeFile("Job/a.txt", 10)],
            pruned: [],
            unsupportedSymlinks: ["live/cert.pem", "live/chain.pem"],
        });
        const onLog = vi.fn();

        await downloadDirectoryGeneric(adapter, {}, "Job", "/local/job", undefined, undefined, onLog);

        const warning = onLog.mock.calls.find((c) => c[1] === "warning");
        expect(warning?.[0]).toContain("2 symbolic link(s) could not be collected");
        expect(warning?.[3], "the paths matter - a count tells nobody what is missing")
            .toContain("live/cert.pem");
    });
});
