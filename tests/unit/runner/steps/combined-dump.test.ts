import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { executeCombinedDump } from '@/lib/runner/steps/combined-dump';
import { createTempDir, cleanupTempDir } from '@/lib/adapters/database/common/tar-utils';
import { extractArchive } from '@/lib/archive/extract';
import { readArchiveManifest, readArchiveIndex } from '@/lib/archive/reader';
import { localFileSource } from '@/lib/archive/sources';
import type { RunnerContext, DirectorySourceContext, JobWithRelations } from '@/lib/runner/types';
import type { DatabaseAdapter, StorageAdapter, DirectoryDownloadResult } from '@/lib/core/interfaces';

vi.mock('@/lib/prisma', () => ({
    default: {
        systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
        namingTemplate: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
    },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn(async (config: unknown) => ({ ...(config as Record<string, unknown>) })),
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@/lib/logging/errors', () => ({
    wrapError: vi.fn((e) => e),
}));

// --- Helpers ---

function makeCtx(overrides: Partial<RunnerContext> = {}): RunnerContext {
    return {
        jobId: 'job-1',
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        destinations: [],
        sources: [],
        status: 'Running',
        startedAt: new Date(),
        ...overrides,
    } as unknown as RunnerContext;
}

function makeJob(overrides: Record<string, unknown> = {}): JobWithRelations {
    return {
        id: 'job-1',
        name: 'Combined Job',
        databases: '[]',
        pgCompression: undefined,
        namingTemplateId: null,
        source: {
            id: 'src-1', adapterId: 'mysql', config: '{}', name: 'My MySQL', type: 'database',
        },
        ...overrides,
    } as unknown as JobWithRelations;
}

/** A fake DatabaseAdapter whose dumpOne() writes deterministic fake content per database. */
function makeFakeDbAdapter(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
    return {
        id: 'mysql',
        type: 'database',
        name: 'Fake MySQL',
        configSchema: {} as never,
        dump: vi.fn(),
        restore: vi.fn(),
        dumpOne: vi.fn(async (_config: unknown, dbName: string, destinationPath: string) => {
            await fs.mkdir(path.dirname(destinationPath), { recursive: true });
            await fs.writeFile(destinationPath, `-- dump of ${dbName}`);
            return { size: Buffer.byteLength(`-- dump of ${dbName}`) };
        }),
        test: vi.fn().mockResolvedValue({ success: true, version: '8.0.32' }),
        ...overrides,
    } as unknown as DatabaseAdapter;
}

/** A fake StorageAdapter whose downloadDirectory() writes deterministic fake files. */
function makeFakeStorageAdapter(files: Record<string, string>): StorageAdapter {
    return {
        id: 'sftp',
        type: 'storage',
        name: 'Fake SFTP',
        configSchema: {} as never,
        upload: vi.fn(),
        download: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        downloadDirectory: vi.fn(async (_config: unknown, _remotePath: string, localPath: string): Promise<DirectoryDownloadResult> => {
            const entries = [];
            for (const [relPath, content] of Object.entries(files)) {
                const abs = path.join(localPath, relPath);
                await fs.mkdir(path.dirname(abs), { recursive: true });
                await fs.writeFile(abs, content);
                entries.push({ relativePath: relPath, size: Buffer.byteLength(content), lastModified: new Date('2026-01-01') });
            }
            return { files: entries.length, bytes: entries.reduce((s, e) => s + e.size, 0), entries };
        }),
    } as unknown as StorageAdapter;
}

function makeDirectorySource(overrides: Partial<DirectorySourceContext> = {}): DirectorySourceContext {
    return {
        jobSourceId: 'jsrc-1',
        configId: 'storage-1',
        configName: 'SFTP Server',
        adapter: makeFakeStorageAdapter({ 'a.txt': 'AAAA' }),
        config: {},
        remotePath: '/data',
        excludePatterns: [],
        priority: 0,
        ...overrides,
    };
}

