/**
 * A job that backs up databases only writes the same seekable archive as every other job, with
 * one entry per database. That is what lets a restore or download of one database read only
 * that database's bytes, instead of a whole server's worth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { stepInitialize } from '@/lib/runner/steps/01-initialize';
import { stepExecuteDump } from '@/lib/runner/steps/02-dump';
import { readArchiveManifest, readArchiveIndex, openArchiveEntry } from '@/lib/archive/reader';
import { localFileSource, readAll } from '@/lib/archive/sources';
import { entryKey } from '@/lib/archive/types';
import type { RunnerContext } from '@/lib/runner/types';

vi.mock('@/lib/adapters', () => ({ registerAdapters: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
    default: {
        job: { findUnique: vi.fn() },
        execution: { create: vi.fn() },
        systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
        namingTemplate: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
        retentionPolicy: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    },
}));

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn(), register: vi.fn() },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn(async (config: unknown) => ({ ...(config as Record<string, unknown>) })),
}));

vi.mock('@/lib/logging/logger', () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));
vi.mock('@/lib/logging/errors', () => ({ wrapError: vi.fn((e) => e) }));

const planChainMock = vi.fn();
vi.mock('@/services/backup/chain-planner', () => ({
    planChain: (...args: unknown[]) => planChainMock(...args),
}));

function makeCtx(): RunnerContext {
    return {
        jobId: 'job-1',
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        destinations: [],
        status: 'Running',
        startedAt: new Date(),
    } as unknown as RunnerContext;
}

const createdFiles: string[] = [];
afterEach(async () => {
    for (const f of createdFiles.splice(0)) {
        await fs.rm(f, { recursive: true, force: true }).catch(() => {});
    }
});

async function runDbOnlyJob(job: Record<string, unknown>, adapter: Record<string, unknown>) {
    const prisma = (await import('@/lib/prisma')).default;
    const { registry } = await import('@/lib/core/registry');

    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'job-1', name: 'DB Only Job', pgCompression: undefined, namingTemplateId: null, compression: 'GZIP',
        source: { id: 'src-1', adapterId: 'mysql', config: '{}', name: 'My MySQL', type: 'database' },
        destinations: [{ id: 'dest-1', configId: 'cfg-1', priority: 0, retention: '{}', retentionPolicyId: null, config: { id: 'cfg-1', adapterId: 'local-filesystem', config: '{}', name: 'Local', type: 'storage' } }],
        sources: [],
        notifications: [], notificationEvents: 'ALWAYS', notificationTemplates: [],
        ...job,
    });
    (prisma.execution.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'exec-1' });
    (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === 'mysql') return adapter;
        if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
        return null;
    });

    const ctx = makeCtx();
    await stepInitialize(ctx);
    await stepExecuteDump(ctx);
    createdFiles.push(ctx.tempFile!, ctx.indexFile!);
    return ctx;
}

function fakeMysql(overrides: Record<string, unknown> = {}) {
    return {
        id: 'mysql',
        type: 'database',
        dump: vi.fn(),
        dumpOne: vi.fn(async (_config: unknown, dbName: string, destinationPath: string) => {
            await fs.writeFile(destinationPath, `-- dump of ${dbName}\n`.repeat(20));
            return { size: 1 };
        }),
        test: vi.fn().mockResolvedValue({ success: true, version: '8.0.32' }),
        ...overrides,
    };
}

describe('a job that backs up databases only', () => {
    beforeEach(() => vi.clearAllMocks());

    it('writes a seekable archive with one entry per database', async () => {
        const adapter = fakeMysql();
        const ctx = await runDbOnlyJob({ databases: '["shop","blog"]' }, adapter);

        expect(adapter.dump).not.toHaveBeenCalled();
        expect(adapter.dumpOne).toHaveBeenCalledTimes(2);
        expect(ctx.tempFile!.endsWith('.tar')).toBe(true);
        await expect(fs.access(ctx.indexFile!)).resolves.toBeUndefined();

        const source = await localFileSource(ctx.tempFile!);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest);
        expect(manifest.counts).toMatchObject({ databases: 2, directorySources: 0 });
        expect(index.databases.map((d) => d.name)).toEqual(['shop', 'blog']);

        const blog = index.databases[1];
        const entry = index.entries.get(entryKey(undefined, blog.n))!;
        expect((await readAll(await openArchiveEntry(source, manifest, entry))).toString()).toContain('-- dump of blog');

        expect(ctx.metadata.archive).toMatchObject({ formatVersion: 2, indexFile: '.index' });
        expect(ctx.metadata.combined).toBeUndefined();
        expect(ctx.metadata.names).toEqual(['shop', 'blog']);
        expect(ctx.metadata.label).toBe('2 DBs');
        expect(ctx.dumpSize).toBe((await fs.stat(ctx.tempFile!)).size);
    });

    it('never builds an incremental chain, even with a stale incremental mode stored on the job', async () => {
        const ctx = await runDbOnlyJob({ databases: '["shop"]', backupMode: 'INCREMENTAL' }, fakeMysql());

        expect(planChainMock).not.toHaveBeenCalled();
        expect(ctx.chain).toBeUndefined();
        const source = await localFileSource(ctx.tempFile!);
        expect((await readArchiveManifest(source)).chain).toBeUndefined();
        expect(ctx.metadata.label).toBe('Single DB');
    });

    it('stores a snapshot that holds every logical database once, for adapters that cannot split it', async () => {
        const adapter = fakeMysql({ listDumpEntries: vi.fn().mockResolvedValue(['dump']) });
        const ctx = await runDbOnlyJob({ databases: '["0","1","2"]' }, adapter);

        expect(adapter.dumpOne).toHaveBeenCalledTimes(1);
        expect(ctx.metadata.names).toEqual(['dump']);
    });

    it('leaves the dumps inside its own work directory whatever a database is called', async () => {
        const seen: string[] = [];
        const adapter = fakeMysql({
            dumpOne: vi.fn(async (_config: unknown, _dbName: string, destinationPath: string) => {
                seen.push(destinationPath);
                await fs.writeFile(destinationPath, 'x');
                return { size: 1 };
            }),
        });
        await runDbOnlyJob({ databases: '["../../escaped"]' }, adapter);

        expect(path.basename(seen[0])).toBe('0001.sql');
        expect(path.basename(path.dirname(seen[0]))).toBe('databases');
    });

    it('removes each raw dump once it is in the archive', async () => {
        const seen: string[] = [];
        const adapter = fakeMysql({
            dumpOne: vi.fn(async (_config: unknown, dbName: string, destinationPath: string) => {
                seen.push(destinationPath);
                await fs.writeFile(destinationPath, dbName);
                return { size: 1 };
            }),
        });
        await runDbOnlyJob({ databases: '["shop","blog"]' }, adapter);

        for (const dump of seen) {
            await expect(fs.access(dump)).rejects.toThrow();
        }
    });

    it('drops --all-databases from the source options, since every database is dumped on its own', async () => {
        const adapter = fakeMysql();
        const ctx = await runDbOnlyJob({
            databases: '["shop"]',
            source: { id: 'src-1', adapterId: 'mysql', config: '{}', name: 'My MySQL', type: 'database', options: '--single-transaction --all-databases' },
        }, adapter);

        const config = adapter.dumpOne.mock.calls[0][0] as { options?: string };
        expect(config.options).toBe('--single-transaction');
        expect((ctx.log as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes('--all-databases'))).toBe(true);
    });

    it('fails clearly when there is nothing to back up', async () => {
        const adapter = fakeMysql({ getDatabases: vi.fn().mockResolvedValue([]) });

        await expect(runDbOnlyJob({ databases: '[]' }, adapter)).rejects.toThrow(/No databases found to back up/);
    });

    it('asks for an explicit selection when the backup user may not list databases', async () => {
        // A least-privilege MongoDB user without listDatabases. Every database is dumped by
        // name, so there is nothing to fall back to.
        const adapter = fakeMysql({ getDatabases: vi.fn().mockRejectedValue(new Error('not authorized on admin to execute command listDatabases')) });

        await expect(runDbOnlyJob({ databases: '[]' }, adapter))
            .rejects.toThrow(/Could not list the databases on this server \(not authorized.*\)\. Select the databases to back up in the job/);
        expect(adapter.dumpOne).not.toHaveBeenCalled();
    });
});
