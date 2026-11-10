import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { Readable } from 'stream';
import { createReadStream } from 'fs';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { registry } from '@/lib/core/registry';
import { restoreArchiveSnapshot } from '@/services/restore/archive-restore';
import { createRestoreTracker } from '@/services/restore/restore-record';
import { createTempDir } from '@/lib/adapters/database/common/tar-utils';
import { createArchive } from '@/lib/archive/writer';
import type { ArchiveSourceEntry, SourceFileEntry } from '@/lib/archive/types';
import type { RestoreInput } from '@/services/restore/types';
import type { StorageAdapter } from '@/lib/core/interfaces';

vi.mock('@/lib/core/registry', () => ({
    registry: { get: vi.fn() },
}));

// The check of customers' databases runs against a real database in restore-customer-databases.test.ts.
const confirmTargets = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock('@/services/restore/customer-databases', () => ({ assertTargetsConfirmed: confirmTargets }));

vi.mock('@/lib/adapters/config-resolver', () => ({
    // Mirrors the real resolver: it takes the stored adapter row and hands back the parsed
    // config, not the row. Spreading the row instead hid every config value one level down.
    resolveAdapterConfig: vi.fn(async (adapter: unknown) => {
        const row = adapter as { config?: string };
        return typeof row?.config === "string" ? JSON.parse(row.config) : { ...(adapter as Record<string, unknown>) };
    }),
}));

const sourceStorageConfig = {
    id: 'storage-source-1', adapterId: 'source-fs', type: 'storage', name: 'Backup Storage', config: '{}',
    createdAt: new Date(), updatedAt: new Date(),
};

const dbTargetConfig = {
    id: 'target-db-1', adapterId: 'mysql', type: 'database', name: 'Target MySQL', config: '{}',
    createdAt: new Date(), updatedAt: new Date(),
};

// Mutated by the concurrency tests, reset in beforeEach.
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

/** Counters exposing what the restore actually transferred from the backup storage. */
interface SourceTraffic {
    /** [start, end] of every ranged read. */
    ranges: [number, number][];
    /** Full downloads of the archive itself (not sidecars). */
    archiveDownloads: number;
}

/**
 * Fake adapter serving the backup the way a real destination does: `.meta.json` via
 * read(), the `.index` sidecar via download(), archive bytes via ranged reads. This is
 * what lets the tests assert byte-level efficiency, not just correctness.
 */
function makeSourceStorageAdapter(workDir: string, traffic: SourceTraffic): StorageAdapter {
    return {
        id: 'source-fs', type: 'storage', name: 'Source', configSchema: {} as never,
        upload: vi.fn(), delete: vi.fn(), test: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        read: async (_c: unknown, remotePath: string) =>
            remotePath.endsWith('.meta.json')
                ? await fs.readFile(path.join(workDir, remotePath), 'utf-8').catch(() => null)
                : null,
        download: async (_c: unknown, remotePath: string, localPath: string) => {
            try {
                await fs.copyFile(path.join(workDir, remotePath), localPath);
            } catch {
                return false;
            }
            if (remotePath.endsWith('.tar')) traffic.archiveDownloads++;
            return true;
        },
        downloadRange: async (_c: unknown, remotePath: string, start: number, end: number) => {
            traffic.ranges.push([start, end]);
            if (end < start) return Readable.from([]);
            return createReadStream(path.join(workDir, remotePath), { start, end });
        },
    } as unknown as StorageAdapter;
}

const createdPaths: string[] = [];
afterEach(async () => {
    for (const p of createdPaths.splice(0)) {
        await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
});

/**
 * Builds a real v2 archive plus its `.index` and `.meta.json` sidecars, laid out the way
 * the upload step leaves them on a destination.
 */
async function buildRemoteBackup(
    dbNames: string[],
    dirFiles?: Record<string, string>,
    /** POSIX metadata to record for every directory file, as a Docker volume source would. */
    dirMetadata?: { mode?: number; uid?: number; gid?: number },
    /** Symbolic links of the directory source, by path, with their targets. */
    dirLinks?: Record<string, string>,
) {
    const workDir = await createTempDir('archive-restore-test-');
    createdPaths.push(workDir);

    const entries: ArchiveSourceEntry[] = [];
    for (const dbName of dbNames) {
        const p = path.join(workDir, `${dbName}.sql`);
        await fs.writeFile(p, `-- dump of ${dbName}`);
        entries.push({ kind: 'database', dbName, path: p, format: 'sql' });
    }

    if (dirFiles) {
        const dirLocalPath = path.join(workDir, 'dirsrc');
        const index: SourceFileEntry[] = [];
        for (const [relPath, content] of Object.entries(dirFiles)) {
            const abs = path.join(dirLocalPath, relPath);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, content);
            index.push({
                path: relPath,
                size: Buffer.byteLength(content),
                mtime: new Date('2026-01-01').toISOString(),
                checksum: crypto.createHash('sha256').update(content).digest('hex'),
                ...dirMetadata,
            });
        }
        for (const [relPath, target] of Object.entries(dirLinks ?? {})) {
            index.push({ path: relPath, size: 0, mtime: new Date('2026-01-01').toISOString(), linkTarget: target });
        }
        entries.push({ kind: 'directory', jobSourceId: 'src-1', label: 'Test Directory', localPath: dirLocalPath, excludePatterns: [], files: index });
    }

    const tarPath = path.join(workDir, 'backup.tar');
    const { indexBytes } = await createArchive(entries, tarPath, { sourceType: dbNames.length > 0 ? 'mysql' : 'directory-only' });
    await fs.writeFile(tarPath + '.index', indexBytes);
    await fs.writeFile(tarPath + '.meta.json', JSON.stringify({
        version: 1,
        archive: { formatVersion: 2, indexFile: '.index', encrypted: false },
    }));

    const traffic: SourceTraffic = { ranges: [], archiveDownloads: 0 };
    const sourceAdapter = makeSourceStorageAdapter(workDir, traffic);
    const archiveSize = (await fs.stat(tarPath)).size;

    return { workDir, traffic, sourceAdapter, archiveSize };
}

