/**
 * Unpacking a volume's tar stream.
 *
 * The transport is verified against a real daemon; this covers what the extractor does with
 * what arrives - the mount prefix, the metadata that decides whether a restored volume is
 * usable, the entry kinds a volume can hold that a backup cannot represent, and the guard
 * against a member name that would write outside the collection directory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFakeDockerEngine, type FakeDockerEngine, type FakeVolumeEntry } from "@/lib/testing/fake-docker-engine";
import type { DirectoryDownloadOptions } from "@/lib/core/interfaces";

const connectDocker = vi.fn();
vi.mock("@/lib/adapters/storage/docker/engine/connect", () => ({
    connectDocker: (config: unknown) => connectDocker(config),
    DEFAULT_SOCKET_PATH: "/var/run/docker.sock",
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { createDockerSnapshot, releaseDockerSnapshot } = await import("@/lib/adapters/storage/docker/snapshot");
const { downloadVolume } = await import("@/lib/adapters/storage/docker/read");

const VOLUME = "v-data";
const config = { connectionMode: "direct", helperImage: "alpine:3" };

let workDir: string;

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbackup-read-"));
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

/** Prepares a group the way the runner does, collects the volume, then releases. */
async function collect(
    engine: FakeDockerEngine,
    options?: DirectoryDownloadOptions,
    excludePatterns?: string[],
    onProgress?: (pb: number, tb: number, pf: number, tf: number) => void,
) {
    connectDocker.mockImplementation(() => ({ engine, close: async () => { await engine.close(); } }));
    const handle = await createDockerSnapshot(config, [VOLUME], { stopContainers: true });
    try {
        return await downloadVolume(
            { ...config, ...handle.configOverride },
            VOLUME, workDir, excludePatterns, onProgress, undefined, options,
        );
    } finally {
        await releaseDockerSnapshot(config, handle);
    }
}

function engineWith(entries: FakeVolumeEntry[], extra: Record<string, unknown> = {}): FakeDockerEngine {
    return createFakeDockerEngine({
        volumes: [VOLUME],
        volumeContents: { [VOLUME]: entries },
        ...extra,
    });
}

