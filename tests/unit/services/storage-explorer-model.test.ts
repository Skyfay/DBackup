import { describe, it, expect } from 'vitest';
import { buildExplorer, jobKeyOf, NO_JOB_KEY, SYSTEM_KEY, type JobRecord } from '@/services/storage/explorer-model';
import type { ExplorerFile } from '@/services/storage/explorer-types';

const NAS = 'nas';
const R2 = 'r2';

function job(overrides: Partial<JobRecord> = {}): JobRecord {
    return {
        id: 'job-shop',
        name: 'Shop nightly',
        incremental: false,
        sourceType: 'postgres',
        sourceName: 'Shop',
        hasFolders: false,
        destinationIds: [NAS, R2],
        ...overrides,
    };
}

function file(day: number, overrides: Partial<ExplorerFile> = {}): ExplorerFile {
    const date = `2026-09-${String(day).padStart(2, '0')}T03:00:00.000Z`;
    return {
        name: `Shop_nightly_2026-09-${day}.tar`,
        path: `Shop nightly/Shop_nightly_2026-09-${day}.tar`,
        size: 100,
        lastModified: date,
        jobId: 'job-shop',
        jobName: 'Shop nightly',
        createdAt: date,
        sourceType: 'postgres',
        ...overrides,
    };
}

describe('jobKeyOf', () => {
    const shop = job();
    const byId = new Map([[shop.id, shop]]);
    const byName = new Map([[shop.name, shop]]);

    it('takes the id of the sidecar, which survives a rename', () => {
        expect(jobKeyOf(file(1, { jobName: 'Old name' }), byId, byName)).toBe('job-shop');
    });

    it('keeps the backups of a deleted job apart from a new job of the same name', () => {
        expect(jobKeyOf(file(1, { jobId: 'job-gone' }), byId, byName)).toBe('deleted:job-gone');
    });

    it('falls back to the name for a file listed without an id', () => {
        expect(jobKeyOf(file(1, { jobId: undefined }), byId, byName)).toBe('job-shop');
        expect(jobKeyOf(file(1, { jobId: undefined, jobName: 'ERP' }), byId, byName)).toBe('deleted-name:ERP');
    });

    it('puts config backups and files without a job into their own groups', () => {
        expect(jobKeyOf(file(1, { sourceType: 'SYSTEM', jobId: undefined }), byId, byName)).toBe(SYSTEM_KEY);
        expect(jobKeyOf(file(1, { jobId: undefined, jobName: 'Unknown' }), byId, byName)).toBe(NO_JOB_KEY);
    });
});

