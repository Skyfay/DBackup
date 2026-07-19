import { describe, it, expect, vi } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';
import { preflightRestore } from '@/services/restore/preflight';
import { registry } from '@/lib/core/registry';
import { resolveAdapterConfig } from '@/lib/adapters/config-resolver';

vi.mock('@/lib/core/registry', () => ({
    registry: {
        get: vi.fn(),
    },
}));

vi.mock('@/lib/adapters/config-resolver', () => ({
    resolveAdapterConfig: vi.fn().mockResolvedValue({ host: 'localhost' }),
}));

const mockDbConfig = {
    id: 'target-1',
    adapterId: 'postgres',
    type: 'database',
    name: 'Target DB',
    config: '{}',
    createdAt: new Date(),
    updatedAt: new Date(),
};

const mockStorageConfig = {
    id: 'storage-1',
    adapterId: 's3',
    type: 'storage',
    name: 'S3 Storage',
    config: '{}',
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('preflightRestore()', () => {
    it('throws if target source is not found', async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(null);

        await expect(
            preflightRestore({ storageConfigId: 'st-1', file: '/backup.sql', targetSourceId: 'missing' })
        ).rejects.toThrow('Target source not found');
    });

    it('resolves without calling prepareRestore if target is not a database type', async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({
            ...mockDbConfig,
            type: 'storage',
        } as any);
        vi.mocked(registry.get).mockReturnValue(undefined as any);

        await expect(
            preflightRestore({ storageConfigId: 'st-1', file: '/backup.sql', targetSourceId: 'target-1' })
        ).resolves.toBeUndefined();
    });

    it('calls prepareRestore with targetDatabaseName when provided', async () => {
        const prepareRestore = vi.fn().mockResolvedValue(undefined);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockDbConfig as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(null);
        vi.mocked(registry.get).mockReturnValue({ prepareRestore } as any);

        await preflightRestore({
            storageConfigId: 'st-1',
            file: '/backup.sql',
            targetSourceId: 'target-1',
            targetDatabaseName: 'my_db',
        });

        expect(prepareRestore).toHaveBeenCalledWith(
            expect.any(Object),
            ['my_db']
        );
    });

    it('throws on incompatible source/target database types', async () => {
        const testFn = vi.fn().mockResolvedValue({ success: true, version: '14.0' });
        const readFn = vi.fn().mockResolvedValue(JSON.stringify({
            sourceType: 'mysql',
            engineVersion: '8.0',
        }));

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockDbConfig as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockStorageConfig as any);

        vi.mocked(registry.get)
            .mockReturnValueOnce(undefined as any) // no prepareRestore adapter
            .mockReturnValueOnce({ read: readFn } as any)
            .mockReturnValueOnce({ test: testFn } as any);

        await expect(
            preflightRestore({
                storageConfigId: 'st-1',
                file: '/backup.sql',
                targetSourceId: 'target-1',
                targetDatabaseName: 'my_db',
            })
        ).rejects.toThrow("Incompatible database types");
    });

    it('throws when backup version is newer than target server version', async () => {
        const testFn = vi.fn().mockResolvedValue({ success: true, version: '13.0' });
        const readFn = vi.fn().mockResolvedValue(JSON.stringify({
            sourceType: 'postgres',
            engineVersion: '15.0',
        }));

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockDbConfig as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockStorageConfig as any);

        vi.mocked(registry.get)
            .mockReturnValueOnce(undefined as any)
            .mockReturnValueOnce({ read: readFn } as any)
            .mockReturnValueOnce({ test: testFn } as any);

        await expect(
            preflightRestore({
                storageConfigId: 'st-1',
                file: '/backup.sql',
                targetSourceId: 'target-1',
                targetDatabaseName: 'my_db',
            })
        ).rejects.toThrow('not recommended');
    });

    it('succeeds when backup version matches target server version', async () => {
        const testFn = vi.fn().mockResolvedValue({ success: true, version: '14.5' });
        const readFn = vi.fn().mockResolvedValue(JSON.stringify({
            sourceType: 'postgres',
            engineVersion: '14.5',
        }));

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockDbConfig as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockStorageConfig as any);

        vi.mocked(registry.get)
            .mockReturnValueOnce(undefined as any)
            .mockReturnValueOnce({ read: readFn } as any)
            .mockReturnValueOnce({ test: testFn } as any);

        await expect(
            preflightRestore({
                storageConfigId: 'st-1',
                file: '/backup.sql',
                targetSourceId: 'target-1',
                targetDatabaseName: 'my_db',
            })
        ).resolves.toBeUndefined();
    });

    it('skips version check gracefully when meta file is missing', async () => {
        const readFn = vi.fn().mockResolvedValue(null);

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockDbConfig as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockStorageConfig as any);

        vi.mocked(registry.get)
            .mockReturnValueOnce(undefined as any)
            .mockReturnValueOnce({ read: readFn } as any)
            .mockReturnValueOnce({ test: vi.fn() } as any);

        await expect(
            preflightRestore({
                storageConfigId: 'st-1',
                file: '/backup.sql',
                targetSourceId: 'target-1',
            })
        ).resolves.toBeUndefined();
    });

    it('calls prepareRestore with targets from array-format databaseMapping', async () => {
        const prepareRestore = vi.fn().mockResolvedValue(undefined);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockDbConfig as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(null);
        vi.mocked(registry.get).mockReturnValue({ prepareRestore } as any);

        await preflightRestore({
            storageConfigId: 'st-1',
            file: '/backup.sql',
            targetSourceId: 'target-1',
            databaseMapping: [
                { selected: true, originalName: 'db_a', targetName: 'db_new' },
                { selected: false, originalName: 'db_b', targetName: 'db_b' },
            ] as any,
        });

        // Only selected entries with their targetName should be passed
        expect(prepareRestore).toHaveBeenCalledWith(
            expect.any(Object),
            ['db_new'],
        );
    });

    it('calls prepareRestore with values from record-format databaseMapping', async () => {
        const prepareRestore = vi.fn().mockResolvedValue(undefined);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockDbConfig as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(null);
        vi.mocked(registry.get).mockReturnValue({ prepareRestore } as any);

        await preflightRestore({
            storageConfigId: 'st-1',
            file: '/backup.sql',
            targetSourceId: 'target-1',
            databaseMapping: { old_db: 'new_db', shop: 'shop_restored' },
        });

        expect(prepareRestore).toHaveBeenCalledWith(
            expect.any(Object),
            expect.arrayContaining(['new_db', 'shop_restored']),
        );
    });

    it('throws when MSSQL Azure SQL Edge backup is restored to SQL Server', async () => {
        const testFn = vi.fn().mockResolvedValue({
            success: true,
            version: '15.0',
            edition: 'SQL Server',
        });
        const readFn = vi.fn().mockResolvedValue(JSON.stringify({
            sourceType: 'mssql',
            engineVersion: '15.0',
            engineEdition: 'Azure SQL Edge',
        }));

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce({
            ...mockDbConfig,
            adapterId: 'mssql',
        } as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockStorageConfig as any);

        vi.mocked(registry.get)
            .mockReturnValueOnce(undefined as any)
            .mockReturnValueOnce({ read: readFn } as any)
            .mockReturnValueOnce({ test: testFn } as any);

        await expect(
            preflightRestore({
                storageConfigId: 'st-1',
                file: '/backup.bak',
                targetSourceId: 'target-mssql',
            })
        ).rejects.toThrow('Azure SQL Edge');
    });

    it('succeeds when MSSQL edition matches on both sides', async () => {
        const testFn = vi.fn().mockResolvedValue({
            success: true,
            version: '15.0',
            edition: 'Azure SQL Edge',
        });
        const readFn = vi.fn().mockResolvedValue(JSON.stringify({
            sourceType: 'mssql',
            engineVersion: '15.0',
            engineEdition: 'Azure SQL Edge',
        }));

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce({
            ...mockDbConfig,
            adapterId: 'mssql',
        } as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockStorageConfig as any);

        vi.mocked(registry.get)
            .mockReturnValueOnce(undefined as any)
            .mockReturnValueOnce({ read: readFn } as any)
            .mockReturnValueOnce({ test: testFn } as any);

        await expect(
            preflightRestore({
                storageConfigId: 'st-1',
                file: '/backup.bak',
                targetSourceId: 'target-mssql',
            })
        ).resolves.toBeUndefined();
    });

    it('ignores non-critical errors during version check (warns and continues)', async () => {
        // resolveAdapterConfig throws for a non-critical reason
        vi.mocked(resolveAdapterConfig).mockRejectedValueOnce(new Error('Config parse failed'));

        const readFn = vi.fn().mockResolvedValue(JSON.stringify({
            sourceType: 'postgres',
            engineVersion: '14.0',
        }));

        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockDbConfig as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockStorageConfig as any);

        vi.mocked(registry.get)
            .mockReturnValueOnce(undefined as any)
            .mockReturnValueOnce({ read: readFn } as any)
            .mockReturnValueOnce({ test: vi.fn() } as any);

        // Non-critical errors should be swallowed, not rethrown
        await expect(
            preflightRestore({
                storageConfigId: 'st-1',
                file: '/backup.sql',
                targetSourceId: 'target-1',
            })
        ).resolves.toBeUndefined();
    });

    it('applies privilegedAuth to the resolve config during prepareRestore', async () => {
        const prepareRestore = vi.fn().mockResolvedValue(undefined);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(mockDbConfig as any);
        prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(null);
        vi.mocked(registry.get).mockReturnValue({ prepareRestore } as any);

        await preflightRestore({
            storageConfigId: 'st-1',
            file: '/backup.sql',
            targetSourceId: 'target-1',
            targetDatabaseName: 'restore_db',
            privilegedAuth: { user: 'root', password: 'pass' },
        });

        expect(prepareRestore).toHaveBeenCalledWith(
            expect.objectContaining({ privilegedAuth: { user: 'root', password: 'pass' } }),
            ['restore_db'],
        );
    });

    describe('directory entries (combined v2 archives)', () => {
        it('skips the database branch entirely when targetSourceId is omitted (directory-only restore)', async () => {
            // Only the (unrelated, always-run) storage-config lookup happens - no database
            // target is ever queried since targetSourceId was not provided.
            prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(null);

            await expect(
                preflightRestore({
                    storageConfigId: 'st-1',
                    file: '/backup.tar',
                    directoryMapping: [],
                })
            ).resolves.toBeUndefined();

            expect(prismaMock.adapterConfig.findUnique).toHaveBeenCalledTimes(1);
            expect(prismaMock.adapterConfig.findUnique).toHaveBeenCalledWith({ where: { id: 'st-1' } });
        });

        it('verifies each selected directory restore target is writable', async () => {
            const testFn = vi.fn().mockResolvedValue({ success: true, message: 'ok' });
            prismaMock.adapterConfig.findUnique.mockResolvedValueOnce({
                ...mockStorageConfig,
                id: 'dest-local',
                adapterId: 'local-filesystem',
            } as any);
            vi.mocked(registry.get).mockReturnValueOnce({ test: testFn } as any);

            await expect(
                preflightRestore({
                    storageConfigId: 'st-1',
                    file: '/backup.tar',
                    directoryMapping: [
                        { entryId: 'src-1', targetConfigId: 'dest-local', targetPath: '/restore', selected: true },
                    ],
                })
            ).resolves.toBeUndefined();

            expect(testFn).toHaveBeenCalled();
        });

        it('throws when a selected directory restore target is not writable', async () => {
            const testFn = vi.fn().mockResolvedValue({ success: false, message: 'permission denied' });
            prismaMock.adapterConfig.findUnique.mockResolvedValueOnce({
                ...mockStorageConfig,
                id: 'dest-local',
                adapterId: 'local-filesystem',
            } as any);
            vi.mocked(registry.get).mockReturnValueOnce({ test: testFn } as any);

            await expect(
                preflightRestore({
                    storageConfigId: 'st-1',
                    file: '/backup.tar',
                    directoryMapping: [
                        { entryId: 'src-1', targetConfigId: 'dest-local', targetPath: '/restore', selected: true },
                    ],
                })
            ).rejects.toThrow('not writable');
        });

        it('throws when a directory restore target config cannot be found', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(null);

            await expect(
                preflightRestore({
                    storageConfigId: 'st-1',
                    file: '/backup.tar',
                    directoryMapping: [
                        { entryId: 'src-1', targetConfigId: 'missing-dest', targetPath: '/restore', selected: true },
                    ],
                })
            ).rejects.toThrow('not found');
        });

        it('ignores unselected directory mapping entries', async () => {
            prismaMock.adapterConfig.findUnique.mockResolvedValueOnce(null);

            await expect(
                preflightRestore({
                    storageConfigId: 'st-1',
                    file: '/backup.tar',
                    directoryMapping: [
                        { entryId: 'src-1', targetConfigId: 'dest-local', targetPath: '/restore', selected: false },
                    ],
                })
            ).resolves.toBeUndefined();

            // Only the unrelated storage-config lookup happened - the unselected mapping
            // entry's target adapter was never queried.
            expect(prismaMock.adapterConfig.findUnique).toHaveBeenCalledTimes(1);
        });
    });
});