describe("downloadVolume", () => {
    it("strips the mount directory every export is prefixed with", async () => {
        // getArchive names every member after the basename of the requested path, so a file
        // at the volume root arrives as `v-data/app.conf`. Keeping that prefix would put an
        // extra directory into every restored volume.
        const result = await collect(engineWith([{ path: "app.conf", content: "x" }]));

        expect(result.entries.map((e) => e.relativePath)).toEqual(["app.conf"]);
        expect(await fs.readFile(path.join(workDir, "app.conf"), "utf8")).toBe("x");
    });

    it("carries mode, owner and group into the entry", async () => {
        const result = await collect(engineWith([
            { path: "data/pg.conf", content: "y", mode: 0o600, uid: 999, gid: 999 },
        ]));

        expect(result.entries[0]).toMatchObject({ relativePath: "data/pg.conf", mode: 0o600, uid: 999, gid: 999 });
    });

    it("records a symlink as a target rather than writing a file for it", async () => {
        const result = await collect(engineWith([
            { path: "current", type: "symlink", linkname: "releases/v2" },
        ]));

        expect(result.entries[0]).toMatchObject({ relativePath: "current", linkTarget: "releases/v2", size: 0 });
        await expect(fs.lstat(path.join(workDir, "current"))).rejects.toThrow();
    });

    it("passes over directories, which the archive derives from the paths inside them", async () => {
        const result = await collect(engineWith([
            { path: "sub", type: "directory" },
            { path: "sub/file.txt", content: "z" },
        ]));

        expect(result.entries.map((e) => e.relativePath)).toEqual(["sub/file.txt"]);
    });

    it("names an entry kind it cannot store instead of dropping it", async () => {
        // A hard link or a device node is not something the archive can represent. Skipping
        // it in silence would make the backup look complete when it is not.
        const result = await collect(engineWith([
            { path: "ok.txt", content: "a" },
            { path: "dev/null", type: "block-device" },
        ]));

        expect(result.entries.map((e) => e.relativePath)).toEqual(["ok.txt"]);
        expect(result.failures).toEqual([
            { path: "dev/null", error: expect.stringContaining("unsupported entry type") },
        ]);
    });

    it("names an entry it cannot store as the log shows a name, never with its control characters", async () => {
        const result = await collect(engineWith([
            { path: "dev/evil\nINFO forged line", type: "block-device" },
        ]));

        expect(result.failures).toEqual([
            { path: "dev/evil\\nINFO forged line", error: expect.stringContaining("unsupported entry type") },
        ]);
    });

    it("fails a volume that lists a name longer than any file system allows", async () => {
        await expect(collect(engineWith([
            { path: "ok.txt", content: "a" },
            { path: "x".repeat(40 * 1024), content: "b" },
        ]))).rejects.toThrow(/longer than the 32768 any file system allows/);
    });

    it("refuses a member name that would write outside the collection directory", async () => {
        // Member names come from the volume, so a crafted one is the same class of threat as
        // a crafted archive index.
        const result = await collect(engineWith([{ path: "../escaped.txt", content: "bad" }]));

        expect(result.entries).toEqual([]);
        expect(result.failures[0].error).toMatch(/refused, the name has a '\.\.' part/);
        await expect(fs.access(path.join(path.dirname(workDir), "escaped.txt"))).rejects.toThrow();
    });

    it("refuses such a member name for a link and an unchanged file too", async () => {
        const result = await collect(
            engineWith([
                { path: "../link-out", type: "symlink", linkname: "/etc" },
                { path: "sub/../../same.txt", content: "a" },
            ]),
            { shouldDownload: () => false },
        );

        expect(result.entries).toEqual([]);
        expect(result.failures.map((f) => f.path)).toEqual(["../link-out", "sub/../../same.txt"]);
    });

    it("skips excluded files without counting them as failures", async () => {
        const result = await collect(
            engineWith([{ path: "keep.txt", content: "a" }, { path: "cache/x.tmp", content: "b" }]),
            undefined,
            ["*.tmp"],
        );

        expect(result.entries.map((e) => e.relativePath)).toEqual(["keep.txt"]);
        expect(result.failures).toEqual([]);
    });

    it("reports an unchanged file without writing it", async () => {
        // An incremental run still describes the whole tree, so the entry is reported rather
        // than left out - that is what carries it forward to the next archive.
        const result = await collect(
            engineWith([{ path: "same.txt", content: "a" }, { path: "changed.txt", content: "b" }]),
            { shouldDownload: (e) => e.relativePath !== "same.txt" },
        );

        expect(result.entries.find((e) => e.relativePath === "same.txt")?.unchanged).toBe(true);
        await expect(fs.access(path.join(workDir, "same.txt"))).rejects.toThrow();
        expect(await fs.readFile(path.join(workDir, "changed.txt"), "utf8")).toBe("b");
    });

    it("reports progress against the count taken before the transfer", async () => {
        const seen: Array<{ processed: number; total: number }> = [];
        await collect(
            engineWith([{ path: "a", content: "1" }, { path: "b", content: "2" }], { entryCounts: { [VOLUME]: 2 } }),
            undefined,
            undefined,
            (_pb, _tb, processed, total) => seen.push({ processed, total }),
        );

        expect(seen.at(-1)).toEqual({ processed: 2, total: 2 });
    });

    it("collects everything when the helper could not be run to count", async () => {
        // An image with no shell loses the denominator and nothing else. Progress is worth a
        // few percent of the transfer, never a failed backup.
        const seen: Array<{ processed: number; total: number }> = [];
        const result = await collect(
            engineWith([{ path: "a", content: "1" }, { path: "b", content: "2" }], { entryCounts: null }),
            undefined,
            undefined,
            (_pb, _tb, processed, total) => seen.push({ processed, total }),
        );

        expect(result.entries).toHaveLength(2);
        expect(await fs.readFile(path.join(workDir, "a"), "utf8")).toBe("1");
        // Reported with no total, which the caller renders as a running count.
        expect(seen.at(-1)).toEqual({ processed: 2, total: 0 });
    });

    it("reads through the helper container, not the volume directly", async () => {
        const engine = engineWith([{ path: "a", content: "1" }]);
        await collect(engine);

        expect(engine.calls.exported).toEqual([{ containerId: "helper-1", path: `/vol/${VOLUME}` }]);
    });

    it("refuses to collect without a prepared session", async () => {
        // A volume is only readable through a helper container, so reaching this without one
        // means something called the collection outside the runner's snapshot scope.
        await expect(downloadVolume(config, VOLUME, workDir)).rejects.toThrow(/No prepared Docker session/);
    });
});
