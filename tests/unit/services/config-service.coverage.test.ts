/**
 * Coverage tests for services/config/import.ts.
 * Covers branches not exercised by the existing complex lifecycle tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { importConfiguration } from '@/services/config/import';
import type { RestoreOptions } from '@/lib/types/config-backup';

// --- Mocks ---

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn((text: string) => `ENC_${text}`),
  decrypt: vi.fn((text: string) => {
    if (text === 'DECRYPT_WILL_FAIL') throw new Error('Decryption failed');
    return text.startsWith('ENC_') ? text.replace('ENC_', '') : text;
  }),
  encryptConfig: vi.fn((conf: any) => conf),
  decryptConfig: vi.fn((conf: any) => conf),
  stripSecrets: vi.fn((conf: any) => {
    const cleaned = { ...conf };
    if ('password' in cleaned) cleaned.password = '';
    return cleaned;
  }),
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Helper: minimal valid backup for import tests
function makeBackup(overrides: Record<string, any> = {}) {
  return {
    metadata: { version: '1.0.0', sourceType: 'SYSTEM', exportedAt: new Date().toISOString(), includeSecrets: false },
    settings: [],
    credentialProfiles: [],
    adapters: [],
    jobs: [],
    jobDestinations: [],
    jobNotifications: {},
    apiKeys: [],
    users: [],
    groups: [],
    ssoProviders: [],
    encryptionProfiles: [],
    ...overrides,
  };
}

// Helper: set up minimal import mocks (return null for all findFirst/findUnique to avoid merge paths)
function setupMinimalImport() {
  prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
  prismaMock.systemSetting.upsert.mockResolvedValue({} as any);
  prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
  prismaMock.adapterConfig.upsert.mockResolvedValue({} as any);
  prismaMock.encryptionProfile.findFirst.mockResolvedValue(null);
  prismaMock.encryptionProfile.findUnique.mockResolvedValue(null);
  prismaMock.encryptionProfile.create.mockResolvedValue({} as any);
  prismaMock.encryptionProfile.update.mockResolvedValue({} as any);
  prismaMock.job.findFirst.mockResolvedValue(null);
  prismaMock.job.findUnique.mockResolvedValue(null);
  prismaMock.job.upsert.mockResolvedValue({} as any);
  prismaMock.job.update.mockResolvedValue({} as any);
  prismaMock.jobDestination.upsert.mockResolvedValue({} as any);
  prismaMock.group.findUnique.mockResolvedValue(null);
  prismaMock.group.upsert.mockResolvedValue({} as any);
  prismaMock.group.update.mockResolvedValue({} as any);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.upsert.mockResolvedValue({} as any);
  prismaMock.user.update.mockResolvedValue({} as any);
  prismaMock.account.upsert.mockResolvedValue({} as any);
  prismaMock.apiKey.upsert.mockResolvedValue({} as any);
  prismaMock.credentialProfile.findUnique.mockResolvedValue(null);
  prismaMock.credentialProfile.upsert.mockResolvedValue({} as any);
  prismaMock.credentialProfile.update.mockResolvedValue({} as any);
  prismaMock.ssoProvider.findUnique.mockResolvedValue(null);
  prismaMock.ssoProvider.upsert.mockResolvedValue({} as any);
  prismaMock.ssoProvider.update.mockResolvedValue({} as any);
  prismaMock.storageSnapshot.upsert.mockResolvedValue({} as any);
  prismaMock.execution.upsert.mockResolvedValue({} as any);
  prismaMock.auditLog.upsert.mockResolvedValue({} as any);
  prismaMock.notificationLog.upsert.mockResolvedValue({} as any);
}

// ---------------------------------------------------------------------------

describe('import.ts - uncovered branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMinimalImport();
  });

  it('merges user when existing user with same email but different ID exists (lines 249-254)', async () => {
    // Existing user in DB with same email but a different ID
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'db-user-id',
      email: 'shared@example.com',
    } as any);

    const backup = makeBackup({
      groups: [{ id: 'g1', name: 'Admin', permissions: [], createdAt: new Date(), updatedAt: new Date() }],
      users: [{ id: 'backup-user-id', email: 'shared@example.com', groupId: null, accounts: [] }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // Should UPDATE the existing user (not upsert the backup ID)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'db-user-id' } }),
    );
  });

  it('restores API keys with proper userId remapping (lines 280-287)', async () => {
    // User in backup has ID that differs from db user
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'db-user-id',
      email: 'user@example.com',
    } as any);

    const backup = makeBackup({
      groups: [],
      users: [{ id: 'backup-user-id', email: 'user@example.com', groupId: null, accounts: [] }],
      apiKeys: [
        { id: 'k1', name: 'API Key', hashedKey: 'VALID_HASH', userId: 'backup-user-id', createdAt: new Date() },
      ],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // apiKey.upsert should have been called with the REMAPPED userId
    const call = (prismaMock.apiKey.upsert as any).mock.calls[0][0];
    expect(call.create.userId).toBe('db-user-id');
  });

  it('skips API key when hashedKey is empty (stripped export)', async () => {
    const backup = makeBackup({
      users: [{ id: 'u1', email: 'u@example.com', groupId: null, accounts: [] }],
      apiKeys: [{ id: 'k1', name: 'Stripped Key', hashedKey: '', userId: 'u1' }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.apiKey.upsert).not.toHaveBeenCalled();
  });

  it('merges SSO provider when same providerId exists with different ID (lines 300-325)', async () => {
    prismaMock.ssoProvider.findUnique.mockResolvedValueOnce({
      id: 'sso-db-id',
      providerId: 'google',
    } as any);

    const backup = makeBackup({
      ssoProviders: [{
        id: 'sso-backup-id',
        providerId: 'google',
        clientId: 'cid',
        clientSecret: 'csecret',
        oidcConfig: JSON.stringify({ clientId: 'cid', clientSecret: 'csecret' }),
        name: 'Google SSO',
        domain: 'example.com',
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // Must UPDATE existing SSO provider, not upsert with backup ID
    expect(prismaMock.ssoProvider.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sso-db-id' } }),
    );
  });

  it('restores statistics data including snapshots, executions, auditLogs, notificationLogs (lines 336-381)', async () => {
    // job exists for execution FK check
    prismaMock.job.findUnique.mockResolvedValue({ id: 'j1' } as any);
    // user exists for auditLog FK check
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' } as any);

    const backup = makeBackup({
      statistics: {
        storageSnapshots: [{ id: 'ss1', jobId: 'j1' }],
        executions: [{ id: 'ex1', jobId: 'j1' }],
        auditLogs: [{ id: 'al1', userId: 'u1' }],
        notificationLogs: [{ id: 'nl1' }],
      },
    });

    const options: RestoreOptions = {
      settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true, statistics: true,
    };

    await importConfiguration(backup as any, 'OVERWRITE', options);

    expect(prismaMock.storageSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ss1' } }),
    );
    expect(prismaMock.execution.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ex1' } }),
    );
    expect(prismaMock.auditLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'al1' } }),
    );
    expect(prismaMock.notificationLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'nl1' } }),
    );
  });

  it('nulls out execution jobId when referenced job does not exist (statistics restore)', async () => {
    prismaMock.job.findUnique.mockResolvedValue(null); // job missing
    prismaMock.user.findUnique.mockResolvedValue(null);

    const backup = makeBackup({
      statistics: {
        executions: [{ id: 'ex1', jobId: 'missing-job' }],
        storageSnapshots: [],
        auditLogs: [],
        notificationLogs: [],
      },
    });

    const options: RestoreOptions = {
      settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true, statistics: true,
    };

    await importConfiguration(backup as any, 'OVERWRITE', options);

    const call = (prismaMock.execution.upsert as any).mock.calls[0][0];
    expect(call.create.jobId).toBeNull(); // FK nulled out
  });

  it('nulls out auditLog userId when referenced user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null); // user missing
    prismaMock.job.findUnique.mockResolvedValue(null);

    const backup = makeBackup({
      statistics: {
        auditLogs: [{ id: 'al1', userId: 'missing-user' }],
        executions: [],
        storageSnapshots: [],
        notificationLogs: [],
      },
    });

    const options: RestoreOptions = {
      settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true, statistics: true,
    };

    await importConfiguration(backup as any, 'OVERWRITE', options);

    const call = (prismaMock.auditLog.upsert as any).mock.calls[0][0];
    expect(call.create.userId).toBeNull(); // FK nulled out
  });

  it('upserts SSO provider when no matching providerId exists in DB (line 325 upsert path)', async () => {
    // findUnique returns null (set in setupMinimalImport) -> goes to else -> upsert
    const backup = makeBackup({
      ssoProviders: [{
        id: 'sso-new',
        providerId: 'github',
        clientId: 'gh-cid',
        clientSecret: 'gh-secret',
        oidcConfig: null,
        name: 'GitHub SSO',
        domain: 'github.com',
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.ssoProvider.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sso-new' } }),
    );
  });

  it('silently catches adapter config JSON parse failure during import (catch branch)', async () => {
    const backup = makeBackup({
      adapters: [{ id: 'a-bad', name: 'Broken Adapter', adapterId: 'mysql', type: 'database', config: '{{INVALID_JSON}}' }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // Adapter is still upserted with empty configObj when JSON.parse throws
    expect(prismaMock.adapterConfig.upsert).toHaveBeenCalled();
  });

  it('updates existing adapter in-place when same name and type exist with different ID (line 243 adapter merge)', async () => {
    prismaMock.adapterConfig.findFirst.mockResolvedValueOnce({
      id: 'existing-adapter-id',
      name: 'Prod MySQL',
      type: 'database',
    } as any);

    const backup = makeBackup({
      adapters: [{
        id: 'backup-adapter-id',
        name: 'Prod MySQL',
        type: 'database',
        adapterId: 'mysql',
        config: JSON.stringify({ host: 'localhost' }),
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'existing-adapter-id' } }),
    );
  });

  it('merges group, remaps user groupId, and remaps auditLog userId via userIdMap (lines 223-227, 243, 365)', async () => {
    // Group merge: existing group with same name but different ID
    prismaMock.group.findUnique.mockResolvedValueOnce({
      id: 'db-group-id',
      name: 'Admins',
      permissions: [],
    } as any);

    // User email lookup: existing user with same email but different ID. The auditLog userId
    // needs no lookup, the restore knows the user it just wrote.
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'db-user-id', email: 'admin@example.com' } as any);

    const backup = makeBackup({
      groups: [{ id: 'backup-group-id', name: 'Admins', permissions: [], createdAt: new Date(), updatedAt: new Date() }],
      users: [{
        id: 'backup-user-id',
        email: 'admin@example.com',
        groupId: 'backup-group-id', // points to backup group ID
        accounts: [],
      }],
      statistics: {
        storageSnapshots: [],
        executions: [],
        auditLogs: [{ id: 'al-remap', userId: 'backup-user-id' }], // references backup user ID
        notificationLogs: [],
      },
    });

    const options: RestoreOptions = {
      settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true, statistics: true,
    };

    await importConfiguration(backup as any, 'OVERWRITE', options);

    // Group was updated (lines 223-227)
    expect(prismaMock.group.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'db-group-id' } }),
    );
    // User was updated with remapped groupId (line 243)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'db-user-id' } }),
    );
    // AuditLog was upserted with remapped userId (line 365)
    const auditCall = (prismaMock.auditLog.upsert as any).mock.calls[0][0];
    expect(auditCall.create.userId).toBe('db-user-id');
  });

  it('restores job destinations and job notifications with adapter ID remapping (lines 182-205)', async () => {
    // Adapter merge: existing adapter with same name but different ID -> adapterIdMap is populated
    prismaMock.adapterConfig.findFirst.mockResolvedValueOnce({
      id: 'db-adapter-id',
      name: 'S3 Storage',
      type: 'storage',
    } as any);

    const backup = makeBackup({
      adapters: [{
        id: 'backup-adapter-id',
        name: 'S3 Storage',
        type: 'storage',
        adapterId: 's3-generic',
        config: JSON.stringify({ bucket: 'my-bucket' }),
      }],
      jobs: [{
        id: 'job-1',
        name: 'Daily Backup',
        sourceId: null,
        encryptionProfileId: null,
      }],
      jobDestinations: [{
        id: 'dest-1',
        jobId: 'job-1',
        configId: 'backup-adapter-id', // references the merged adapter
      }],
      jobNotifications: {
        'job-1': ['backup-adapter-id'], // notification adapter also remapped
      },
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // Job destination was upserted with remapped configId (line 186 + lines 182-188)
    const destCall = (prismaMock.jobDestination.upsert as any).mock.calls[0][0];
    expect(destCall.create.configId).toBe('db-adapter-id');

    // Job notifications were restored with remapped adapter IDs (lines 200-205)
    expect(prismaMock.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: { notifications: { set: [{ id: 'db-adapter-id' }] } },
      }),
    );
  });

  it('remaps job sourceId and encryptionProfileId via merge maps, and merges existing job by name (lines 146, 151, 166-167)', async () => {
    // Adapter merge: populates adapterIdMap
    prismaMock.adapterConfig.findFirst.mockResolvedValueOnce({
      id: 'db-adapter-id', name: 'DB Adapter', type: 'database',
    } as any);

    // Profile merge: populates profileIdMap
    prismaMock.encryptionProfile.findFirst.mockResolvedValueOnce({
      id: 'db-profile-id', name: 'My Profile',
    } as any);

    // Job merge: existing job with same name but different ID
    prismaMock.job.findFirst.mockResolvedValueOnce({
      id: 'db-job-id', name: 'Production Backup',
    } as any);

    const backup = makeBackup({
      adapters: [{
        id: 'backup-adapter-id', name: 'DB Adapter', type: 'database',
        adapterId: 'mysql', config: '{}',
      }],
      encryptionProfiles: [{
        id: 'backup-profile-id', name: 'My Profile', description: null,
      }],
      jobs: [{
        id: 'backup-job-id',
        name: 'Production Backup',
        sourceId: 'backup-adapter-id',           // line 146: remapped via adapterIdMap
        encryptionProfileId: 'backup-profile-id', // line 151: remapped via profileIdMap
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // Job was updated (merged) via lines 166-167
    expect(prismaMock.job.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'db-job-id' } }),
    );
  });

  it('logs warning when encryption profile has no secretKey and is not in the database (line 132)', async () => {
    // Profile doesn't exist by name (findFirst -> null) and doesn't exist by ID (findUnique -> null)
    // AND secretKey is absent -> svcLog.warn("Skipping encryption profile...")
    const backup = makeBackup({
      encryptionProfiles: [{
        id: 'profile-no-key',
        name: 'Keyless Profile',
        description: 'exported without secrets',
        // no secretKey field - stripped during export
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // Profile skipped - no upsert or create was called
    expect(prismaMock.encryptionProfile.create).not.toHaveBeenCalled();
    expect(prismaMock.encryptionProfile.upsert).not.toHaveBeenCalled();
  });

  it('skips jobId and userId FK checks when they are absent in statistics items (false branches 349, 368)', async () => {
    const backup = makeBackup({
      statistics: {
        storageSnapshots: [],
        executions: [{ id: 'ex-no-job' }],  // no jobId -> if(remapped.jobId) FALSE branch
        auditLogs: [{ id: 'al-no-user' }],  // no userId -> if(remapped.userId) FALSE branch
        notificationLogs: [],
      },
    });

    const options: RestoreOptions = {
      settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true, statistics: true,
    };

    await importConfiguration(backup as any, 'OVERWRITE', options);

    expect(prismaMock.execution.upsert).toHaveBeenCalled();
    expect(prismaMock.auditLog.upsert).toHaveBeenCalled();
  });

  it('handles statistics object missing auditLogs and notificationLogs keys (false branches 360, 379)', async () => {
    const backup = makeBackup({
      statistics: {
        storageSnapshots: [],
        executions: [],
        // auditLogs absent -> if(data.statistics.auditLogs) FALSE
        // notificationLogs absent -> if(data.statistics.notificationLogs) FALSE
      },
    });

    const options: RestoreOptions = {
      settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true, statistics: true,
    };

    await importConfiguration(backup as any, 'OVERWRITE', options);

    expect(prismaMock.auditLog.upsert).not.toHaveBeenCalled();
    expect(prismaMock.notificationLog.upsert).not.toHaveBeenCalled();
  });

  it('handles statistics object with missing storageSnapshots and executions keys (false branches 335, 344)', async () => {
    const backup = makeBackup({
      statistics: {
        // storageSnapshots absent -> if(data.statistics.storageSnapshots) FALSE
        // executions absent -> if(data.statistics.executions) FALSE
        auditLogs: [],
        notificationLogs: [],
      },
    });

    const options: RestoreOptions = {
      settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true, statistics: true,
    };

    await importConfiguration(backup as any, 'OVERWRITE', options);

    expect(prismaMock.storageSnapshot.upsert).not.toHaveBeenCalled();
    expect(prismaMock.execution.upsert).not.toHaveBeenCalled();
  });

  it('re-encrypts SSO oidcConfig fields - clientId present but no clientSecret (lines 309-310 false branch)', async () => {
    const backup = makeBackup({
      ssoProviders: [{
        id: 'sso-partial',
        providerId: 'okta',
        clientId: 'okta-cid',
        clientSecret: null,
        oidcConfig: JSON.stringify({ clientId: 'okta-cid' }), // no clientSecret in oidcConfig
        name: 'Okta SSO',
        domain: 'okta.com',
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // SSO provider upserted (findUnique returns null from setupMinimalImport)
    expect(prismaMock.ssoProvider.upsert).toHaveBeenCalled();
  });

  it('handles SSO provider with no clientId - skips clientId encryption (line 300 false branch)', async () => {
    const backup = makeBackup({
      ssoProviders: [{
        id: 'sso-no-clientid',
        providerId: 'saml-provider',
        clientId: null, // no clientId -> if(providerData.clientId) FALSE branch
        clientSecret: null,
        oidcConfig: null,
        name: 'SAML SSO',
        domain: 'saml.example.com',
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.ssoProvider.upsert).toHaveBeenCalled();
  });

  it('handles SSO provider with invalid oidcConfig JSON gracefully (line 312 catch branch)', async () => {
    const backup = makeBackup({
      ssoProviders: [{
        id: 'sso-bad-oidc',
        providerId: 'broken-provider',
        clientId: 'cid',
        clientSecret: null,
        oidcConfig: '{INVALID_JSON_CONTENT', // triggers catch in JSON.parse
        name: 'Broken SSO',
        domain: 'broken.com',
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.ssoProvider.upsert).toHaveBeenCalled();
  });

  it('restores user accounts when user is not merged, using original userId (lines 264, 266-274)', async () => {
    // user.findUnique returns null (default) -> user upserted, not merged
    // userIdMap stays empty -> actualUserId = user.id (the ?? fallback, line 264)
    const backup = makeBackup({
      users: [{
        id: 'user-with-accounts',
        email: 'user@example.com',
        groupId: null,
        accounts: [{
          id: 'account-1',
          userId: 'user-with-accounts',
          provider: 'google',
          providerAccountId: 'ga123',
        }],
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.user.upsert).toHaveBeenCalled();
    expect(prismaMock.account.upsert).toHaveBeenCalled();
  });

  it('restores API key as-is when userId is not in userIdMap (line 284 false branch)', async () => {
    // No users in backup -> userIdMap is empty -> userId is not remapped. The user is here already.
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing-user-id' } as any);
    const backup = makeBackup({
      users: [],
      apiKeys: [{ id: 'k1', name: 'Direct Key', hashedKey: 'abc123hash', userId: 'existing-user-id' }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // apiKey.upsert called with the original userId (not remapped)
    const call = (prismaMock.apiKey.upsert as any).mock.calls[0][0];
    expect(call.create.userId).toBe('existing-user-id');
  });

  it('skips settings restore when opts.settings is false (line 41 false branch)', async () => {
    const backup = makeBackup({ settings: [{ key: 'theme', value: 'dark' }] });

    await importConfiguration(backup as any, 'OVERWRITE', {
      settings: false, adapters: true, jobs: true, users: true, sso: true, profiles: true,
    });

    expect(prismaMock.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('restores job destination without configId remapping when adapter not in adapterIdMap (line 185 false)', async () => {
    // The destination is here under its own id, it did not merge.
    prismaMock.adapterConfig.findUnique.mockResolvedValueOnce({ id: 'unknown-adapter-id' } as any);
    const backup = makeBackup({
      jobs: [{ id: 'job-1', name: 'Job 1', sourceId: null, encryptionProfileId: null }],
      jobDestinations: [{
        id: 'dest-1',
        jobId: 'job-1',
        configId: 'unknown-adapter-id', // not in adapterIdMap (no merge happened)
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // configId stays as-is (not remapped)
    const destCall = (prismaMock.jobDestination.upsert as any).mock.calls[0][0];
    expect(destCall.create.configId).toBe('unknown-adapter-id');
  });

  it('restores job notifications with adapter IDs not in adapterIdMap using original IDs (line 200 ?? fallback)', async () => {
    // The channel is here under its own id, it did not merge.
    prismaMock.adapterConfig.findUnique.mockResolvedValueOnce({ id: 'unknown-notif-id' } as any);
    const backup = makeBackup({
      jobs: [{ id: 'job-1', name: 'Job 1', sourceId: null, encryptionProfileId: null }],
      jobNotifications: {
        'job-1': ['unknown-notif-id'], // not in adapterIdMap
      },
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: { notifications: { set: [{ id: 'unknown-notif-id' }] } },
      }),
    );
  });

  it('handles user with no accounts field gracefully (line 266 false branch)', async () => {
    // User object has no accounts field -> accounts = undefined -> if(accounts && ...) FALSE
    const backup = makeBackup({
      users: [{ id: 'u1', email: 'u@example.com', groupId: null }], // no accounts field
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.user.upsert).toHaveBeenCalled();
    expect(prismaMock.account.upsert).not.toHaveBeenCalled();
  });

});

describe('import.ts - credential profile branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMinimalImport();
  });

  it('upserts credential profile when no name collision exists', async () => {
    // findUnique returns null for name check (from setupMinimalImport default)
    const backup = makeBackup({
      credentialProfiles: [
        { id: 'cp1', name: 'SSH Key', type: 'ssh', data: 'plain-secret', description: null, createdAt: new Date(), updatedAt: new Date() },
      ],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.credentialProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cp1' } }),
    );
  });

  it('skips credential profile with empty data and warns', async () => {
    const backup = makeBackup({
      credentialProfiles: [
        { id: 'cp-empty', name: 'Stripped Creds', type: 'ssh', data: '', description: null, createdAt: new Date(), updatedAt: new Date() },
      ],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    expect(prismaMock.credentialProfile.upsert).not.toHaveBeenCalled();
    expect(prismaMock.credentialProfile.update).not.toHaveBeenCalled();
  });

  it('merges credential profile by name collision and builds credentialIdMap for adapter remapping', async () => {
    // Name lookup: existing profile with same name but different ID
    prismaMock.credentialProfile.findUnique
      .mockResolvedValueOnce({ id: 'db-cp-id', name: 'SSH Key' } as any) // name lookup
      .mockResolvedValue({ id: 'db-cp-id' } as any); // adapter FK existence checks

    const backup = makeBackup({
      credentialProfiles: [
        { id: 'backup-cp-id', name: 'SSH Key', type: 'ssh', data: 'plain', description: null, createdAt: new Date(), updatedAt: new Date() },
      ],
      adapters: [{
        id: 'a1', name: 'Adapter 1', type: 'database', adapterId: 'mysql', config: '{}',
        primaryCredentialId: 'backup-cp-id', sshCredentialId: null,
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    // Profile was merged via update (not upsert) at the existing DB ID
    expect(prismaMock.credentialProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'db-cp-id' } }),
    );

    // Adapter's primaryCredentialId was remapped to the existing DB ID
    const adapterCall = (prismaMock.adapterConfig.upsert as any).mock.calls[0][0];
    expect(adapterCall.create.primaryCredentialId).toBe('db-cp-id');
  });

  it('nulls out primaryCredentialId on adapter when the referenced credential does not exist', async () => {
    // findUnique returns null = credential not in DB (default from setupMinimalImport)
    const backup = makeBackup({
      adapters: [{
        id: 'a1', name: 'Adapter 1', type: 'database', adapterId: 'mysql', config: '{}',
        primaryCredentialId: 'nonexistent-cred', sshCredentialId: null,
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    const adapterCall = (prismaMock.adapterConfig.upsert as any).mock.calls[0][0];
    expect(adapterCall.create.primaryCredentialId).toBeNull();
  });

  it('nulls out sshCredentialId on adapter when the referenced credential does not exist', async () => {
    const backup = makeBackup({
      adapters: [{
        id: 'a1', name: 'Adapter 1', type: 'database', adapterId: 'mysql', config: '{}',
        primaryCredentialId: null, sshCredentialId: 'nonexistent-ssh',
      }],
    });

    await importConfiguration(backup as any, 'OVERWRITE');

    const adapterCall = (prismaMock.adapterConfig.upsert as any).mock.calls[0][0];
    expect(adapterCall.create.sshCredentialId).toBeNull();
  });
});

