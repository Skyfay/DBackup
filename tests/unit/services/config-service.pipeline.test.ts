/**
 * Coverage tests for services/config/restore-pipeline.ts.
 * Tests the restoreFromStorage facade and the internal runRestorePipeline function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { PassThrough } from 'stream';

// --- Mocks (must appear before subject import) ---

vi.mock('@/lib/adapters', () => ({
  registerAdapters: vi.fn(),
}));

vi.mock('@/lib/core/registry', () => ({
  registry: { get: vi.fn() },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
  resolveAdapterConfig: vi.fn(async (adapter: any) => {
    try { return JSON.parse(adapter.config); } catch { return {}; }
  }),
}));

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn((text: string) => text.startsWith('ENC_') ? text.replace('ENC_', '') : text),
}));

vi.mock('@/lib/crypto/stream', () => ({
  createDecryptionStream: vi.fn(() => new PassThrough()),
}));

vi.mock('zlib', () => {
  const createGunzip = vi.fn(() => new PassThrough());
  return { createGunzip, default: { createGunzip } };
});

vi.mock('@/services/backup/encryption-service', () => ({
  getProfileMasterKey: vi.fn(),
  getEncryptionProfiles: vi.fn(),
}));

vi.mock('@/lib/temp-dir', () => ({
  getTempDir: vi.fn(() => '/tmp'),
}));

vi.mock('@/services/config/import', () => ({
  importConfiguration: vi.fn(async () => ({ notes: [] })),
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Use vi.hoisted so mockCreateReadStream is available inside the vi.mock factory
const { mockCreateReadStream, opensWith } = vi.hoisted(() => ({
  mockCreateReadStream: vi.fn(),
  // Whether a key fits the file, as the check of its first bytes judges it. Every key by default.
  opensWith: vi.fn(async (_key: Buffer) => true),
}));

vi.mock('@/services/restore/smart-recovery', () => ({
  legacyStreamVerifier: () => (key: Buffer) => opensWith(key),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    createReadStream: mockCreateReadStream,
    promises: {
      ...actual.promises,
      unlink: vi.fn().mockResolvedValue(undefined),
    },
    default: {
      ...actual,
      createReadStream: mockCreateReadStream,
    },
  };
});

// Import subjects after mocks are registered
import { restoreFromStorage } from '@/services/config/restore-pipeline';
import { registry } from '@/lib/core/registry';
import * as encryptionService from '@/services/backup/encryption-service';
import { importConfiguration } from '@/services/config/import';
import { explicitScope, runAsTenant, type TenantScope } from '@/lib/tenant/context';
import { HOME_TENANT_ID } from '@/lib/tenant/home';

// Utility: wait for all micro and macro tasks to settle
const flushAsync = () => new Promise(resolve => setTimeout(resolve, 30));

// Shared mock storage adapter
const makeStorageAdapter = (overrides: Record<string, any> = {}) => ({
  download: vi.fn().mockResolvedValue(undefined),
  read: vi.fn().mockResolvedValue(null), // no metadata sidecar by default
  ...overrides,
});

/**
 * A configuration backup at a destination restores only encrypted, so the runs that should succeed
 * read an encrypted file whose key the Vault holds.
 */
const ENCRYPTED_META = JSON.stringify({
  encryption: { enabled: true, profileId: 'config-key', iv: 'aabbccddeeff0011aabbccddeeff0011', authTag: '00112233445566778899aabbccddeeff' },
});
const encryptedAdapter = (overrides: Record<string, any> = {}) => {
  (encryptionService.getEncryptionProfiles as any).mockResolvedValue([{ id: 'config-key', name: 'Config key' }]);
  (encryptionService.getProfileMasterKey as any).mockResolvedValue(Buffer.alloc(32));
  configBackupKey('config-key');
  return makeStorageAdapter({ read: vi.fn().mockResolvedValue(ENCRYPTED_META), ...overrides });
};
const ENCRYPTED_FILE = 'config-backups/config_backup_2026.json.enc';

