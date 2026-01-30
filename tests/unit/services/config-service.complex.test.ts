
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@/services/config-service';

// --- MOCKS ---

// 1. Mock Crypto to avoid real AES complexity but verify logic flow
vi.mock('@/lib/crypto', async () => {
    return {
        // Simple "encryption" by prefixing
        encrypt: (text: string) => `ENC_${text}`,
        decrypt: (text: string) => text.startsWith('ENC_') ? text.replace('ENC_', '') : text,

        // Config helpers
        encryptConfig: (conf: any) => {
            if (conf.password) conf.password = `ENC_${conf.password}`;
            return conf;
        },
        decryptConfig: (conf: any) => {
            if (conf.password && conf.password.startsWith('ENC_')) {
                conf.password = conf.password.replace('ENC_', '');
            }
            return conf;
        },
        stripSecrets: (conf: any) => {
            if (conf.password) conf.password = "";
            return conf;
        },
        generateKey: () => "MOCK_KEY"
    };
});

// 2. Mock Encryption Service
vi.mock('@/services/encryption-service', () => ({
    getEncryptionProfiles: vi.fn(),
    getProfileMasterKey: vi.fn(),
}));

// 3. Mock Prisma with an In-Memory Store
const { mockDb } = vi.hoisted(() => ({
    mockDb: {
        settings: new Map(),
        adapters: new Map(),
        jobs: new Map(),
        users: new Map(),
        accounts: new Map(),
        groups: new Map(),
        sso: new Map(),
        profiles: new Map(),
    }
}));

vi.mock('@/lib/prisma', () => {
    // Helper must be defined INSIDE the factory or via another hoisted var,
    // but simply defining it here is safest for scope
    const createPrismaDelegate = (store: Map<any, any>, idField = 'id') => ({
        findMany: vi.fn(async (args) => {
            let values = Array.from(store.values());
            if (args?.include?.accounts) {
                 values = values.map((u: any) => ({
                     ...u,
                     accounts: Array.from(mockDb.accounts.values()).filter((a: any) => a.userId === u.id)
                 }));
            }
            return values;
        }),
        findUnique: vi.fn(async ({ where }) => {
            const item = store.get(where[idField]);
            return item || null;
        }),
        upsert: vi.fn(async ({ where, create, update }) => {
            const id = where[idField];
            const existing = store.get(id);
            const data = existing ? { ...existing, ...update } : { ...create, [idField]: id };
            store.set(id, data);
            return data;
        }),
        create: vi.fn(async ({ data }) => {
            store.set(data[idField], data);
            return data;
        }),
        update: vi.fn(async ({ where, data }) => {
            const id = where[idField];
            const existing = store.get(id);
            if (existing) {
                const updated = { ...existing, ...data };
                store.set(id, updated);
                return updated;
            }
            return null;
        })
    });

    return {
        default: {
            systemSetting: createPrismaDelegate(mockDb.settings, 'key'),
            adapterConfig: createPrismaDelegate(mockDb.adapters, 'id'),
            job: createPrismaDelegate(mockDb.jobs, 'id'),
            user: createPrismaDelegate(mockDb.users, 'id'),
            account: createPrismaDelegate(mockDb.accounts, 'id'),
            group: createPrismaDelegate(mockDb.groups, 'id'),
            ssoProvider: createPrismaDelegate(mockDb.sso, 'id'),
            encryptionProfile: createPrismaDelegate(mockDb.profiles, 'id'),
            $transaction: vi.fn(async (callback) => callback(prismaMock)),
        },
    };
});

import prisma from '@/lib/prisma';
const prismaMock = prisma as any;

