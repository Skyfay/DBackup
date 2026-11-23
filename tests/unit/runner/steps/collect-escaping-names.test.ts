// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { executeCombinedDump } from "@/lib/runner/steps/combined-dump";
import { readArchiveIndex, readArchiveManifest } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import type { DirectoryDownloadResult, DirectoryFileEntry, StorageAdapter } from "@/lib/core/interfaces";
import type { DirectorySourceContext, JobWithRelations, RunnerContext } from "@/lib/runner/types";

/**
 * The server of a directory source may belong to a customer and answer anything. Whatever its
 * listing names, the run never reads a file of the server DBackup runs on into the archive.
 */

vi.mock("@/lib/prisma", () => ({
    default: {
        systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
        namingTemplate: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
    },
}));
vi.mock("@/services/tenant/tenant-network", () => ({ assertTenantReach: vi.fn() }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    resolveAdapterConfig: vi.fn(async (config: unknown) => ({ ...(config as Record<string, unknown>) })),
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/logging/errors", () => ({ wrapError: vi.fn((e) => e) }));
vi.mock("@/services/backup/chain-planner", () => ({
    planChain: vi.fn().mockResolvedValue({ type: "full", chainId: "chain-1", index: 0, chainDir: "chain-x" }),
}));
vi.mock("@/services/backup/encryption-service", () => ({
    getProfileMasterKey: vi.fn().mockResolvedValue(Buffer.alloc(32, 0x11)),
}));

const SECRET = "SERVER SECRET, never in a customer archive";

let base: string;
let secretFile: string;
const runDirs: string[] = [];

beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "collect-escape-"));
    secretFile = path.join(base, "dbackup.db");
    await fs.writeFile(secretFile, SECRET);
});

afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
    for (const dir of runDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

/** A source whose collection lays `files` into the folder of the run and lists `listed`, as a hostile server would. */
function hostileSource(
    lay: (localPath: string) => Promise<void>,
    listed: (localPath: string) => DirectoryFileEntry[]
): DirectorySourceContext {
    const adapter = {
        id: "sftp", type: "storage", name: "Hostile", configSchema: {} as never,
        upload: vi.fn(), download: vi.fn(), list: vi.fn(), delete: vi.fn(),
        downloadDirectory: vi.fn(async (_c: unknown, _r: string, localPath: string): Promise<DirectoryDownloadResult> => {
            await fs.mkdir(localPath, { recursive: true });
            await lay(localPath);
            const entries = listed(localPath);
            return { files: entries.length, bytes: 0, entries, failures: [] };
        }),
    } as unknown as StorageAdapter;
    return {
        jobSourceId: "jsrc-1", configId: "storage-1", configName: "Customer server", adapter,
        config: {}, remotePath: "/data", excludePatterns: [], priority: 0,
    };
}

async function run(source: DirectorySourceContext) {
    const ctx = {
        jobId: "job-1", logs: [], log: vi.fn(), updateProgress: vi.fn(), setStage: vi.fn(), updateDetail: vi.fn(),
        updateStageProgress: vi.fn(), destinations: [], sources: [source], status: "Running", startedAt: new Date(),
        job: { id: "job-1", name: "Files", databases: "[]", namingTemplateId: null, source: null } as unknown as JobWithRelations,
    } as unknown as RunnerContext;
    await executeCombinedDump(ctx);
    if (ctx.runDir) runDirs.push(ctx.runDir);
    const bytes = await fs.readFile(ctx.tempFile!);
    const archive = await localFileSource(ctx.tempFile!);
    const index = await readArchiveIndex(archive, await readArchiveManifest(archive));
    return { ctx, bytes, paths: index.files.map((f) => f.p) };
}

const file = (relativePath: string, size = 4): DirectoryFileEntry => ({ relativePath, size, lastModified: new Date("2026-01-01") });

describe("collecting a directory source whose server answers anything", () => {
    it("never packs a file of the server for a listed name that climbs out of the collection folder", async () => {
        const { ctx, bytes, paths } = await run(hostileSource(
            async (localPath) => { await fs.writeFile(path.join(localPath, "ok.txt"), "OKAY"); },
            (localPath) => [file("ok.txt"), file(path.relative(localPath, secretFile), SECRET.length)],
        ));

        expect(bytes.includes(SECRET)).toBe(false);
        expect(paths).toEqual(["ok.txt"]);
        expect(ctx.status).toBe("Partial");
    });

    it("never packs a file of the server for an absolute name", async () => {
        const { bytes, paths } = await run(hostileSource(
            async (localPath) => { await fs.writeFile(path.join(localPath, "ok.txt"), "OKAY"); },
            () => [file("ok.txt"), file(secretFile, SECRET.length)],
        ));

        expect(bytes.includes(SECRET)).toBe(false);
        expect(paths).toEqual(["ok.txt"]);
    });

    it("never follows a file that arrived as a link to a file of the server", async () => {
        const { ctx, bytes, paths } = await run(hostileSource(
            async (localPath) => { await fs.symlink(secretFile, path.join(localPath, "notes.txt")); },
            () => [file("notes.txt", SECRET.length)],
        ));

        expect(bytes.includes(SECRET)).toBe(false);
        expect(paths).toEqual([]);
        expect(ctx.status).toBe("Partial");
    });

    it("never reads through a folder that arrived as a link out of the collection folder", async () => {
        const { bytes, paths } = await run(hostileSource(
            async (localPath) => { await fs.symlink(base, path.join(localPath, "dir")); },
            () => [file("dir/dbackup.db", SECRET.length)],
        ));

        expect(bytes.includes(SECRET)).toBe(false);
        expect(paths).toEqual([]);
    });

    it("still packs a normal tree with a symbolic link of the source as a link", async () => {
        const { ctx, bytes, paths } = await run(hostileSource(
            async (localPath) => {
                await fs.mkdir(path.join(localPath, "live"));
                await fs.writeFile(path.join(localPath, "live", "cert1.pem"), "CERT");
            },
            () => [file("live/cert1.pem"), { ...file("live/cert.pem", 0), linkTarget: "cert1.pem" }],
        ));

        expect(paths.sort()).toEqual(["live/cert.pem", "live/cert1.pem"]);
        expect(bytes.includes("CERT")).toBe(true);
        expect(ctx.status).toBe("Running");
    });
});
