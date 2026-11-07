/**
 * A backup of the older whole-file format inflates to a bound of its compressed size. Its
 * `.meta.json` records no size, and a few MB of Brotli inflate to terabytes on the temp folder
 * every tenant shares. Past the bound the restore fails as damaged and leaves no file behind.
 * The bound is lowered here to 1 MB, the real one is at least 1 GB, see `legacyInflateLimit`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { registry } from '@/lib/core/registry';
import { runRestorePipeline } from '@/services/restore/pipeline';

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
vi.mock('@/lib/archive/limits', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/archive/limits')>()),
    legacyInflateLimit: () => 1024 * 1024,
}));

const storageRow = { id: 'storage-1', type: 'storage', adapterId: 'local-fs', name: 'Backups', config: '{}' };
const sourceRow = { id: 'source-1', type: 'database', adapterId: 'mysql', name: 'MySQL', config: '{}' };

function wire() {
    const restore = vi.fn(async () => ({ success: true }));
    prismaMock.execution.update.mockResolvedValue({} as never);
    prismaMock.adapterConfig.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) =>
        where.id === 'storage-1' ? storageRow : where.id === 'source-1' ? sourceRow : null) as never);
    vi.mocked(registry.get).mockImplementation(((id: string) => (id === 'local-fs'
        ? { id: 'local-fs', download: async (_c: unknown, remote: string, local: string) => { await fs.copyFile(path.join(workDir, remote), local); return true; } }
        : { id: 'mysql', type: 'database', restore })) as never);
    return restore;
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

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-inflate-'));
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-inflate-tmp-'));
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
});

describe('a whole-file backup that inflates past its bound', () => {
    it('fails the restore as damaged before the adapter sees it, and leaves no file in the temp folder', async () => {
        // 64 MB of zeros as a few KB of Brotli.
        await fs.writeFile(path.join(workDir, 'old.sql.br'), zlib.brotliCompressSync(Buffer.alloc(64 * 1024 * 1024)));
        await fs.writeFile(path.join(workDir, 'old.sql.br.meta.json'), JSON.stringify({ version: 1, compression: 'BROTLI' }));
        const restore = wire();

        await runRestorePipeline('exec-bomb', { storageConfigId: 'storage-1', file: 'old.sql.br', targetSourceId: 'source-1' });

        expect(finalStatus()).toBe('Failed');
        expect(loggedMessages().some((message) => message.includes('The backup is damaged'))).toBe(true);
        expect(restore).not.toHaveBeenCalled();
        expect(await fs.readdir(tempDir)).toEqual([]);
    });

    it('restores one below the bound as before', async () => {
        await fs.writeFile(path.join(workDir, 'old.sql.br'), zlib.brotliCompressSync('INSERT INTO a VALUES (1);'));
        await fs.writeFile(path.join(workDir, 'old.sql.br.meta.json'), JSON.stringify({ version: 1, compression: 'BROTLI' }));
        const restore = wire();

        await runRestorePipeline('exec-small', { storageConfigId: 'storage-1', file: 'old.sql.br', targetSourceId: 'source-1' });

        expect(finalStatus()).toBe('Success');
        expect(restore).toHaveBeenCalledTimes(1);
    });
});