describe('ConfigService Lifecycle (Complex)', () => {
    let service: ConfigService;

    beforeEach(() => {
        service = new ConfigService();

        // Reset In-Memory DB
        Object.values(mockDb).forEach(map => map.clear());

        // --- SEED INITIAL DATA ---

        // 1. Adapter (Encrypted in DB)
        mockDb.adapters.set('adapter-1', {
            id: 'adapter-1',
            name: 'Production DB',
            type: 'database',
            config: JSON.stringify({ host: 'localhost', password: 'ENC_super_secret' })
        });

        // 2. User with Account (Password Hash)
        mockDb.users.set('user-1', {
            id: 'user-1',
            name: 'Admin',
            email: 'admin@example.com'
        });
        mockDb.accounts.set('acc-1', {
            id: 'acc-1',
            userId: 'user-1',
            providerId: 'credential',
            password: 'HASHED_PASSWORD_123',
            accessToken: 'ACCESS_TOKEN_XYZ'
        });

        // 3. Encryption Profile (Encrypted Master Key)
        mockDb.profiles.set('profile-1', {
            id: 'profile-1',
            name: 'Offsite Backup',
            secretKey: 'ENC_MASTER_KEY_ABC'
        });

        // 4. Job
        mockDb.jobs.set('job-1', {
            id: 'job-1',
            name: 'Daily Backup',
            encryptionProfileId: 'profile-1' // Relies on profile
        });
    });

    describe('Export Logic', () => {
        it('should NOT export secrets when includeSecrets=false', async () => {
            const backup = await service.export(false);

            // Check Adapter
            const adapter = backup.adapters.find(a => a.id === 'adapter-1');
            expect(adapter).toBeDefined();
            const conf = JSON.parse(adapter!.config);
            expect(conf.password).toBe(""); // Stripped

            // Check Encryption Profile
            const profile = backup.encryptionProfiles.find(p => p.id === 'profile-1');
            expect(profile).toBeDefined();
            expect((profile as any).secretKey).toBeUndefined(); // Key removed

            // Check User Accounts
            const user = backup.users.find(u => u.id === 'user-1');
            expect(user).toBeDefined();
            expect(user!.accounts).toHaveLength(1);
            expect(user!.accounts[0].password).toBeNull(); // Nulled
            expect(user!.accounts[0].accessToken).toBeNull(); // Nulled
        });

        it('should export secrets when includeSecrets=true', async () => {
            const backup = await service.export(true);

            // Check Adapter
            const adapter = backup.adapters.find(a => a.id === 'adapter-1');
            expect(adapter).toBeDefined();
            const conf = JSON.parse(adapter!.config);
            expect(conf.password).toBe("super_secret"); // Decrypted!

            // Check Encryption Profile
            const profile = backup.encryptionProfiles.find(p => p.id === 'profile-1');
            expect((profile as any).secretKey).toBe("MASTER_KEY_ABC"); // Decrypted!

            // Check User Accounts
            const user = backup.users.find(u => u.id === 'user-1');
            expect(user).toBeDefined();
            expect(user!.accounts[0].password).toBe("HASHED_PASSWORD_123"); // Preserved
            expect(user!.accounts[0].accessToken).toBe("ACCESS_TOKEN_XYZ"); // Preserved
        });
    });

    describe('Import Logic', () => {
        it('should restore configuration and re-encrypt secrets', async () => {
            // 1. Generate a backup WITH secrets
            const backup = await service.export(true);

            // 2. Wipe the DB (Simulate fresh install)
            mockDb.adapters.clear();
            mockDb.users.clear();
            mockDb.accounts.clear();
            mockDb.profiles.clear();

            // 3. Import
            await service.import(backup, 'OVERWRITE');

            // 4. Verify Adapter Restoration
            const restoredAdapter = mockDb.adapters.get('adapter-1');
            expect(restoredAdapter).toBeDefined();
            const resConf = JSON.parse(restoredAdapter.config);
            // Must be re-encrypted (mock encrypt adds ENC_)
            expect(resConf.password).toBe("ENC_super_secret");

            // 5. Verify User Account Restoration
            const restoredUser = mockDb.users.get('user-1');
            const restoredAccount = mockDb.accounts.get('acc-1');

            expect(restoredUser).toBeDefined();
            expect(restoredAccount).toBeDefined();
            // Passwords should be back
            expect(restoredAccount.password).toBe("HASHED_PASSWORD_123");

            // 6. Verify Encryption Profile Re-encryption
            const restoredProfile = mockDb.profiles.get('profile-1');
            expect(restoredProfile).toBeDefined();
            // Should be re-encrypted
            expect(restoredProfile.secretKey).toBe("ENC_MASTER_KEY_ABC");
        });

        it('should properly detach accounts from user before upsert to avoid Prisma errors', async () => {
            // This tests the code path: const { accounts, ...userFields } = user;

            const backup = await service.export(true);

            // Spy on user upsert to ensure accounts are NOT passed
            const userUpsertSpy = vi.spyOn(prismaMock.user, 'upsert');
            const accountUpsertSpy = vi.spyOn(prismaMock.account, 'upsert');

            await service.import(backup, 'OVERWRITE');

            // Logic check: userUpsert called with object NOT having accounts
            const userCall = userUpsertSpy.mock.calls[0][0]; // { where, create, update }
            expect((userCall as any).create).not.toHaveProperty('accounts');
            expect((userCall as any).update).not.toHaveProperty('accounts');

            // Logic check: account upsert called separately
            expect(accountUpsertSpy).toHaveBeenCalled();
        });

        it('should handle import from stripped backup (no secrets)', async () => {
            // 1. Generate STRIPPED backup
            const backup = await service.export(false);

            // 2. Wipe DB
            mockDb.users.clear();
            mockDb.accounts.clear();

            // 3. Import
            await service.import(backup, 'OVERWRITE');

            // 4. Verify Account
            const acc = mockDb.accounts.get('acc-1');
            expect(acc).toBeDefined();
            expect(acc.password).toBeNull(); // Should be null from import
        });
    });

    describe('Edge Cases & Validation', () => {
        it('should throw error if metadata is missing', async () => {
            const badBackup: any = { adapters: [] }; // No metadata
            await expect(service.import(badBackup, 'OVERWRITE')).rejects.toThrow("Missing metadata");
        });

        it('should handle selective restore (e.g. only restore Settings, ignore Users)', async () => {
             // 1. Setup DB with existing User
             mockDb.users.clear();
             mockDb.users.set('existing-user', { id: 'existing-user', name: 'Original' });

             // 2. Prepare Backup with Different User & Settings
             const backup: any = {
                 metadata: { version: '1.0.0' },
                 settings: [{ key: 'new.setting', value: '123' }],
                 users: [{ id: 'new-user', name: 'New Guy' }],
                 // fill other required arrays empty
                 adapters: [], jobs: [], groups: [], ssoProviders: [], encryptionProfiles: []
             };

             // 3. Import with Options (Settings=True, Users=False)
             await service.import(backup, 'OVERWRITE', {
                 settings: true,
                 users: false, // SKIP USERS
                 adapters: false, jobs: false, sso: false, profiles: false
             });

             // 4. Verify System Setting was created
             expect(mockDb.settings.get('new.setting')).toBeDefined();

             // 5. Verify User was NOT created/overwritten
             expect(mockDb.users.get('new-user')).toBeUndefined();
             expect(mockDb.users.get('existing-user')).toBeDefined();
        });

        it('should fix referential integrity (Job referencing missing Profile)', async () => {
            // Scenario: Backup contains a Job that points to Profile 'p-missing',
            // but Profile 'p-missing' is NOT in the backup (or failed to restore).

            const backup: any = {
                metadata: { version: '1.0.0' },
                encryptionProfiles: [], // Empty profiles
                jobs: [{
                    id: 'broken-job',
                    name: 'Broken Job',
                    encryptionProfileId: 'p-missing'
                }],
                // fill others
                settings: [], adapters: [], users: [], groups: [], ssoProviders: []
            };

            await service.import(backup, 'OVERWRITE');

            const restoredJob = mockDb.jobs.get('broken-job');
            expect(restoredJob).toBeDefined();
            // Service should handle this by setting it to null to prevent crash
            expect(restoredJob.encryptionProfileId).toBeNull();
        });

        it('should handle SSO secrets correctly', async () => {
             // 1. Setup SSO Provider
             mockDb.sso.set('sso-1', {
                 id: 'sso-1',
                 domain: 'google.com',
                 clientSecret: 'GoogleSecret',
                 oidcConfig: JSON.stringify({ clientId: '123', clientSecret: 'GoogleSecret' })
             });

             // 2. Export NO Secrets
             const safeBackup = await service.export(false);
             const safeProvider = safeBackup.ssoProviders.find(p => p.id === 'sso-1');
             expect(safeProvider!.clientSecret).toBe("");
             const safeOidc = JSON.parse(safeProvider!.oidcConfig!);
             expect(safeOidc.clientSecret).toBe(""); // Should ideally be stripped too if logic exists

             // 3. Export WITH Secrets
             const fullBackup = await service.export(true);
             const fullProvider = fullBackup.ssoProviders.find(p => p.id === 'sso-1');
             expect(fullProvider!.clientSecret).toBe("GoogleSecret");
        });

        it('should NOT overwrite existing Encryption Profile keys (Security Stability)', async () => {
             // This ensures that if we import a backup that contains a definition for "Profile A",
             // but "Profile A" already exists on the system with a different key, we do NOT overwrite the key.
             // Overwriting the key would render all existing backups on the disk useless.

             // 1. Existing System State
             mockDb.profiles.set('p-critical', {
                 id: 'p-critical',
                 name: 'System Profile',
                 secretKey: 'ENC_SYSTEM_KEY_111' // The valid key for current files
             });

             // 2. Backup State (Older version or from another server)
             const backup: any = {
                 metadata: { version: '1.0.0' },
                 encryptionProfiles: [{
                     id: 'p-critical',
                     name: 'Old Name',
                     description: 'New Desc',
                     secretKey: 'PLAIN_KEY_222' // Different key
                 }],
                 settings: [], adapters: [], jobs: [], users: [], groups: [], ssoProviders: [],
                 options: { profiles: true }
             };

             // 3. Import
             await service.import(backup, 'OVERWRITE');

             // 4. Verify
             const profile = mockDb.profiles.get('p-critical');
             expect(profile.name).toBe('Old Name'); // Updates non-sensitive fields
             expect(profile.description).toBe('New Desc'); // Updates non-sensitive fields
             expect(profile.secretKey).toBe('ENC_SYSTEM_KEY_111'); // KEY MUST REMAIN UNCHANGED
        });

        it('should handle invalid/corrupt JSON in Adapter Config gracefully', async () => {
             // 1. Backup with corrupt JSON string
             const backup: any = {
                 metadata: { version: '1.0.0' },
                 adapters: [{
                     id: 'bad-adapter',
                     name: 'Bad',
                     type: 'mysql',
                     config: '{ "host": "localhost", "port": ... BROKEN JSON ... }'
                 }],
                 settings: [], jobs: [], users: [], groups: [], ssoProviders: [], encryptionProfiles: []
             };

             // 2. Import should NOT throw
             await service.import(backup, 'OVERWRITE');

             // 3. Verify it was created (empty config or raw)
             const adapter = mockDb.adapters.get('bad-adapter');
             expect(adapter).toBeDefined();
             // The service tries to parse, fails, then upserts the raw object?
             // Looking at code:
             // try { configObj = JSON.parse(adapter.config) } catch {}
             // configObj = encryptConfig(configObj); -> if configObj was {}, it remains {}
             // JSON.stringify({}) -> "{}"
             expect(adapter.config).toBe("{}");
        });

        it('should confirm OVERWRITE strategy actually updates values', async () => {
             // 1. Existing Setting
             mockDb.settings.set('site.url', { key: 'site.url', value: 'http://old.com' });

             // 2. Backup with new value
             const backup: any = {
                 metadata: { version: '1.0.0' },
                 settings: [{ key: 'site.url', value: 'http://new.com' }],
                 adapters: [], jobs: [], users: [], groups: [], ssoProviders: [], encryptionProfiles: []
             };

             // 3. Import
             await service.import(backup, 'OVERWRITE');

             // 4. Verify Update
             expect(mockDb.settings.get('site.url').value).toBe('http://new.com');
        });
    });
});
