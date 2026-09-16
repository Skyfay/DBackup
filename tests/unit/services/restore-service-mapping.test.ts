import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/lib/testing/prisma-mock';

const preflightMock = vi.fn().mockResolvedValue(undefined);
const pipelineMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/adapters', () => ({ registerAdapters: vi.fn() }));
vi.mock('@/services/restore/preflight', () => ({ preflightRestore: (...args: unknown[]) => preflightMock(...args) }));
vi.mock('@/services/restore/pipeline', () => ({ runRestorePipeline: (...args: unknown[]) => pipelineMock(...args) }));

const { RestoreService } = await import('@/services/restore/restore-service');

describe('RestoreService database mapping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.execution.create.mockResolvedValue({ id: 'exec-1' } as never);
    });

    it('hands the preflight and the pipeline the same list for an object of renames', async () => {
        // Checking the new names in the preflight while the pipeline ignored the object is how
        // a rename request used to overwrite every database under its original name.
        await new RestoreService().restore({
            storageConfigId: 'storage-1',
            file: 'jobs/nightly.tar',
            targetSourceId: 'source-1',
            databaseMapping: { shop: 'shop_copy' },
        });

        const expected = [{ originalName: 'shop', targetName: 'shop_copy', selected: true }];
        expect(preflightMock.mock.calls[0][0].databaseMapping).toEqual(expected);
        expect(pipelineMock.mock.calls[0][1].databaseMapping).toEqual(expected);
    });

    it('rejects an unreadable mapping before anything starts', async () => {
        await expect(new RestoreService().restore({
            storageConfigId: 'storage-1',
            file: 'jobs/nightly.tar',
            databaseMapping: 'shop' as never,
        })).rejects.toThrow(/databaseMapping/);

        expect(preflightMock).not.toHaveBeenCalled();
        expect(prismaMock.execution.create).not.toHaveBeenCalled();
    });
});