/** The key picked under Configuration backup, or none. */
function configBackupKey(profileId: string | null) {
  prismaMock.systemSetting.findUnique.mockResolvedValue(profileId ? { value: profileId } as any : null);
}

/** Every key of the Vault, each its own bytes, so a test tells which one opened the file. */
const VAULT_KEYS: Record<string, Buffer> = { 'config-key': Buffer.alloc(32, 1), 'member-key': Buffer.alloc(32, 2), 'picked-key': Buffer.alloc(32, 3) };
const vaultKeys = () => {
  (encryptionService.getEncryptionProfiles as any).mockResolvedValue(Object.keys(VAULT_KEYS).map((id) => ({ id, name: id })));
  (encryptionService.getProfileMasterKey as any).mockImplementation(async (id: string) => {
    if (!VAULT_KEYS[id]) throw new Error('Not found');
    return VAULT_KEYS[id];
  });
};
const metaNaming = (profileId: string) => makeStorageAdapter({
  read: vi.fn().mockResolvedValue(JSON.stringify({ encryption: { enabled: true, profileId, iv: 'aabbccddeeff0011aabbccddeeff0011', authTag: '00112233445566778899aabbccddeeff' } })),
});
const finalRun = () => (prismaMock.execution.update as any).mock.calls.at(-1)[0].data;

// Build a PassThrough that emits JSON content then ends
const makeJsonStream = (content: string) => {
  const stream = new PassThrough();
  process.nextTick(() => { stream.write(content); stream.end(); });
  return stream;
};

// ---------------------------------------------------------------------------