describe('buildExplorer', () => {
    it('puts the copies of one run side by side', () => {
        const model = buildExplorer([job()], [
            { destinationId: NAS, files: [file(22), file(23)] },
            { destinationId: R2, files: [file(22), file(23)] },
        ]);

        const runs = model.runs.get('job-shop')!;
        expect(runs).toHaveLength(2);
        expect(runs[0].createdAt).toBe('2026-09-23T03:00:00.000Z');
        expect(runs[0].copies.map((copy) => [copy.destinationId, copy.state])).toEqual([[NAS, 'stored'], [R2, 'stored']]);
        expect(model.jobs[0]).toMatchObject({ kind: 'job', runs: 2, size: 400, missingCopies: 0 });
    });

    it('reports a copy as missing where the destination already held an older backup', () => {
        const model = buildExplorer([job()], [
            { destinationId: NAS, files: [file(21), file(22), file(23)] },
            { destinationId: R2, files: [file(21), file(23)] },
        ]);

        const run = model.runs.get('job-shop')!.find((entry) => entry.createdAt.startsWith('2026-09-22'))!;
        expect(run.copies).toEqual([
            expect.objectContaining({ destinationId: NAS, state: 'stored' }),
            { destinationId: R2, state: 'missing' },
        ]);
        expect(model.jobs[0].missingCopies).toBe(1);
    });

    it('never reports a copy as missing on an air-gapped destination, which only gets the runs while it is connected', () => {
        const model = buildExplorer([job()], [
            { destinationId: NAS, files: [file(21), file(22), file(23)] },
            { destinationId: R2, files: [file(21), file(23)] },
        ], new Set([R2]));

        const run = model.runs.get('job-shop')!.find((entry) => entry.createdAt.startsWith('2026-09-22'))!;
        expect(run.copies.map((copy) => copy.destinationId)).toEqual([NAS]);
        expect(model.jobs[0].missingCopies).toBe(0);
    });

    it('does not report runs from before a destination joined or past its shorter retention', () => {
        const model = buildExplorer([job()], [
            { destinationId: NAS, files: [file(20), file(21), file(22), file(23)] },
            { destinationId: R2, files: [file(22), file(23)] },
        ]);

        const older = model.runs.get('job-shop')!.filter((run) => run.createdAt < '2026-09-22');
        expect(older).toHaveLength(2);
        for (const run of older) expect(run.copies.map((copy) => copy.destinationId)).toEqual([NAS]);
    });

    it('ignores a locked backup when judging what a destination should hold', () => {
        const model = buildExplorer([job()], [
            { destinationId: NAS, files: [file(10), file(20), file(21)] },
            { destinationId: R2, files: [file(10, { locked: true }), file(21)] },
        ]);

        const run = model.runs.get('job-shop')!.find((entry) => entry.createdAt.startsWith('2026-09-20'))!;
        expect(run.copies.map((copy) => copy.destinationId)).toEqual([NAS]);
    });

    it('holds a destination the job no longer writes to only to the runs it got while it did', () => {
        // Shop wrote to R2 until the 21st, then R2 was taken out of the job.
        const model = buildExplorer([job({ destinationIds: [NAS] })], [
            { destinationId: NAS, files: [file(20), file(21), file(22), file(23)] },
            { destinationId: R2, files: [file(20), file(21)] },
        ]);

        const runs = model.runs.get('job-shop')!;
        expect(runs.flatMap((run) => run.copies).filter((copy) => copy.state === 'missing')).toEqual([]);
        expect(model.jobs[0].missingCopies).toBe(0);
    });

    it('still reports a gap inside the time a destination of a deleted job was written to', () => {
        const gone = (day: number) => file(day, { jobId: 'job-gone', jobName: 'Gone', path: `Gone/${day}.tar` });
        const model = buildExplorer([], [
            { destinationId: NAS, files: [gone(20), gone(21), gone(22), gone(23)] },
            { destinationId: R2, files: [gone(20), gone(22)] },
        ]);

        const missing = model.runs.get('deleted:job-gone')!.filter((run) => run.copies.some((copy) => copy.state === 'missing'));
        expect(missing.map((run) => run.createdAt.slice(0, 10))).toEqual(['2026-09-21']);
    });

    it('lists a deleted job with the name of its newest backup and where its backups lie', () => {
        const model = buildExplorer([job({ id: 'job-other', name: 'Other' })], [
            {
                destinationId: NAS,
                files: [
                    file(1, { jobId: 'job-erp', jobName: 'ERP old', path: 'ERP/a.tar' }),
                    file(2, { jobId: 'job-erp', jobName: 'ERP invoices', path: 'ERP/b.tar' }),
                ],
            },
        ]);

        const erp = model.jobs.find((entry) => entry.key === 'deleted:job-erp')!;
        expect(erp).toMatchObject({ kind: 'deleted', name: 'ERP invoices', jobId: 'job-erp', runs: 2, destinationIds: [NAS], configuredDestinationIds: [] });
    });

    it('keeps an existing job without backups, and drops empty groups of the other kinds', () => {
        const model = buildExplorer([job()], []);
        expect(model.jobs.map((entry) => entry.key)).toEqual(['job-shop']);
        expect(model.runs.get('job-shop')).toEqual([]);
    });

    it('orders jobs, then deleted jobs, then config backups, then files without a job', () => {
        const model = buildExplorer([job()], [
            {
                destinationId: NAS,
                files: [
                    file(1, { jobId: undefined, jobName: 'Unknown', path: 'x.tar' }),
                    file(1, { sourceType: 'SYSTEM', jobId: undefined, jobName: 'Config Backup', path: 'config/c.tar' }),
                    file(1, { jobId: 'job-gone', jobName: 'Gone', path: 'Gone/g.tar' }),
                    file(1),
                ],
            },
        ]);
        expect(model.jobs.map((entry) => entry.kind)).toEqual(['job', 'deleted', 'system', 'none']);
    });
});

