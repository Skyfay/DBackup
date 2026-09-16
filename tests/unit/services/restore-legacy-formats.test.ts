/**
 * Every backup format DBackup has ever written must stay restorable after the switch to the
 * seekable archive. These run the real restore pipeline against real files on disk, so the
 * routing is decided by the same bytes and sidecars a destination would serve.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { pack } from 'tar-stream';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { registry } from '@/lib/core/registry';
import { runRestorePipeline } from '@/services/restore/pipeline';
import { restoreArchiveSnapshot } from '@/services/restore/archive-restore';
import { createMultiDbTar } from '@/lib/adapters/database/common/tar-utils';
import { createArchive } from '@/lib/archive/writer';

let workDir: string;
let tempDir: string;

vi.mock('@/lib/core/registry', () => ({ registry: { get: vi.fn() } }));
vi.mock('@/lib/temp-dir', () => ({ getTempDir: () => tempDir }));
vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn(async (row: { config: string }) => JSON.parse(row.config)),
}));
vi.mock('@/lib/execution/abort', () => ({
    registerExecution: vi.fn(() => new AbortController()),
    unregisterExecution: vi.fn(),
}));
vi.mock('@/lib/execution/queue-manager', () => ({ processQueue: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/notifications/system-notification-service', () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/restore/archive-restore', () => ({
    restoreArchiveSnapshot: vi.fn().mockResolvedValue({ status: 'Success', restoredDatabases: ['shop'], restoredDirectories: [], errors: [] }),
}));

const storageRow = { id: 'storage-1', type: 'storage', adapterId: 'local-fs', name: 'Backups', config: '{}' };
const sourceRow = { id: 'source-1', type: 'database', adapterId: 'mysql', name: 'MySQL', config: '{}' };

/** What the database adapter's restore() received, captured before the pipeline cleans up. */
interface Received { calls: number; firstBytes: Buffer | null }

function wire(received: Received, traffic: { archiveDownloads: number }) {
    const storageAdapter = {
        id: 'local-fs',
        download: vi.fn(async (_c: unknown, remote: string, local: string) => {
            try {
                await fs.copyFile(path.join(workDir, remote), local);
            } catch {
                return false;
            }
            if (!remote.endsWith('.meta.json')) traffic.archiveDownloads++;
            return true;
        }),
    };
    const dbAdapter = {
        id: 'mysql',
        type: 'database',
        restore: vi.fn(async (_config: unknown, sourcePath: string) => {
            received.calls++;
            received.firstBytes = await fs.readFile(sourcePath);
            return { success: true };
        }),
    };

    prismaMock.execution.update.mockResolvedValue({} as never);
    prismaMock.adapterConfig.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) =>
        where.id === 'storage-1' ? storageRow : where.id === 'source-1' ? sourceRow : null) as never);
    vi.mocked(registry.get).mockImplementation(((id: string) => (id === 'local-fs' ? storageAdapter : dbAdapter)) as never);
    return { dbAdapter };
}

function finalStatus(): string | undefined {
    const calls = prismaMock.execution.update.mock.calls as unknown as [{ data: { status?: string } }][];
    return calls.map((c) => c[0].data.status).filter(Boolean).pop();
}

function loggedMessages(): string[] {
    const calls = prismaMock.execution.update.mock.calls as unknown as [{ data: { logs?: string } }][];
    const last = calls.map((c) => c[0].data.logs).filter(Boolean).pop();
    return last ? (JSON.parse(last) as { message: string }[]).map((l) => l.message) : [];
}

async function writeMeta(file: string, meta: Record<string, unknown>) {
    await fs.writeFile(path.join(workDir, `${file}.meta.json`), JSON.stringify({ version: 1, ...meta }));
}

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-formats-'));
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-formats-tmp-'));
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
});

