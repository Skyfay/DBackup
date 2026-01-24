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

      await expect(LocalFileSystemAdapter.read(config, maliciousPath))
          .rejects
          .toThrow(/Access denied|illegal/i);
  });
});