// Cleanup: track and remove any leftover combined-dump-* temp directories this test creates.
const createdTempFiles: string[] = [];
afterEach(async () => {
    for (const f of createdTempFiles.splice(0)) {
        await fs.rm(f, { recursive: true, force: true }).catch(() => {});
    }
});

describe('executeCombinedDump', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('combines multiple database dumps and a directory source into one v2 archive', async () => {
        const dbAdapter = makeFakeDbAdapter();
        const dirSource = makeDirectorySource({
            adapter: makeFakeStorageAdapter({ 'a.txt': 'AAAA', 'sub/b.txt': 'BBBBB' }),
        });
        const ctx = makeCtx({
            sourceAdapter: dbAdapter,
            sources: [dirSource],
            job: makeJob({ databases: JSON.stringify(['db1', 'db2']) }),
        });

        await executeCombinedDump(ctx);
        createdTempFiles.push(ctx.tempFile!);

        expect(ctx.tempFile).toMatch(/\.tar$/);
        const exists = await fs.access(ctx.tempFile!).then(() => true).catch(() => false);
        expect(exists).toBe(true);

        const source = await localFileSource(ctx.tempFile!);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest);
        expect(manifest.version).toBe(2);
        expect(manifest.sourceType).toBe('mysql');
        expect(index.databases).toHaveLength(2);
        expect(index.directories).toHaveLength(1);

        expect(ctx.dumpSize).toBeGreaterThan(0);
        expect(ctx.metadata.combined).toEqual({ databases: 2, directorySources: 1 });
        expect(dbAdapter.dumpOne).toHaveBeenCalledTimes(2);

        // Round-trip: the actual dumped/downloaded content survives extraction untouched.
        const extractDir = path.join(path.dirname(ctx.tempFile!), `extract-${Date.now()}`);
        createdTempFiles.push(extractDir);
        const result = await extractArchive(ctx.tempFile!, extractDir);
        expect(result.databaseFiles).toHaveLength(2);
        expect(result.directoryRoots).toHaveLength(1);
        const dumpedDb1 = result.databaseFiles.find((f) => f.entry.name === 'db1')!;
        expect(await fs.readFile(dumpedDb1.path, 'utf-8')).toBe('-- dump of db1');
        const dirRoot = result.directoryRoots[0].path;
        expect(await fs.readFile(path.join(dirRoot, 'sub/b.txt'), 'utf-8')).toBe('BBBBB');
    });

    it('records a SHA-256 checksum of every directory-source file in the archive index', async () => {
        const ctx = makeCtx({
            sourceAdapter: undefined,
            sources: [makeDirectorySource({ adapter: makeFakeStorageAdapter({ 'a.txt': 'AAAA', 'sub/b.txt': 'BBBBB' }) })],
            job: makeJob({ source: null }),
        });

        await executeCombinedDump(ctx);
        createdTempFiles.push(ctx.tempFile!);

        const source = await localFileSource(ctx.tempFile!);
        const index = await readArchiveIndex(source, await readArchiveManifest(source));

        const crypto = await import('crypto');
        const expectedA = crypto.createHash('sha256').update('AAAA').digest('hex');
        const expectedB = crypto.createHash('sha256').update('BBBBB').digest('hex');

        expect(index.files.find((e) => e.p === 'a.txt')?.h).toBe(expectedA);
        expect(index.files.find((e) => e.p === 'sub/b.txt')?.h).toBe(expectedB);
    });

    it('writes an index sidecar that matches the archive and is cleaned up afterwards', async () => {
        const ctx = makeCtx({
            sourceAdapter: undefined,
            sources: [makeDirectorySource({ adapter: makeFakeStorageAdapter({ 'a.txt': 'AAAA' }) })],
            job: makeJob({ source: null }),
        });

        await executeCombinedDump(ctx);
        createdTempFiles.push(ctx.tempFile!);

        // The sidecar is what browsing and file-level restore read instead of the archive,
        // so it has to exist next to the archive and describe the same content.
        expect(ctx.indexFile).toBe(ctx.tempFile! + '.index');
        createdTempFiles.push(ctx.indexFile!);

        const sidecarBytes = await fs.readFile(ctx.indexFile!);
        const source = await localFileSource(ctx.tempFile!);
        const manifest = await readArchiveManifest(source);
        const fromSidecar = await readArchiveIndex(source, manifest, { sidecarBytes });
        const fromArchive = await readArchiveIndex(source, manifest);

        expect(fromSidecar.files.map((f) => f.p)).toEqual(fromArchive.files.map((f) => f.p));
        expect(ctx.metadata.archive).toMatchObject({ formatVersion: 2, indexFile: '.index', encrypted: false, files: 1 });
    });

    it('supports a directory-only job with no database source', async () => {
        const ctx = makeCtx({
            sourceAdapter: undefined,
            sources: [makeDirectorySource()],
            job: makeJob({ source: null }),
        });

        await executeCombinedDump(ctx);
        createdTempFiles.push(ctx.tempFile!);

        const source = await localFileSource(ctx.tempFile!);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest);
        expect(manifest.sourceType).toBe('directory-only');
        expect(index.databases).toHaveLength(0);
        expect(index.directories).toHaveLength(1);
        expect(ctx.metadata.combined).toEqual({ databases: 0, directorySources: 1 });
    });

    it('auto-discovers databases when the job has none explicitly selected', async () => {
        const dbAdapter = makeFakeDbAdapter({ getDatabases: vi.fn().mockResolvedValue(['auto1', 'auto2']) });
        const ctx = makeCtx({
            sourceAdapter: dbAdapter,
            sources: [makeDirectorySource()],
            job: makeJob({ databases: '[]' }),
        });

        await executeCombinedDump(ctx);
        createdTempFiles.push(ctx.tempFile!);

        expect(dbAdapter.dumpOne).toHaveBeenCalledTimes(2);
        expect(dbAdapter.dumpOne).toHaveBeenCalledWith(expect.anything(), 'auto1', expect.any(String), expect.any(Function));
        expect(dbAdapter.dumpOne).toHaveBeenCalledWith(expect.anything(), 'auto2', expect.any(String), expect.any(Function));
    });

    it('throws when the database adapter does not support combined backups (no dumpOne)', async () => {
        const dbAdapter = makeFakeDbAdapter({ dumpOne: undefined });
        const ctx = makeCtx({
            sourceAdapter: dbAdapter,
            sources: [makeDirectorySource()],
            job: makeJob({ databases: JSON.stringify(['db1']) }),
        });

        await expect(executeCombinedDump(ctx)).rejects.toThrow('does not support combined backups with directory sources');
    });

    it('throws when no databases are found and none are configured', async () => {
        const dbAdapter = makeFakeDbAdapter({ getDatabases: vi.fn().mockResolvedValue([]) });
        const ctx = makeCtx({
            sourceAdapter: dbAdapter,
            sources: [makeDirectorySource()],
            job: makeJob({ databases: '[]' }),
        });

        await expect(executeCombinedDump(ctx)).rejects.toThrow('No databases found to back up');
    });

    it('cleans up its working temp directory after completion', async () => {
        const tempRoot = await createTempDir('combined-dump-scan-');
        createdTempFiles.push(tempRoot);
        const before = await fs.readdir(path.dirname(tempRoot));
        const combinedDirsBefore = before.filter((n) => n.startsWith('combined-dump-')).length;

        const ctx = makeCtx({
            sourceAdapter: makeFakeDbAdapter(),
            sources: [makeDirectorySource()],
            job: makeJob({ databases: JSON.stringify(['db1']) }),
        });
        await executeCombinedDump(ctx);
        createdTempFiles.push(ctx.tempFile!);

        const after = await fs.readdir(path.dirname(tempRoot));
        const combinedDirsAfter = after.filter((n) => n.startsWith('combined-dump-')).length;
        expect(combinedDirsAfter).toBe(combinedDirsBefore);

        await cleanupTempDir(tempRoot);
    });
});