describe('buildExplorer in All tenants', () => {
    const ACME_NAS = 'acme-nas';
    const BETA_NAS = 'beta-nas';
    const acmeShop = job({ tenantId: 'acme', destinationIds: [ACME_NAS] });
    const betaShop = job({ id: 'job-beta-shop', tenantId: 'beta', destinationIds: [BETA_NAS] });

    it('gives a file without a job id the job of its own tenant, never one of another tenant with the same name', () => {
        const model = buildExplorer([acmeShop, betaShop], [
            { destinationId: ACME_NAS, tenantId: 'acme', files: [file(22, { jobId: undefined })] },
            { destinationId: BETA_NAS, tenantId: 'beta', files: [file(23, { jobId: undefined })] },
        ]);

        expect(model.runs.get('job-shop')?.map((run) => [run.createdAt.slice(0, 10), run.tenantId])).toEqual([['2026-09-22', 'acme']]);
        expect(model.runs.get('job-beta-shop')?.map((run) => [run.createdAt.slice(0, 10), run.tenantId])).toEqual([['2026-09-23', 'beta']]);
    });

    it('keeps the files without a job and the config backups of two tenants in a group of each tenant', () => {
        const loose = (day: number) => file(day, { jobId: undefined, jobName: 'Unknown', path: `loose-${day}.tar` });
        const config = (day: number) => file(day, { sourceType: 'SYSTEM', jobId: undefined, jobName: 'Config Backup', path: `config/c-${day}.tar` });
        const model = buildExplorer([], [
            { destinationId: ACME_NAS, tenantId: 'acme', files: [loose(1), config(1)] },
            { destinationId: BETA_NAS, tenantId: 'beta', files: [loose(2), loose(3)] },
        ]);

        expect(model.jobs.map((entry) => [entry.key, entry.kind, entry.tenantId, entry.runs])).toEqual([
            [`acme:${SYSTEM_KEY}`, 'system', 'acme', 1],
            [`acme:${NO_JOB_KEY}`, 'none', 'acme', 1],
            [`beta:${NO_JOB_KEY}`, 'none', 'beta', 2],
        ]);
        expect(model.runs.get(`beta:${NO_JOB_KEY}`)?.every((run) => run.jobKey === `beta:${NO_JOB_KEY}` && run.tenantId === 'beta')).toBe(true);
    });

    it('keeps the backups of a deleted job of the same name apart in each tenant', () => {
        const gone = (day: number) => file(day, { jobId: undefined, jobName: 'ERP', path: `ERP/erp-${day}.tar` });
        const model = buildExplorer([], [
            { destinationId: ACME_NAS, tenantId: 'acme', files: [gone(1)] },
            { destinationId: BETA_NAS, tenantId: 'beta', files: [gone(2)] },
        ]);

        expect(model.jobs.map((entry) => [entry.key, entry.kind, entry.name, entry.tenantId])).toEqual([
            ['acme:deleted-name:ERP', 'deleted', 'ERP', 'acme'],
            ['beta:deleted-name:ERP', 'deleted', 'ERP', 'beta'],
        ]);
    });

    it('keeps the keys of today for a single tenant and names its tenant on every job and run', () => {
        const model = buildExplorer([acmeShop], [
            { destinationId: ACME_NAS, tenantId: 'acme', files: [file(22), file(22, { jobId: undefined, jobName: 'Unknown', path: 'x.tar' })] },
        ]);

        expect(model.jobs.map((entry) => [entry.key, entry.tenantId])).toEqual([['job-shop', 'acme'], [NO_JOB_KEY, 'acme']]);
        expect([...model.runs.values()].flat().every((run) => run.tenantId === 'acme')).toBe(true);
    });
});