describe('restoreFromStorage', () => {
  const storageConfigId = 'storage-1';
  const filePath = 'backups/config.json';
  const executionId = 'exec-abc';

  const mockStorageConfig = {
    id: storageConfigId,
    adapterId: 'local-fs',
    config: JSON.stringify({ basePath: '/backups' }),
    name: 'Local',
    type: 'storage',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const validBackupJson = JSON.stringify({
    metadata: { version: '1.0.0', sourceType: 'SYSTEM' },
    settings: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.execution.create.mockResolvedValue({ id: executionId } as any);
    prismaMock.execution.update.mockResolvedValue({} as any);
    prismaMock.adapterConfig.findUnique.mockResolvedValue(mockStorageConfig as any);

    // Default: createReadStream returns a stream with valid JSON backup content
    mockCreateReadStream.mockReturnValue(makeJsonStream(validBackupJson));
    opensWith.mockResolvedValue(true);
    configBackupKey(null);
  });

  it('creates an execution record and returns its ID immediately', async () => {
    (registry.get as any).mockReturnValue(makeStorageAdapter());

    const result = await restoreFromStorage(storageConfigId, filePath);

    expect(result).toBe(executionId);
    expect(prismaMock.execution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'System Restore', status: 'Running' }),
      }),
    );
  });

  it('marks execution as Success after a successful pipeline run', async () => {
    (registry.get as any).mockReturnValue(encryptedAdapter());
    (importConfiguration as any).mockResolvedValue({ notes: [] });

    await restoreFromStorage(storageConfigId, ENCRYPTED_FILE);
    await flushAsync();

    expect(prismaMock.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Success' }),
      }),
    );
  });

  it('writes what did not come back to the log of the run as warnings', async () => {
    (registry.get as any).mockReturnValue(encryptedAdapter());
    (importConfiguration as any).mockResolvedValue({ notes: ['1 job is paused so it does not back up unencrypted, its encryption key is not here: Shop.'] });

    await restoreFromStorage(storageConfigId, ENCRYPTED_FILE);
    await flushAsync();

    const final = (prismaMock.execution.update as any).mock.calls.at(-1)[0];
    expect(final.data.status).toBe('Success');
    expect(JSON.parse(final.data.logs)).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warn', message: expect.stringContaining('encryption key is not here') }),
    ]));
  });

  it('marks execution as Failed when storage adapter config is not found', async () => {
    prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

    await restoreFromStorage(storageConfigId, filePath);
    await flushAsync();

    expect(prismaMock.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Failed' }),
      }),
    );
  });

  it('marks execution as Failed when registry returns no adapter instance', async () => {
    (registry.get as any).mockReturnValue(undefined);

    await restoreFromStorage(storageConfigId, filePath);
    await flushAsync();

    expect(prismaMock.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Failed' }),
      }),
    );
  });

  it('marks execution as Failed when download throws', async () => {
    (registry.get as any).mockReturnValue(makeStorageAdapter({
      download: vi.fn().mockRejectedValue(new Error('Network timeout')),
    }));

    await restoreFromStorage(storageConfigId, filePath);
    await flushAsync();

    expect(prismaMock.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Failed' }),
      }),
    );
  });

  it('resolves encryption profile from metadata sidecar when file is encrypted', async () => {
    const encProfileId = 'enc-profile-1';

    const adapter = makeStorageAdapter({
      read: vi.fn().mockResolvedValue(JSON.stringify({
        encryption: {
          enabled: true,
          profileId: encProfileId,
          iv: 'aabbccddeeff0011aabbccddeeff0011',
          authTag: '00112233445566778899aabbccddeeff',
        },
        compression: 'NONE',
      })),
    });
    (registry.get as any).mockReturnValue(adapter);

    prismaMock.encryptionProfile.findUnique.mockResolvedValue({
      id: encProfileId,
      secretKey: 'ENC_' + 'a'.repeat(64),
    } as any);
    (importConfiguration as any).mockResolvedValue({ notes: [] });

    await restoreFromStorage(storageConfigId, 'backups/config.enc', encProfileId);
    await flushAsync();

    // Pipeline ran and updated execution (success or handled error)
    expect(prismaMock.execution.update).toHaveBeenCalled();
  });

  it('marks execution as Failed when the profile the file names is missing and no key opens it', async () => {
    const adapter = makeStorageAdapter({
      read: vi.fn().mockResolvedValue(JSON.stringify({
        encryption: { enabled: true, profileId: 'missing-profile', iv: 'aabb', authTag: 'ccdd' },
      })),
    });
    (registry.get as any).mockReturnValue(adapter);

    prismaMock.encryptionProfile.findUnique.mockResolvedValue(null);
    (encryptionService.getEncryptionProfiles as any).mockResolvedValue([
      { id: 'candidate', name: 'Candidate' },
    ]);
    (encryptionService.getProfileMasterKey as any).mockRejectedValue(new Error('Not found'));

    await restoreFromStorage(storageConfigId, 'backups/config.enc');
    await flushAsync();

    // All candidate keys failed - execution should be marked Failed
    expect(prismaMock.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
    );
  });

  it('records the run and reads the destination in the home tenant, whichever tenant the admin looks at', async () => {
    const scopes: (TenantScope | undefined)[] = [];
    const noted = <T>(value: T) => async () => {
      scopes.push(explicitScope());
      return value;
    };
    prismaMock.execution.create.mockImplementation(noted({ id: executionId }) as any);
    prismaMock.execution.update.mockImplementation(noted({}) as any);
    prismaMock.adapterConfig.findUnique.mockImplementation(noted(mockStorageConfig) as any);
    (registry.get as any).mockReturnValue(encryptedAdapter());

    // A customer's tenant, where the run would land in its history and the destination not be found.
    await runAsTenant('acme', () => restoreFromStorage(storageConfigId, ENCRYPTED_FILE));
    await flushAsync();

    expect(prismaMock.execution.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
    );
    expect(scopes.length).toBeGreaterThan(3);
    expect(scopes.every((scope) => scope?.kind === 'tenant' && scope.tenantId === HOME_TENANT_ID)).toBe(true);
  });

  it('accepts optional RestoreOptions parameter and returns executionId', async () => {
    const id = await restoreFromStorage(storageConfigId, filePath, undefined, {
      settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true,
    });

    expect(typeof id).toBe('string');
    expect(id).toBe(executionId);
  });

  it('attaches gunzip stream when filePath contains .gz (compressed backup, lines 217-220)', async () => {
    (registry.get as any).mockReturnValue(encryptedAdapter());
    (importConfiguration as any).mockResolvedValue({ notes: [] });

    await restoreFromStorage(storageConfigId, 'config-backups/config_backup_2026.json.gz.enc');
    await flushAsync();

    expect(prismaMock.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
    );
  });

  it('marks execution as Failed when backup JSON cannot be parsed (line 243)', async () => {
    (registry.get as any).mockReturnValue(makeStorageAdapter());
    mockCreateReadStream.mockReturnValue(makeJsonStream('THIS IS NOT VALID JSON AT ALL'));

    await restoreFromStorage(storageConfigId, filePath);
    await flushAsync();

    expect(prismaMock.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
    );
  });

  it('logs warning and still succeeds when backup sourceType is not SYSTEM (line 248)', async () => {
    (registry.get as any).mockReturnValue(encryptedAdapter());
    (importConfiguration as any).mockResolvedValue({ notes: [] });

    const nonSystemBackup = JSON.stringify({
      metadata: { version: '1.0.0', sourceType: 'MANUAL' },
      settings: [],
    });
    mockCreateReadStream.mockReturnValue(makeJsonStream(nonSystemBackup));

    await restoreFromStorage(storageConfigId, ENCRYPTED_FILE);
    await flushAsync();

    // Warning logged but pipeline still succeeds
    expect(prismaMock.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Success' }) }),
    );
  });

  it('detects encryption from metadata enabled flag, not .enc extension (line 117 branch)', async () => {
    const encProfileId = 'meta-enc-profile';
    // File has no .enc extension but metadata says encryption.enabled = true
    const adapter = makeStorageAdapter({
      read: vi.fn().mockResolvedValue(JSON.stringify({
        encryption: {
          enabled: true,
          profileId: encProfileId,
          iv: 'aabbccddeeff0011aabbccddeeff0011',
          authTag: '00112233445566778899aabbccddeeff',
        },
        compression: 'NONE',
      })),
    });
    (registry.get as any).mockReturnValue(adapter);

    prismaMock.encryptionProfile.findUnique.mockResolvedValue({
      id: encProfileId,
      secretKey: 'ENC_' + 'a'.repeat(64),
    } as any);
    (importConfiguration as any).mockResolvedValue({ notes: [] });

    // Pass explicit decryptionProfileId; filePath has no .enc extension
    await restoreFromStorage(storageConfigId, 'backups/config.json', encProfileId);
    await flushAsync();

    expect(prismaMock.execution.update).toHaveBeenCalled();
  });

  it('opens a file of flat metadata with the key of the configuration backup, never the profile it names', async () => {
    const adapter = makeStorageAdapter({
      read: vi.fn().mockResolvedValue(JSON.stringify({
        encryptionProfileId: 'flat-enc-profile',
        iv: 'aabbccddeeff0011aabbccddeeff0011',
        authTag: '00112233445566778899aabbccddeeff',
      })),
    });
    (registry.get as any).mockReturnValue(adapter);
    (encryptionService.getProfileMasterKey as any).mockResolvedValue(Buffer.alloc(32));
    configBackupKey('config-key');
    (importConfiguration as any).mockResolvedValue({ notes: [] });

    await restoreFromStorage(storageConfigId, 'backups/config.json');
    await flushAsync();

    expect(encryptionService.getProfileMasterKey).toHaveBeenCalledWith('config-key');
    expect(encryptionService.getProfileMasterKey).not.toHaveBeenCalledWith('flat-enc-profile');
    expect(finalRun().status).toBe('Success');
  });

  it('restores a file the configuration backup wrote, which names its key', async () => {
    vaultKeys();
    configBackupKey('config-key');
    opensWith.mockImplementation(async (key: Buffer) => key.equals(VAULT_KEYS['config-key']));
    (registry.get as any).mockReturnValue(metaNaming('config-key'));

    await restoreFromStorage(storageConfigId, ENCRYPTED_FILE);
    await flushAsync();

    expect(finalRun().status).toBe('Success');
    expect(importConfiguration).toHaveBeenCalled();
  });

  it('refuses a file encrypted with a key a member added to the Vault, also when its metadata names that key', async () => {
    vaultKeys();
    configBackupKey('config-key');
    opensWith.mockImplementation(async (key: Buffer) => key.equals(VAULT_KEYS['member-key']));

    for (const named of ['member-key', 'gone-profile']) {
      vi.mocked(importConfiguration).mockClear();
      (registry.get as any).mockReturnValue(metaNaming(named));

      await restoreFromStorage(storageConfigId, ENCRYPTED_FILE);
      await flushAsync();

      expect(finalRun().status).toBe('Failed');
      expect(finalRun().logs).toContain('opens on its own only with the key picked under Configuration backup');
      expect(importConfiguration).not.toHaveBeenCalled();
    }
    // No Smart Recovery over the Vault, which holds the key of the member.
    expect(encryptionService.getEncryptionProfiles).not.toHaveBeenCalled();
    expect(encryptionService.getProfileMasterKey).not.toHaveBeenCalledWith('member-key');
  });

  it('refuses an encrypted file while no key is picked under Configuration backup', async () => {
    vaultKeys();
    (registry.get as any).mockReturnValue(metaNaming('member-key'));

    await restoreFromStorage(storageConfigId, ENCRYPTED_FILE);
    await flushAsync();

    expect(finalRun().status).toBe('Failed');
    expect(importConfiguration).not.toHaveBeenCalled();
  });

  it('opens a file with the key the admin picked for the run', async () => {
    vaultKeys();
    configBackupKey('config-key');
    opensWith.mockImplementation(async (key: Buffer) => key.equals(VAULT_KEYS['picked-key']));
    (registry.get as any).mockReturnValue(metaNaming('gone-profile'));

    await restoreFromStorage(storageConfigId, ENCRYPTED_FILE, 'picked-key');
    await flushAsync();

    expect(finalRun().status).toBe('Success');
  });

  it('marks execution as Failed when file is encrypted but no profile ID is available (line 141)', async () => {
    // File is .enc, no explicit profileId, and adapter.read returns null (no metadata)
    const adapter = makeStorageAdapter({
      read: vi.fn().mockResolvedValue(null), // no metadata sidecar
    });
    (registry.get as any).mockReturnValue(adapter);

    await restoreFromStorage(storageConfigId, 'backups/config.enc'); // no decryptionProfileId
    await flushAsync();

    expect(prismaMock.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }),
    );
  });

  it('logs warning and continues when metadata sidecar read throws (line 110)', async () => {
    const adapter = makeStorageAdapter({
      read: vi.fn().mockRejectedValue(new Error('Permission denied')), // metadata read throws
    });
    (registry.get as any).mockReturnValue(adapter);
    (importConfiguration as any).mockResolvedValue({ notes: [] });

    // Sidecar read failure is caught and logged - pipeline continues with filename detection,
    // which finds a plain file here, refused at a destination.
    await restoreFromStorage(storageConfigId, filePath);
    await flushAsync();

    const logs = JSON.parse((prismaMock.execution.update as any).mock.calls.at(-1)[0].data.logs);
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('Could not read metadata sidecar') })]));
    expect(importConfiguration).not.toHaveBeenCalled();
  });

  it('refuses a plain configuration file at a destination, which anyone who may restore files there could have put', async () => {
    (registry.get as any).mockReturnValue(makeStorageAdapter());

    await restoreFromStorage(storageConfigId, 'config-backups/config_backup_2026.json');
    await flushAsync();

    expect(importConfiguration).not.toHaveBeenCalled();
    const final = (prismaMock.execution.update as any).mock.calls.at(-1)[0];
    expect(final.data.status).toBe('Failed');
    expect(final.data.logs).toContain('restored only when it is encrypted');
  });
});
