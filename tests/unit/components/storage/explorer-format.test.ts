import { describe, it, expect } from 'vitest';
import { contentsOf, count, snapshotBytes, startedBy, typeLabel } from '@/components/dashboard/storage/explorer/explorer-format';

describe('how the Storage Explorer words a backup', () => {
    it('names who started the run, with the key or the user when the sidecar has them', () => {
        expect(startedBy({ trigger: { type: 'Scheduler' } })).toEqual({ kind: 'schedule', label: 'Schedule' });
        expect(startedBy({ trigger: { type: 'Api', actor: 'Deploy hook' } })).toEqual({ kind: 'api', label: 'API · Deploy hook' });
        expect(startedBy({ trigger: { type: 'Manual' } })).toEqual({ kind: 'manual', label: 'By hand' });
        expect(startedBy({})).toBeNull();
    });

    it('shows what a restore brings back, which for an incremental is more than its archive', () => {
        expect(snapshotBytes({ size: 120, logicalSize: 8_000 })).toBe(8_000);
        expect(snapshotBytes({ size: 120 })).toBe(120);
    });

    it('tells a full from an incremental and its place in the chain', () => {
        expect(typeLabel({ backupType: 'full' })).toBe('Full');
        expect(typeLabel({ backupType: 'incremental', chain: { id: 'c', type: 'incremental', index: 3 } })).toBe('Incremental · 3');
    });

    it('says what the backup holds', () => {
        expect(contentsOf({ sourceName: 'Shop', sourceType: 'postgres', databases: ['shop', 'billing', 'analytics'] })).toBe('Shop · 3 databases');
        expect(contentsOf({ sourceName: '2 directory source(s)', sourceType: 'directory-only', combined: { databases: 0, directorySources: 2 } })).toBe('2 folders');
        expect(contentsOf({ sourceName: 'CRM', sourceType: 'mysql', combined: { databases: 1, directorySources: 1 } })).toBe('CRM · 1 database + 1 folder');
    });

    it('counts with the right noun', () => {
        expect(count(1, 'copy', 'copies')).toBe('1 copy');
        expect(count(2, 'copy', 'copies')).toBe('2 copies');
        expect(count(3, 'backup')).toBe('3 backups');
    });
});
