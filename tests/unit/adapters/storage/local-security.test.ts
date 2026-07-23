import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalFileSystemAdapter } from '@/lib/adapters/storage/local';
import { existsSync } from 'fs';

// Mock fs modules
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSyncMock = vi.fn();
  const statSyncMock = vi.fn().mockReturnValue({ size: 100 });
  const createReadStreamMock = vi.fn().mockReturnValue({ on: vi.fn(), pipe: vi.fn() });
  const createWriteStreamMock = vi.fn().mockReturnValue({ on: vi.fn(), end: vi.fn() });

  return {
    ...actual,
    default: {
        ...actual,
        existsSync: existsSyncMock,
        statSync: statSyncMock,
        createReadStream: createReadStreamMock,
        createWriteStream: createWriteStreamMock,
    },
    existsSync: existsSyncMock,
    statSync: statSyncMock,
    createReadStream: createReadStreamMock,
    createWriteStream: createWriteStreamMock,
  };
});

vi.mock('fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs/promises')>();
    return {
        ...actual,
        default: {
            ...actual,
            mkdir: vi.fn(),
            readFile: vi.fn(),
        }
    }
});

vi.mock('stream/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('stream/promises')>();
    const mockedPipeline = vi.fn().mockResolvedValue(undefined);
    return {
        ...actual,
        pipeline: mockedPipeline,
        default: {
            ...actual,
            pipeline: mockedPipeline,
        }
    };
});

describe('LocalFileSystemAdapter Security', () => {
  const basePath = '/var/backups';
  const config = { basePath };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should prevent directory traversal in upload', async () => {
    const maliciousPath = '../../etc/passwd';
    const localFile = '/tmp/dump.sql';

    vi.mocked(existsSync).mockReturnValue(true);

    await expect(LocalFileSystemAdapter.upload(config, localFile, maliciousPath))
        .rejects
        .toThrow(/Access denied|illegal/i);
  });

  it('should prevent directory traversal in download', async () => {
    const maliciousPath = '../../etc/shadow';
    const localFile = '/tmp/restore.sql';

    vi.mocked(existsSync).mockReturnValue(true);

    await expect(LocalFileSystemAdapter.download(config, maliciousPath, localFile))
        .rejects
        .toThrow(/Access denied|illegal/i);
  });

  it('should prevent directory traversal in read', async () => {
      const maliciousPath = '../../secret.txt';

      vi.mocked(existsSync).mockReturnValue(true);

      await expect(LocalFileSystemAdapter.read!(config, maliciousPath))
          .rejects
          .toThrow(/Access denied|illegal/i);
  });
});

describe('LocalFileSystemAdapter path resolution', () => {
  const basePath = '/var/backups';
  const config = { basePath };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats a leading slash as the adapter root, not the filesystem root', async () => {
    // Regression: the restore UI suggests target paths like "/restore". Resolving that
    // against the base yielded "/restore" (an absolute second argument discards the base),
    // so every ordinary restore into a slash-prefixed folder was rejected as traversal.
    vi.mocked(existsSync).mockReturnValue(true);

    await expect(LocalFileSystemAdapter.upload(config, '/tmp/file.txt', '/restore/a.txt'))
      .resolves.not.toThrow();
  });

  it('resolves slash-prefixed and plain paths to the same location', async () => {
    // Asserted on the directory actually created, since the upload's own return value
    // depends on stream mocks that are not what this test is about.
    vi.mocked(existsSync).mockReturnValue(true);
    const mkdir = vi.mocked((await import('fs/promises')).default.mkdir);

    await LocalFileSystemAdapter.upload(config, '/tmp/f', '/restore/a.txt').catch(() => {});
    const withSlash = mkdir.mock.calls.at(-1)?.[0];

    await LocalFileSystemAdapter.upload(config, '/tmp/f', 'restore/a.txt').catch(() => {});
    const withoutSlash = mkdir.mock.calls.at(-1)?.[0];

    expect(withSlash).toBe('/var/backups/restore');
    expect(withoutSlash).toBe(withSlash);
  });

  it('still rejects traversal that hides behind a leading slash', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    for (const evil of ['/../etc/passwd', '/restore/../../../etc/passwd']) {
      await expect(LocalFileSystemAdapter.upload(config, '/tmp/f', evil))
        .rejects.toThrow(/Access denied|illegal/i);
    }
  });

  it('rejects a sibling directory whose name merely starts with the base name', async () => {
    // "/var/backups" must not grant access to "/var/backupsEVIL" - a bare startsWith()
    // check on the resolved path would.
    vi.mocked(existsSync).mockReturnValue(true);

    await expect(LocalFileSystemAdapter.upload(config, '/tmp/f', '../backupsEVIL/secret.txt'))
      .rejects.toThrow(/Access denied|illegal/i);
  });
});