describe('restoring backups written before every job used the seekable archive', () => {
    it('hands a plain dump without metadata straight to the adapter', async () => {
        await fs.writeFile(path.join(workDir, 'old.sql'), 'CREATE TABLE a (id INT);');
        const received: Received = { calls: 0, firstBytes: null };
        wire(received, { archiveDownloads: 0 });

        await runRestorePipeline('exec-plain', { storageConfigId: 'storage-1', file: 'old.sql', targetSourceId: 'source-1' });

        expect(finalStatus()).toBe('Success');
        expect(received.firstBytes?.toString()).toBe('CREATE TABLE a (id INT);');
        expect(restoreArchiveSnapshot).not.toHaveBeenCalled();
    });

    it('decompresses a whole-file gzip dump before the adapter sees it', async () => {
        await fs.writeFile(path.join(workDir, 'old.sql.gz'), zlib.gzipSync('INSERT INTO a VALUES (1);'));
        await writeMeta('old.sql.gz', { compression: 'GZIP' });
        const received: Received = { calls: 0, firstBytes: null };
        wire(received, { archiveDownloads: 0 });

        await runRestorePipeline('exec-gzip', { storageConfigId: 'storage-1', file: 'old.sql.gz', targetSourceId: 'source-1' });

        expect(finalStatus()).toBe('Success');
        expect(received.firstBytes?.toString()).toBe('INSERT INTO a VALUES (1);');
    });

    it('hands a version 1 multi-database TAR to the adapter unchanged', async () => {
        const dump = path.join(workDir, 'shop.sql');
        await fs.writeFile(dump, 'SELECT 1;');
        await createMultiDbTar([{ name: 'shop.sql', path: dump, dbName: 'shop', format: 'sql' }], path.join(workDir, 'old.tar'), { sourceType: 'mysql' });
        await writeMeta('old.tar', { multiDb: { format: 'tar', databases: ['shop'] } });
        const received: Received = { calls: 0, firstBytes: null };
        wire(received, { archiveDownloads: 0 });

        await runRestorePipeline('exec-v1', { storageConfigId: 'storage-1', file: 'old.tar', targetSourceId: 'source-1' });

        expect(finalStatus()).toBe('Success');
        expect(received.calls).toBe(1);
        expect(received.firstBytes!.subarray(0, 13).toString()).toBe('manifest.json');
        expect(restoreArchiveSnapshot).not.toHaveBeenCalled();
    });

    it('hands an MSSQL TAR of .bak files, which has no manifest, to the adapter unchanged', async () => {
        const tarPack = pack();
        const out = pipeline(tarPack, createWriteStream(path.join(workDir, 'old.bak')));
        tarPack.entry({ name: 'shop_2026-01-01T00-00-00-000Z.bak' }, 'BAKDATA');
        tarPack.finalize();
        await out;
        const received: Received = { calls: 0, firstBytes: null };
        wire(received, { archiveDownloads: 0 });

        await runRestorePipeline('exec-mssql', { storageConfigId: 'storage-1', file: 'old.bak', targetSourceId: 'source-1' });

        expect(finalStatus()).toBe('Success');
        expect(received.calls).toBe(1);
    });
});

describe('restoring a seekable archive', () => {
    async function buildArchive(): Promise<void> {
        const dump = path.join(workDir, 'shop.dump');
        await fs.writeFile(dump, 'SELECT 1;');
        await createArchive([{ kind: 'database', dbName: 'shop', path: dump, format: 'sql' }], path.join(workDir, 'new.tar'), {
            sourceType: 'mysql',
            compression: 'NONE',
        });
    }

    it('reads it by byte range when its metadata is there', async () => {
        await buildArchive();
        await writeMeta('new.tar', { archive: { formatVersion: 2, indexFile: '.index', encrypted: false } });
        const received: Received = { calls: 0, firstBytes: null };
        const traffic = { archiveDownloads: 0 };
        wire(received, traffic);

        await runRestorePipeline('exec-v2', { storageConfigId: 'storage-1', file: 'new.tar', targetSourceId: 'source-1' });

        expect(finalStatus()).toBe('Success');
        expect(restoreArchiveSnapshot).toHaveBeenCalledTimes(1);
        expect(received.calls).toBe(0);
        expect(traffic.archiveDownloads).toBe(0);
    });

    it('refuses to hand it to the adapter as a legacy TAR when its metadata is missing', async () => {
        await buildArchive();
        const received: Received = { calls: 0, firstBytes: null };
        wire(received, { archiveDownloads: 0 });

        await runRestorePipeline('exec-v2-no-meta', { storageConfigId: 'storage-1', file: 'new.tar', targetSourceId: 'source-1' });

        expect(finalStatus()).toBe('Failed');
        expect(received.calls).toBe(0);
        expect(loggedMessages().some((m) => m.includes('.meta.json sidecar could not be read'))).toBe(true);
    });
});