function makeInput(overrides: Partial<RestoreInput> = {}): RestoreInput {
    return {
        storageConfigId: 'storage-source-1',
        file: 'backup.tar',
        ...overrides,
    };
}

/** Wires prisma + registry so lookups resolve by id instead of brittle call order. */
function wire(adapters: Record<string, unknown>) {
    prismaMock.adapterConfig.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => {
        if (where.id === 'storage-source-1') return sourceStorageConfig;
        if (where.id === 'target-db-1') return dbTargetConfig;
        if (where.id === 'target-storage-1') return storageTargetConfig;
        return null;
    }) as never);
    vi.mocked(registry.get).mockImplementation(((id: string) => adapters[id]) as never);
}

describe('restoreArchiveSnapshot', () => {
    beforeEach(() => {
        storageTargetConfig.config = '{}';
        vi.clearAllMocks();
        // No run of History wrote these backups, see `recorded-encryption.ts`.
        prismaMock.execution.findMany.mockResolvedValue([]);
    });

    it('restores selected databases and directories successfully', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['db1', 'db2'], { 'a.txt': 'AAAA' });
        const dbAdapter = makeFakeDbAdapter();
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            targetSourceId: 'target-db-1',
            databaseMapping: [
                { originalName: 'db1', targetName: 'db1_restored', selected: true },
                { originalName: 'db2', targetName: 'db2', selected: true },
            ],
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Success');
        expect(result.restoredDatabases.sort()).toEqual(['db1_restored', 'db2']);
        expect(result.restoredDirectories).toEqual(['src-1']);
        expect(dbAdapter.prepareRestore).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['db1_restored', 'db2']), expect.anything());
        expect(dbAdapter.restoreOne).toHaveBeenCalledTimes(2);
        expect(storageAdapter.upload).toHaveBeenCalledWith(expect.anything(), expect.any(String), '/restore/dir/a.txt', undefined, expect.any(Function), { restoreRelativePath: 'a.txt' });
    });

    it('lays no link whose target is absolute or climbs out of the folder it restores into, and says so in the log', async () => {
        const { sourceAdapter } = await buildRemoteBackup([], { 'conf/app.ini': 'ini' }, undefined, {
            'conf/db': '/app/data/db',
            'conf/up': '../../app/data',
            'conf/same': './app.ini',
        });
        const createSymlink = vi.fn().mockResolvedValue(undefined);
        const storageAdapter = makeFakeStorageAdapter({ createSymlink });
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });
        const log = vi.fn();

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true },
            ],
        }), { log, updateDetail: vi.fn(), setStage: vi.fn() });

        expect(createSymlink).toHaveBeenCalledTimes(1);
        expect(createSymlink).toHaveBeenCalledWith(expect.anything(), '/restore/dir/conf/same', './app.ini', { restoreRelativePath: 'conf/same' });
        expect(result.status).toBe('Partial');
        const lines = log.mock.calls.map((call) => String(call[0]));
        expect(lines).toContain("Symbolic link 'conf/db' -> '/app/data/db' was not restored: its target is absolute or leads out of the folder the restore writes into, so it was skipped.");
        expect(lines.some((line) => line.startsWith("Symbolic link 'conf/up' -> '../../app/data' was not restored"))).toBe(true);
    });

    it('writes and links nothing below a link of the same backup, and names each one in the log', async () => {
        const { sourceAdapter } = await buildRemoteBackup([], { 'x/ok.txt': 'o', 'x/y/f.txt': 'f' }, undefined, {
            'x/y': '..',
            'x/y/z': '..',
        });
        const createSymlink = vi.fn().mockResolvedValue(undefined);
        const storageAdapter = makeFakeStorageAdapter({ createSymlink });
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });
        const log = vi.fn();

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true },
            ],
        }), { log, updateDetail: vi.fn(), setStage: vi.fn() });

        expect(vi.mocked(storageAdapter.upload).mock.calls.map((call) => call[2])).toEqual(['/restore/dir/x/ok.txt']);
        expect(createSymlink.mock.calls.map((call) => call[1])).toEqual(['/restore/dir/x/y']);
        expect(result.status).toBe('Partial');
        const lines = log.mock.calls.map((call) => String(call[0]));
        expect(lines).toContain("'x/y/z' of 'Test Directory' was not restored: its path runs through a symbolic link of the same backup, which a real folder never holds, so it was skipped.");
        expect(lines.some((line) => line.startsWith("'x/y/f.txt' of 'Test Directory' was not restored"))).toBe(true);
    });

    it('hands the recorded permissions and owner to the place the backup read', async () => {
        // The end of the chain. A container volume restored without its mode and owner is
        // one a database will not start on, so the index has to reach upload().
        const { sourceAdapter } = await buildRemoteBackup([], { 'a.txt': 'AAAA' }, { mode: 0o600, uid: 1234, gid: 5678 });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });
        // The source the mapping names read this folder of the target.
        prismaMock.jobSource.findUnique.mockResolvedValueOnce({ configId: 'target-storage-1', path: '/restore/dir' } as never);

        await restoreArchiveSnapshot(makeInput({
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(storageAdapter.upload).toHaveBeenCalledWith(
            expect.anything(), expect.any(String), '/restore/dir/a.txt', undefined, expect.any(Function),
            { mode: 0o600, uid: 1234, gid: 5678, restoreRelativePath: 'a.txt' },
        );
    });

    it('hands the permission bits alone to any other place, never the owner or setuid', async () => {
        // The index comes from the destination, so its numbers never pick the owner of a file elsewhere.
        const { sourceAdapter } = await buildRemoteBackup([], { 'a.txt': 'AAAA' }, { mode: 0o4755, uid: 0, gid: 0 });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });
        prismaMock.jobSource.findUnique.mockResolvedValueOnce(null as never);

        await restoreArchiveSnapshot(makeInput({
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(storageAdapter.upload).toHaveBeenCalledWith(
            expect.anything(), expect.any(String), '/restore/dir/a.txt', undefined, expect.any(Function),
            { mode: 0o755, restoreRelativePath: 'a.txt' },
        );
    });

    it('passes no permissions when the archive recorded none, only the path below the folder of the restore', async () => {
        // Every archive written before these fields existed is in this case. A mode, owner or
        // group the archive never recorded would be a silent change in what every storage adapter sees.
        const { sourceAdapter } = await buildRemoteBackup([], { 'a.txt': 'AAAA' });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        await restoreArchiveSnapshot(makeInput({
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(storageAdapter.upload).toHaveBeenCalledWith(
            expect.anything(), expect.any(String), '/restore/dir/a.txt', undefined, expect.any(Function),
            { restoreRelativePath: 'a.txt' },
        );
    });

    /** Restores `a.txt` of a backup with `dirMetadata` and returns the mode of the staged file its upload saw. */
    async function stagedMode(dirMetadata?: { mode?: number }): Promise<{ folder: string; mode: number }> {
        const { sourceAdapter } = await buildRemoteBackup([], { 'a.txt': 'AAAA' }, dirMetadata);
        let seen = { folder: '', mode: 0 };
        const storageAdapter = makeFakeStorageAdapter({
            upload: vi.fn(async (_config: unknown, localPath: string) => {
                seen = { folder: path.basename(path.dirname(localPath)), mode: (await fs.stat(localPath)).mode & 0o777 };
                return true;
            }),
        });
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });
        prismaMock.jobSource.findUnique.mockResolvedValueOnce(null as never);

        await restoreArchiveSnapshot(makeInput({
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });
        return seen;
    }

    // An upload like rsync -a carries the mode of the staged file to the destination, so a staged
    // file is not 0600. The 0700 of the private folder keeps it from other users.
    it.skipIf(process.platform === 'win32')('stages a file with the mode the archive recorded for it, which rsync -a carries over', async () => {
        const seen = await stagedMode({ mode: 0o640 });
        expect(seen).toEqual({ folder: expect.stringMatching(/^dbackup-private-/), mode: 0o640 });
    });

    it.skipIf(process.platform === 'win32')('stages a file without a recorded mode with the default mode, not 0600', async () => {
        const seen = await stagedMode();
        // The mode a new file takes under the umask of this process.
        const plain = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dbackup-mode-')), 'plain');
        await fs.writeFile(plain, 'x');
        expect(seen.mode).toBe((await fs.stat(plain)).mode & 0o777);
        expect(seen.mode).not.toBe(0o600);
        await fs.rm(path.dirname(plain), { recursive: true, force: true });
    });

    it('sets the two restore stages according to what the snapshot holds', async () => {
        // A combined archive shows both, in order. The complaint that started this was a
        // file-only restore still reporting "Restoring Databases".
        const { sourceAdapter } = await buildRemoteBackup(['db1'], { 'a.txt': 'AAAA' });
        const dbAdapter = makeFakeDbAdapter();
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter, 'local-filesystem': storageAdapter });

        const setStage = vi.fn();
        await restoreArchiveSnapshot(makeInput({
            targetSourceId: 'target-db-1',
            databaseMapping: [{ originalName: 'db1', targetName: 'db1', selected: true }],
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/r', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage });

        expect(setStage.mock.calls.map((c) => c[0])).toEqual(['Restoring Databases', 'Restoring Files']);
    });

    it('shows only the file stage for a files-only restore', async () => {
        const { sourceAdapter } = await buildRemoteBackup([], { 'a.txt': 'AAAA' });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        const setStage = vi.fn();
        await restoreArchiveSnapshot(makeInput({
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/r', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage });

        expect(setStage.mock.calls.map((c) => c[0])).toEqual(['Restoring Files']);
    });

    it('never downloads the archive when only a database is restored over a ranged adapter', async () => {
        // The efficiency claim of the whole rework: restoring the database out of a
        // DB+directory archive transfers the database entry, not the archive.
        const bigDir: Record<string, string> = {};
        for (let i = 0; i < 30; i++) bigDir[`bulk/file-${i}.bin`] = 'X'.repeat(20_000);
        const { sourceAdapter, traffic, archiveSize } = await buildRemoteBackup(['db1'], bigDir);
        const dbAdapter = makeFakeDbAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            targetSourceId: 'target-db-1',
            databaseMapping: [{ originalName: 'db1', targetName: 'db1', selected: true }],
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/r', selected: false }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Success');
        expect(traffic.archiveDownloads).toBe(0);

        // Everything read by range stays far below the archive size: manifest probe,
        // and the (tiny) database entry - never the bulk directory content.
        const totalRangedBytes = traffic.ranges.reduce((sum, [s, e]) => sum + Math.max(0, e - s + 1), 0);
        expect(totalRangedBytes).toBeLessThan(archiveSize / 3);
        expect(dbAdapter.restoreOne).toHaveBeenCalledTimes(1);
    });

    it('restores only the selected subset of paths from a directory source', async () => {
        const { sourceAdapter } = await buildRemoteBackup([], {
            'www/index.php': 'INDEX',
            'www/assets/app.css': 'CSS',
            'docs/readme.md': 'DOCS',
        });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true, paths: ['www'] },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Success');
        const uploaded = vi.mocked(storageAdapter.upload).mock.calls.map((c: unknown[]) => c[2]);
        expect(uploaded.sort()).toEqual(['/restore/www/assets/app.css', '/restore/www/index.php']);
    });

    it('restores every entry when no mapping is provided at all (default select-all)', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['db1'], { 'a.txt': 'AAAA' });
        const dbAdapter = makeFakeDbAdapter();
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            targetSourceId: 'target-db-1',
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Success');
        expect(result.restoredDatabases).toEqual(['db1']);
    });

    it('records every database and folder it restores, where each went and what it read, for the summary of the run', async () => {
        const { sourceAdapter, archiveSize } = await buildRemoteBackup(['db1', 'db2'], { 'a.txt': 'AAAA', 'b.txt': 'BB' });
        wire({ 'source-fs': sourceAdapter, mysql: makeFakeDbAdapter(), 'local-filesystem': makeFakeStorageAdapter() });
        const record = createRestoreTracker();

        await restoreArchiveSnapshot(makeInput({
            targetSourceId: 'target-db-1',
            databaseMapping: [
                { originalName: 'db1', targetName: 'db1_restored', selected: true },
                { originalName: 'db2', targetName: 'db2', selected: true },
            ],
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn(), record });

        const view = record.view(false);
        expect(view.ranged).toBe(true);
        expect(view.targetVersion).toBe('8.0');
        expect(view.databases.map((entry) => [entry.name, entry.target, entry.state])).toEqual([['db1', 'db1_restored', 'done'], ['db2', 'db2', 'done']]);
        expect(view.databases[0].bytes).toBe(Buffer.byteLength('-- dump of db1'));
        expect(view.databases[0].startedAt).not.toBeNull();
        expect(view.folders).toEqual([expect.objectContaining({
            id: 'src-1', label: 'Test Directory', target: 'Local Restore Target:/restore/dir', adapterId: 'local-filesystem',
            state: 'done', files: 2, total: 2, failed: 0, bytes: 6, totalBytes: 6,
        })]);
        // Only the entries it needed, never the whole archive.
        expect(view.read).toBeGreaterThan(0);
        expect(view.read).toBeLessThan(archiveSize);
    });

    it('records a database that failed as failed and the rest as restored', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['db1', 'db2']);
        const dbAdapter = makeFakeDbAdapter({ restoreOne: vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined) });
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });
        const record = createRestoreTracker();

        await restoreArchiveSnapshot(makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn(), record });

        expect(record.view(false).databases.map((entry) => entry.state)).toEqual(['failed', 'done']);
    });

    it('returns Partial when one database entry fails and the rest succeed', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['db1', 'db2']);
        const dbAdapter = makeFakeDbAdapter({
            restoreOne: vi.fn()
                .mockRejectedValueOnce(new Error('disk full'))
                .mockResolvedValueOnce(undefined),
        });
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });

        const result = await restoreArchiveSnapshot(makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Partial');
        expect(result.restoredDatabases).toHaveLength(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].error).toContain('disk full');
    });

    it('returns Failed when nothing could be restored', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['db1']);
        const dbAdapter = makeFakeDbAdapter({ restoreOne: vi.fn().mockRejectedValue(new Error('connection refused')) });
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });

        const result = await restoreArchiveSnapshot(makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Failed');
        expect(result.restoredDatabases).toHaveLength(0);
    });

    it('restores a directory-only archive without requiring targetSourceId', async () => {
        const { sourceAdapter } = await buildRemoteBackup([], { 'config.yml': 'key: value' });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Success');
        expect(result.restoredDirectories).toEqual(['src-1']);
    });

    it('throws when the archive has database entries selected but no targetSourceId is given', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['db1'], { 'a.txt': 'A' });
        wire({ 'source-fs': sourceAdapter });

        await expect(
            restoreArchiveSnapshot(makeInput({
                directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
            }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() })
        ).rejects.toThrow('Missing targetSourceId');
    });

    it('throws when the target database adapter cannot restore from a seekable archive', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['db1']);
        wire({ 'source-fs': sourceAdapter, mysql: { id: 'mysql', type: 'database' } }); // no restoreOne

        await expect(
            restoreArchiveSnapshot(makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() })
        ).rejects.toThrow('cannot restore from this backup format');
    });

    it('restores a single database under the plain target name an API caller sends', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['shop']);
        const dbAdapter = makeFakeDbAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });

        const result = await restoreArchiveSnapshot(
            makeInput({ targetSourceId: 'target-db-1', targetDatabaseName: 'shop_staging' }),
            { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() }
        );

        expect(result.status).toBe('Success');
        expect(dbAdapter.prepareRestore).toHaveBeenCalledWith(expect.anything(), ['shop_staging'], expect.anything());
        expect(dbAdapter.restoreOne.mock.calls[0][2]).toBe('shop_staging');
        expect(dbAdapter.restoreOne.mock.calls[0][6]).toBe('shop');
    });

    it('keeps every database name when a plain target name is sent for several databases', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['shop', 'blog']);
        const dbAdapter = makeFakeDbAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });
        const log = vi.fn();

        await restoreArchiveSnapshot(
            makeInput({ targetSourceId: 'target-db-1', targetDatabaseName: 'renamed' }),
            { log, updateDetail: vi.fn(), setStage: vi.fn() }
        );

        expect(dbAdapter.restoreOne.mock.calls.map((c: unknown[]) => c[2])).toEqual(['shop', 'blog']);
        expect(log.mock.calls.some((c: unknown[]) => c[1] === 'warning' && String(c[0]).includes("'renamed' ignored"))).toBe(true);
    });

    it('checks the names it really writes into for databases of customers before it touches the server', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['shop', 'blog']);
        const dbAdapter = makeFakeDbAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });
        confirmTargets.mockRejectedValueOnce(new Error('The restore would overwrite databases that customers hold now: shop.'));
        const input = makeInput({ targetSourceId: 'target-db-1', targetDatabaseName: 'renamed' });

        await expect(restoreArchiveSnapshot(input, { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() })).rejects.toThrow(/customers hold now: shop/);

        // The plain name does not apply to two databases, so each goes back under its own.
        expect(confirmTargets).toHaveBeenCalledWith(input, ['shop', 'blog']);
        expect(dbAdapter.prepareRestore).not.toHaveBeenCalled();
        expect(dbAdapter.restoreOne).not.toHaveBeenCalled();
    });

    it('checks each database again right before it writes it, and skips one that changed hands meanwhile', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['shop', 'blog']);
        const dbAdapter = makeFakeDbAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });
        // The check before staging passes, the one before writing shop refuses.
        confirmTargets.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('shop is no longer yours, so nothing was restored.'));
        const input = makeInput({ targetSourceId: 'target-db-1' });

        const result = await restoreArchiveSnapshot(input, { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(confirmTargets.mock.calls.map((call) => call[1])).toEqual([['shop', 'blog'], ['shop'], ['blog']]);
        expect(dbAdapter.restoreOne.mock.calls.map((c: unknown[]) => c[2])).toEqual(['blog']);
        expect(result.restoredDatabases).toEqual(['blog']);
        expect(result.errors[0]).toMatchObject({ entry: 'database:shop', error: expect.stringContaining('no longer yours') });
    });

    it('lets the mapping win over a plain target name', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['shop']);
        const dbAdapter = makeFakeDbAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });

        await restoreArchiveSnapshot(makeInput({
            targetSourceId: 'target-db-1',
            targetDatabaseName: 'ignored',
            databaseMapping: [{ originalName: 'shop', targetName: 'shop_copy', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(dbAdapter.restoreOne.mock.calls[0][2]).toBe('shop_copy');
    });

    it('hands the adapter a dump file carrying the extension of its format', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['shop']);
        let seenPath = '';
        let seenContent = '';
        const dbAdapter = makeFakeDbAdapter({
            restoreOne: vi.fn(async (_conf: unknown, filePath: string) => {
                seenPath = filePath;
                seenContent = await fs.readFile(filePath, 'utf-8');
            }),
        });
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });

        await restoreArchiveSnapshot(makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(seenPath.endsWith('.sql')).toBe(true);
        expect(seenContent).toBe('-- dump of shop');
        await expect(fs.access(seenPath)).rejects.toThrow();
    });

    it('stages the dump where only DBackup reads it, in the private folder and with 0600', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['shop']);
        let seen = { folder: '', folderMode: 0, mode: 0 };
        const dbAdapter = makeFakeDbAdapter({
            restoreOne: vi.fn(async (_conf: unknown, filePath: string) => {
                const folder = path.dirname(filePath);
                seen = { folder: path.basename(folder), folderMode: (await fs.stat(folder)).mode & 0o777, mode: (await fs.stat(filePath)).mode & 0o777 };
            }),
        });
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });

        await restoreArchiveSnapshot(makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(seen.folder).toMatch(/^dbackup-private-/);
        if (process.platform !== 'win32') expect(seen).toEqual(expect.objectContaining({ folderMode: 0o700, mode: 0o600 }));
    });

    it('refuses to restore a dump whose bytes do not match the recorded checksum', async () => {
        const { sourceAdapter, workDir } = await buildRemoteBackup(['shop']);
        const tarPath = path.join(workDir, 'backup.tar');
        const raw = await fs.readFile(tarPath);
        const at = raw.indexOf(Buffer.from('-- dump of shop'));
        raw[at + 3] = 'X'.charCodeAt(0);
        await fs.writeFile(tarPath, raw);

        const dbAdapter = makeFakeDbAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });

        const result = await restoreArchiveSnapshot(makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Failed');
        expect(result.errors[0].error).toMatch(/checksum mismatch/i);
        expect(dbAdapter.restoreOne).not.toHaveBeenCalled();
    });

    it('moves one progress bar across every database instead of restarting it per dump', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['shop', 'blog']);
        const dbAdapter = makeFakeDbAdapter({
            restoreOne: vi.fn(async (_c: unknown, _f: string, _t: string, _h: unknown, _l: unknown, onProgress?: (p: number, d?: string) => void) => {
                onProgress?.(50, 'halfway');
            }),
        });
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });
        const updateProgress = vi.fn();

        await restoreArchiveSnapshot(
            makeInput({ targetSourceId: 'target-db-1' }),
            { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn(), updateProgress }
        );

        expect(updateProgress.mock.calls).toEqual([
            [25, 'shop: halfway'],
            [50],
            [75, 'blog: halfway'],
            [100],
        ]);
    });

    it('refuses a backup without a v2 archive marker in its metadata', async () => {
        // v1 archives never reach this service (the pipeline branches on the metadata),
        // so a missing marker means someone pointed it at the wrong backup.
        const { workDir, sourceAdapter } = await buildRemoteBackup(['db1']);
        await fs.writeFile(path.join(workDir, 'backup.tar.meta.json'), JSON.stringify({ version: 1, sourceType: 'mysql' }));
        wire({ 'source-fs': sourceAdapter });

        await expect(
            restoreArchiveSnapshot(makeInput({ targetSourceId: 'target-db-1' }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() })
        ).rejects.toThrow(/predates the seekable archive format/i);
    });

    it('restores only the databases and leaves the directories untouched at scope "databases"', async () => {
        // The scope is what the user picked in the explorer. Without it the omitted
        // directory mapping would read as "restore all directories", which then reports
        // them as skipped for having no target and drags the result down to Partial.
        const { sourceAdapter } = await buildRemoteBackup(['db1'], { 'a.txt': 'AAAA' });
        const dbAdapter = makeFakeDbAdapter();
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            scope: 'databases',
            targetSourceId: 'target-db-1',
            databaseMapping: [{ originalName: 'db1', targetName: 'db1', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Success');
        expect(result.restoredDatabases).toEqual(['db1']);
        expect(result.restoredDirectories).toEqual([]);
        expect(result.errors).toEqual([]);
        expect(storageAdapter.upload).not.toHaveBeenCalled();
    });

    it('restores only the files and needs no database target at scope "files"', async () => {
        // Same asymmetry the other way round: the omitted database mapping would mean
        // "restore every database", which fails outright without a target server.
        const { sourceAdapter } = await buildRemoteBackup(['db1'], { 'a.txt': 'AAAA' });
        const dbAdapter = makeFakeDbAdapter();
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            scope: 'files',
            directoryMapping: [
                { entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore/dir', selected: true },
            ],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Success');
        expect(result.restoredDirectories).toEqual(['src-1']);
        expect(result.restoredDatabases).toEqual([]);
        expect(dbAdapter.restoreOne).not.toHaveBeenCalled();
        expect(storageAdapter.upload).toHaveBeenCalledWith(expect.anything(), expect.any(String), '/restore/dir/a.txt', undefined, expect.any(Function), { restoreRelativePath: 'a.txt' });
    });

    it('records an error (Partial) for a directory entry with no restore target specified', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['db1'], { 'a.txt': 'A' });
        const dbAdapter = makeFakeDbAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            targetSourceId: 'target-db-1',
            directoryMapping: [{ entryId: 'src-1', targetConfigId: '', targetPath: '', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Partial');
        expect(result.restoredDatabases).toEqual(['db1']);
        expect(result.restoredDirectories).toHaveLength(0);
        expect(result.errors.some((e) => e.error.includes('No restore target specified'))).toBe(true);
    });

    it('writes nothing for a picked directory source without a folder, rather than into a folder named by the archive', async () => {
        const { sourceAdapter } = await buildRemoteBackup(['db1'], { 'a.txt': 'A' });
        const dbAdapter = makeFakeDbAdapter();
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, mysql: dbAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            targetSourceId: 'target-db-1',
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '  ', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Partial');
        expect(result.restoredDirectories).toHaveLength(0);
        expect(storageAdapter.upload).not.toHaveBeenCalled();
        expect(result.errors).toContainEqual({ entry: 'directory:Test Directory', error: 'Pick the folder each restored directory source goes into.' });
    });

    it('skips files matching an exclude pattern instead of restoring them', async () => {
        // Same pattern syntax as a backup's excludes, so a preset works on both sides. The
        // motivating case: Dropbox refuses .DS_Store outright, so restoring it can only fail.
        const { sourceAdapter } = await buildRemoteBackup([], {
            'keep.txt': 'A', '.DS_Store': 'junk', 'sub/Thumbs.db': 'junk',
        });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
            excludePatterns: ['.DS_Store', 'Thumbs.db'],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        const uploaded = vi.mocked(storageAdapter.upload).mock.calls.map((c: unknown[]) => c[2]);
        expect(uploaded).toEqual(['/restore/keep.txt']);
        // Excluded files were never meant to be written, so they are not failures.
        expect(result.status).toBe('Success');
        expect(result.errors).toHaveLength(0);
    });

    it('names a .meta.json and a file of the configuration backup as errors for a member and writes the rest', async () => {
        const { sourceAdapter } = await buildRemoteBackup([], {
            'keep.txt': 'A',
            'Shop/Shop_2026.tar.meta.json': '{"locked":true}',
            'config-backups/config_backup_2026.db.gz.enc': 'x',
        });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });
        const mapping = [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }];

        const member = await restoreArchiveSnapshot(makeInput({
            directoryMapping: mapping,
            caller: { isPlatformAdmin: false, authMethod: 'session', tenantId: 'default', permissions: ['storage:restore'] },
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(vi.mocked(storageAdapter.upload).mock.calls.map((c: unknown[]) => c[2])).toEqual(['/restore/keep.txt']);
        expect(member.status).toBe('Partial');
        expect(member.errors.map((e) => e.entry).sort()).toEqual(['Test Directory/Shop/Shop_2026.tar.meta.json', 'Test Directory/config-backups/config_backup_2026.db.gz.enc']);

        vi.mocked(storageAdapter.upload).mockClear();
        const admin = await restoreArchiveSnapshot(makeInput({
            directoryMapping: mapping,
            caller: { isPlatformAdmin: true, authMethod: 'session', tenantId: 'default', permissions: [] },
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });
        expect(admin.status).toBe('Success');
        expect(vi.mocked(storageAdapter.upload).mock.calls).toHaveLength(3);
    });

    it('fails the run when every file of a member is one only a platform admin restores', async () => {
        const { sourceAdapter } = await buildRemoteBackup([], { 'x.meta.json': '{}' });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(storageAdapter.upload).not.toHaveBeenCalled();
        expect(result.status).toBe('Failed');
    });

    it('restores everything when no exclude pattern is given', async () => {
        // Guard for the test above: the filter must not run unless the caller asked for it.
        const { sourceAdapter } = await buildRemoteBackup([], { 'keep.txt': 'A', '.DS_Store': 'junk' });
        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        await restoreArchiveSnapshot(makeInput({
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        const uploaded = vi.mocked(storageAdapter.upload).mock.calls.map((c: unknown[]) => c[2]);
        expect(uploaded).toHaveLength(2);
    });

    it('transfers as many files at once as the target connection allows', async () => {
        // The number lives on the connection, because the right one depends on the server at the
        // other end - the same installation can hold a NAS that welcomes sixteen parallel
        // transfers and a rate-limited cloud drive that does not.
        const { sourceAdapter } = await buildRemoteBackup([], { 'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C', 'd.txt': 'D' });

        let inFlight = 0;
        let peak = 0;
        const storageAdapter = makeFakeStorageAdapter({
            upload: vi.fn().mockImplementation(async () => {
                inFlight++;
                peak = Math.max(peak, inFlight);
                await new Promise((r) => setTimeout(r, 5));
                inFlight--;
                return true;
            }),
        });
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });
        storageTargetConfig.config = JSON.stringify({ maxConcurrentFiles: 1 });

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Success');
        expect(peak).toBe(1);
    });

    it('falls back to the adapter default when the connection names no value', async () => {
        // The guard for the test above: a connection that was never configured must not end up
        // serialised, which would quietly undo parallel restore for every existing destination.
        const { sourceAdapter } = await buildRemoteBackup([], { 'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C', 'd.txt': 'D' });

        let inFlight = 0;
        let peak = 0;
        const storageAdapter = makeFakeStorageAdapter({
            upload: vi.fn().mockImplementation(async () => {
                inFlight++;
                peak = Math.max(peak, inFlight);
                await new Promise((r) => setTimeout(r, 5));
                inFlight--;
                return true;
            }),
        });
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });
        storageTargetConfig.config = '{}';

        await restoreArchiveSnapshot(makeInput({
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(peak).toBeGreaterThan(1);
    });

    it('reports Partial - not Failed - when a single file of a directory source is rejected', async () => {
        // The real case: Dropbox refuses one filename outright while the other 129 files land.
        // Judging a source as all-or-nothing turned that into a failed run reporting that no
        // entries could be restored, which was both wrong and alarming.
        const { sourceAdapter } = await buildRemoteBackup([], {
            'keep-a.txt': 'A', 'keep-b.txt': 'B', '.DS_Store': 'junk',
        });
        const storageAdapter = makeFakeStorageAdapter({
            upload: vi.fn().mockImplementation(async (_c: unknown, _local: string, remotePath: string) =>
                !remotePath.endsWith('.DS_Store')),
        });
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Partial');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].entry).toContain('.DS_Store');
    });

    it('still reports Failed when every file of a directory source is rejected', async () => {
        // The distinction that makes Partial meaningful: nothing arrived at all.
        const { sourceAdapter } = await buildRemoteBackup([], { 'a.txt': 'A', 'b.txt': 'B' });
        const storageAdapter = makeFakeStorageAdapter({ upload: vi.fn().mockResolvedValue(false) });
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Failed');
    });

    it('fails a file whose content does not match its recorded checksum', async () => {
        // Unencrypted archives have no AEAD tag - the index checksum is the only
        // integrity check a restored file gets, so it must actually reject.
        const { workDir, sourceAdapter } = await buildRemoteBackup([], { 'a.txt': 'ORIGINAL' });

        // Corrupt the stored bytes without touching the index.
        const tarPath = path.join(workDir, 'backup.tar');
        const raw = await fs.readFile(tarPath);
        const at = raw.indexOf(Buffer.from('ORIGINAL'));
        expect(at).toBeGreaterThan(-1);
        raw.write('TAMPERED', at);
        await fs.writeFile(tarPath, raw);

        const storageAdapter = makeFakeStorageAdapter();
        wire({ 'source-fs': sourceAdapter, 'local-filesystem': storageAdapter });

        const result = await restoreArchiveSnapshot(makeInput({
            directoryMapping: [{ entryId: 'src-1', targetConfigId: 'target-storage-1', targetPath: '/restore', selected: true }],
        }), { log: vi.fn(), updateDetail: vi.fn(), setStage: vi.fn() });

        expect(result.status).toBe('Failed');
        expect(result.errors.some((e) => e.error.includes('Checksum mismatch'))).toBe(true);
        expect(storageAdapter.upload).not.toHaveBeenCalled();
    });
});
