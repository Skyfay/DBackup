/**
 * Regression test: a DB-only job (no JobSource rows) must keep producing a plain v1
 * multi-DB archive through the UNCHANGED 01-initialize.ts -> 02-dump.ts path, never routing
 * through the new combined-dump.ts path. This is the single most important compatibility
 * guarantee of the JobSource feature - asserted explicitly here, not just assumed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { stepInitialize } from '@/lib/runner/steps/01-initialize';
import { stepExecuteDump } from '@/lib/runner/steps/02-dump';
import { readManifestVersion, extractSelectedDatabases, createMultiDbTar, createTempDir, cleanupTempDir } from '@/lib/adapters/database/common/tar-utils';
import type { RunnerContext } from '@/lib/runner/types';
import type { TarFileEntry } from '@/lib/adapters/database/common/types';

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

const mockExecuteCombinedDump = vi.fn();
vi.mock('@/lib/runner/steps/combined-dump', () => ({
    executeCombinedDump: (...args: unknown[]) => mockExecuteCombinedDump(...args),
}));

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
        status: 'Running',
        startedAt: new Date(),
        ...overrides,
    } as unknown as RunnerContext;
}

const createdTempFiles: string[] = [];
afterEach(async () => {
    for (const f of createdTempFiles.splice(0)) {
        await fs.rm(f, { recursive: true, force: true }).catch(() => {});
    }
});

describe('DB-only job (no JobSource rows) - version:1 regression', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolves ctx.sources to an empty array and never invokes executeCombinedDump', async () => {
        const prisma = (await import('@/lib/prisma')).default;
        const { registry } = await import('@/lib/core/registry');

        (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
            id: 'job-1', name: 'DB Only Job', databases: '["db1","db2"]', pgCompression: undefined, namingTemplateId: null,
            source: { id: 'src-1', adapterId: 'mysql', config: '{}', name: 'My MySQL', type: 'database' },
            destinations: [{ id: 'dest-1', configId: 'cfg-1', priority: 0, retention: '{}', retentionPolicyId: null, config: { id: 'cfg-1', adapterId: 'local-filesystem', config: '{}', name: 'Local', type: 'storage' } }],
            sources: [], // <- no JobSource rows: this is the case being guarded
            notifications: [], notificationEvents: 'ALWAYS', notificationTemplates: [],
        });
        (prisma.execution.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'exec-1' });

        // A real adapter.dump() implementation using the real (unmocked) createMultiDbTar -
        // exactly what mysql/postgres/mongodb/firebird's own dump() does internally today.
        const tempWorkDir = await createTempDir('regression-work-');
        createdTempFiles.push(tempWorkDir);
        const dumpFn = vi.fn(async (config: { database: string[] }, destinationPath: string) => {
            const dbFiles: TarFileEntry[] = [];
            for (const dbName of config.database) {
                const p = path.join(tempWorkDir, `${dbName}.sql`);
                await fs.writeFile(p, `-- dump of ${dbName}`);
                dbFiles.push({ name: `${dbName}.sql`, path: p, dbName, format: 'sql' });
            }
            const manifest = await createMultiDbTar(dbFiles, destinationPath, { sourceType: 'mysql', engineVersion: '8.0.32' });
            return { success: true, path: destinationPath, size: manifest.totalSize, logs: [], startedAt: new Date(), completedAt: new Date() };
        });

        (registry.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
            if (id === 'mysql') return { type: 'database', dump: dumpFn, test: vi.fn().mockResolvedValue({ success: true, version: '8.0.32' }), getDatabases: vi.fn() };
            if (id === 'local-filesystem') return { type: 'storage', upload: vi.fn() };
            return null;
        });

        const ctx = makeCtx();
        await stepInitialize(ctx);

        expect(ctx.sources).toEqual([]);
        expect(ctx.sourceAdapter).toBeDefined();

        await stepExecuteDump(ctx);
        createdTempFiles.push(ctx.tempFile!);

        // The new combined path must never be reached for a DB-only job.
        expect(mockExecuteCombinedDump).not.toHaveBeenCalled();
        // The unchanged path was actually exercised (adapter.dump(), not dumpOne()).
        expect(dumpFn).toHaveBeenCalledTimes(1);

        // The produced archive is - and remains - a plain v1 multi-DB manifest.
        const version = await readManifestVersion(ctx.tempFile!);
        expect(version).toBe(1);

        const extractDir = path.join(tempWorkDir, 'extract');
        const result = await extractSelectedDatabases(ctx.tempFile!, extractDir, []);
        expect(result.manifest.databases).toHaveLength(2);
        expect(result.manifest.databases.map((d) => d.name).sort()).toEqual(['db1', 'db2']);
    });
});
