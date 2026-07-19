import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { registry } from '@/lib/core/registry';
import { restoreCombinedArchive } from '@/services/restore/combined-restore';
import { createCombinedTar, createTempDir, createMultiDbTar } from '@/lib/adapters/database/common/tar-utils';
import type { CombinedTarFileEntry, DirectoryFileIndexEntry } from '@/lib/adapters/database/common/types';
import type { RestoreInput } from '@/services/restore/types';

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn() },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn(async (config: unknown) => ({ ...(config as Record<string, unknown>) })),
}));

const dbTargetConfig = {
    id: 'target-db-1', adapterId: 'mysql', type: 'database', name: 'Target MySQL', config: '{}',
    createdAt: new Date(), updatedAt: new Date(),
};

const storageTargetConfig = {
    id: 'target-storage-1', adapterId: 'local-filesystem', type: 'storage', name: 'Local Restore Target', config: '{}',
    createdAt: new Date(), updatedAt: new Date(),
};

function makeFakeDbAdapter(overrides: Record<string, any> = {}) {
    return {
        id: 'mysql',
        type: 'database',
        restoreOne: vi.fn().mockResolvedValue(undefined),
        prepareRestore: vi.fn().mockResolvedValue(undefined),
        test: vi.fn().mockResolvedValue({ success: true, version: '8.0' }),
        ...overrides,
    };
}

function makeFakeStorageAdapter(overrides: Record<string, any> = {}) {
    return {
        id: 'local-filesystem',
        type: 'storage',
        upload: vi.fn().mockResolvedValue(true),
        ...overrides,
    };
}

const createdPaths: string[] = [];
afterEach(async () => {
    for (const p of createdPaths.splice(0)) {
        await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
});

/**
 * Builds a real synthetic v2 archive: `dbNames.length` databases, plus one directory entry
 * ("src-1") when `dirFiles` is given (omit entirely to build a pure-database archive).
 */
async function buildCombinedArchive(dbNames: string[], dirFiles?: Record<string, string>) {
    const workDir = await createTempDir('combined-restore-test-work-');
    createdPaths.push(workDir);

    const entries: CombinedTarFileEntry[] = [];
    for (const dbName of dbNames) {
        const p = path.join(workDir, `${dbName}.sql`);
        await fs.writeFile(p, `-- dump of ${dbName}`);
        entries.push({ kind: 'database', dbName, path: p, format: 'sql' });
    }

    if (dirFiles) {
        const dirLocalPath = path.join(workDir, 'dirsrc');
        const index: DirectoryFileIndexEntry[] = [];
        for (const [relPath, content] of Object.entries(dirFiles)) {
            const abs = path.join(dirLocalPath, relPath);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, content);
            index.push({ path: relPath, size: Buffer.byteLength(content), mtime: new Date('2026-01-01').toISOString() });
        }
        entries.push({ kind: 'directory', jobSourceId: 'src-1', label: 'Test Directory', localPath: dirLocalPath, excludePatterns: [], files: index });
    }

    const tarPath = path.join(workDir, 'archive.tar');
    await createCombinedTar(entries, tarPath, { sourceType: dbNames.length > 0 ? 'mysql' : 'directory-only' });
    return { tarPath, workDir };
}

function makeInput(overrides: Partial<RestoreInput> = {}): RestoreInput {
    return {
        storageConfigId: 'storage-source-1',
        file: 'backup.tar',
        ...overrides,
    };
}

