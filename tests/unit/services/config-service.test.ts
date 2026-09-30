import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '../../../src/services/config/config-service';
// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    systemSetting: { findMany: vi.fn(), upsert: vi.fn() },
    credentialProfile: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    adapterConfig: { findMany: vi.fn(), upsert: vi.fn() },
    job: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    jobDestination: { findMany: vi.fn(), upsert: vi.fn() },
    apiKey: { findMany: vi.fn(), upsert: vi.fn() },
    user: { findMany: vi.fn(), upsert: vi.fn() },
    group: { findMany: vi.fn(), upsert: vi.fn() },
    ssoProvider: { findMany: vi.fn(), upsert: vi.fn() },
    encryptionProfile: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((callback) => callback(prismaMock)),
  },
}));

// Mock restore-pipeline so ConfigService.restoreFromStorage is testable in isolation
vi.mock('@/services/config/restore-pipeline', () => ({
  restoreFromStorage: vi.fn().mockResolvedValue('execution-id-facade'),
}));

import prisma from '@/lib/prisma';
const prismaMock = prisma as any;

// Mock Crypto (keep implementation or mock? Real is better for logic check)
vi.mock('@/lib/crypto', async () => {
    const actual = await vi.importActual('@/lib/crypto');
    return {
        ...actual,
        getEncryptionKey: () => Buffer.alloc(32, 'a'), // Mock key
    };
});

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(() => {
    service = new ConfigService();
    vi.clearAllMocks();
  });

  it('should delegate restoreFromStorage to the pipeline function and return executionId (line 34)', async () => {
    const { restoreFromStorage: mockPipeline } = await import('@/services/config/restore-pipeline');

    const result = await service.restoreFromStorage('storage-1', 'backup.json', 'profile-1');

    expect(mockPipeline).toHaveBeenCalledWith('storage-1', 'backup.json', 'profile-1', undefined);
    expect(result).toBe('execution-id-facade');
  });
});