describe('restoreCombinedArchive', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores selected databases and directories successfully', async () => {
        const { tarPath } = await buildCombinedArchive(['db1', 'db2'], { 'a.txt': 'AAAA' });
        const dbAdapter = makeFakeDbAdapter();
        const storageAdapter = makeFakeStorageAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(dbTargetConfig as any)
            .mockResolvedValueOnce(storageTargetConfig as any);
        vi.mocked(registry.get).mockImplementation((id: string) => {
            if (id === 'mysql') return dbAdapter as any;
            if (id === 'local-filesystem') return storageAdapter as any;
            return undefined as any;
        });

        const result = await restoreCombinedArchive(tarPath, makeInput({
            targetSourceId: 'target-db-1',
            databaseMapping: [
                { originalName: 'db1', targetName: 'db1_restored', selected: true },
                { originalName: 'db2', targetName: 'db2', selected: true },
            ],
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn() });

        expect(result.status).toBe('Success');
        expect(result.restoredDatabases.sort()).toEqual(['db1_restored', 'db2']);
        expect(result.restoredDirectories).toEqual(['src-1']);
        expect(dbAdapter.prepareRestore).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['db1_restored', 'db2']));
        expect(dbAdapter.restoreOne).toHaveBeenCalledTimes(2);
        expect(storageAdapter.upload).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('a.txt'), '/restore/dir/a.txt');
    });

    it('restores every entry when no mapping is provided at all (default select-all)', async () => {
        const { tarPath } = await buildCombinedArchive(['db1'], { 'a.txt': 'AAAA' });
        const dbAdapter = makeFakeDbAdapter();
        const storageAdapter = makeFakeStorageAdapter();

        prismaMock.adapterConfig.findUnique
            .mockResolvedValueOnce(dbTargetConfig as any)
            .mockResolvedValueOnce(storageTargetConfig as any);
        vi.mocked(registry.get).mockImplementation((id: string) => (id === 'mysql' ? dbAdapter : storageAdapter) as any);

        const result = await restoreCombinedArchive(tarPath, makeInput({
            targetSourceId: 'target-db-1',
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn() });

        expect(result.status).toBe('Success');
        expect(result.restoredDatabases).toEqual(['db1']);
    });

    it('returns Partial when one database entry fails and the rest succeed', async () => {
        const { tarPath } = await buildCombinedArchive(['db1', 'db2']);
        const dbAdapter = makeFakeDbAdapter({
            restoreOne: vi.fn()
                .mockRejectedValueOnce(new Error('disk full'))
                .mockResolvedValueOnce(undefined),
        });

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(dbTargetConfig as any);
        vi.mocked(registry.get).mockReturnValue(dbAdapter as any);

        const result = await restoreCombinedArchive(tarPath, makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn() });

        expect(result.status).toBe('Partial');
        expect(result.restoredDatabases).toHaveLength(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].error).toContain('disk full');
    });

    it('returns Failed when nothing could be restored', async () => {
        const { tarPath } = await buildCombinedArchive(['db1']);
        const dbAdapter = makeFakeDbAdapter({ restoreOne: vi.fn().mockRejectedValue(new Error('connection refused')) });

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(dbTargetConfig as any);
        vi.mocked(registry.get).mockReturnValue(dbAdapter as any);

        const result = await restoreCombinedArchive(tarPath, makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn() });

        expect(result.status).toBe('Failed');
        expect(result.restoredDatabases).toHaveLength(0);
    });

    it('restores a directory-only archive without requiring targetSourceId', async () => {
        const { tarPath } = await buildCombinedArchive([], { 'config.yml': 'key: value' });
        const storageAdapter = makeFakeStorageAdapter();

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(storageTargetConfig as any);
        vi.mocked(registry.get).mockReturnValue(storageAdapter as any);

        const result = await restoreCombinedArchive(tarPath, makeInput({
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn() });

        expect(result.status).toBe('Success');
        expect(result.restoredDirectories).toEqual(['src-1']);
    });

    it('throws when the archive has database entries selected but no targetSourceId is given', async () => {
        const { tarPath } = await buildCombinedArchive(['db1'], { 'a.txt': 'A' });

        await expect(
            restoreCombinedArchive(tarPath, makeInput({
                directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
            }), { log: vi.fn(), updateDetail: vi.fn() })
        ).rejects.toThrow('Missing targetSourceId');
    });

    it('throws when the target database adapter does not support combined restores', async () => {
        const { tarPath } = await buildCombinedArchive(['db1']);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(dbTargetConfig as any);
        vi.mocked(registry.get).mockReturnValue({ id: 'mysql', type: 'database' } as any); // no restoreOne

        await expect(
            restoreCombinedArchive(tarPath, makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn() })
        ).rejects.toThrow('does not support combined restores');
    });

    it('throws when the archive does not contain a valid v2 manifest', async () => {
        const workDir = await createTempDir('combined-restore-v1-check-');
        createdPaths.push(workDir);
        const dbFile = path.join(workDir, 'db1.sql');
        await fs.writeFile(dbFile, 'x');
        const v1TarPath = path.join(workDir, 'v1.tar');
        await createMultiDbTar([{ name: 'db1.sql', path: dbFile, dbName: 'db1', format: 'sql' }], v1TarPath, { sourceType: 'mysql' });

        await expect(
            restoreCombinedArchive(v1TarPath, makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn() })
        ).rejects.toThrow('does not contain a valid combined');
    });

    it('records an error (Partial) for a directory entry with no restore target specified', async () => {
        const { tarPath } = await buildCombinedArchive(['db1'], { 'a.txt': 'A' });
        const dbAdapter = makeFakeDbAdapter();

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(dbTargetConfig as any);
        vi.mocked(registry.get).mockReturnValue(dbAdapter as any);

        const result = await restoreCombinedArchive(tarPath, makeInput({
            targetSourceId: 'target-db-1',
            directoryMapping: [{ entryId: 'src-1', targetConfigId: '', targetPath: '', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn() });

        expect(result.status).toBe('Partial');
        expect(result.restoredDatabases).toEqual(['db1']);
        expect(result.restoredDirectories).toHaveLength(0);
        expect(result.errors.some((e) => e.error.includes('No restore target specified'))).toBe(true);
    });
});
