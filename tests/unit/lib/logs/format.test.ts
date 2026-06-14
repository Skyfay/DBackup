import { describe, it, expect } from 'vitest';
import { formatLogsAsText, generateLogFilename, type ExportMeta } from '@/lib/logs/format';
import type { LogEntry } from '@/lib/core/logs';

function makeEntry(msg: string, overrides: Partial<LogEntry> = {}): LogEntry {
    return {
        timestamp: '2024-01-01T10:00:00.000Z',
        level: 'info',
        type: 'general',
        message: msg,
        ...overrides,
    };
}

const baseMeta: ExportMeta = {
    jobName: 'Test Job',
    type: 'Backup',
    status: 'Success',
    startedAt: '2024-01-01T10:00:00.000Z',
};

describe('generateLogFilename', () => {
    it('generates filename with slugified job name and UTC timestamp', () => {
        const name = generateLogFilename('My Backup Job', '2024-03-15T14:30:00.000Z');
        expect(name).toBe('dbackup-my-backup-job-2024-03-15-14-30.log');
    });

    it('replaces special characters with hyphens in slug', () => {
        const name = generateLogFilename('Job/With:Special*Chars', '2024-01-01T00:00:00.000Z');
        expect(name).toMatch(/^dbackup-job-with-special-chars-/);
    });

    it('lowercases the job name', () => {
        const name = generateLogFilename('UPPERCASE JOB', '2024-01-01T00:00:00.000Z');
        expect(name).toMatch(/^dbackup-uppercase-job-/);
    });

    it('truncates slug at 40 characters', () => {
        const longName = 'This is a very long job name that exceeds the forty character limit by far';
        const name = generateLogFilename(longName, '2024-01-01T00:00:00.000Z');
        const slug = name
            .replace(/^dbackup-/, '')
            .replace(/-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.log$/, '');
        expect(slug.length).toBeLessThanOrEqual(40);
    });

    it('returns fallback filename for invalid date', () => {
        const name = generateLogFilename('My Job', 'not-a-date');
        expect(name).toBe('dbackup-my-job.log');
    });

    it('uses UTC hours and minutes', () => {
        const name = generateLogFilename('Job', '2024-06-01T23:45:00.000Z');
        expect(name).toContain('23-45');
    });

    it('pads single-digit hours and minutes with leading zero', () => {
        const name = generateLogFilename('Job', '2024-01-01T08:05:00.000Z');
        expect(name).toContain('08-05');
    });
});

describe('formatLogsAsText', () => {
    it('includes job name, type, and status in header', () => {
        const output = formatLogsAsText([], baseMeta);
        expect(output).toContain('Job:     Test Job');
        expect(output).toContain('Type:    Backup');
        expect(output).toContain('Status:  Success');
    });

    it('includes started timestamp in header', () => {
        const output = formatLogsAsText([], baseMeta);
        expect(output).toContain('Started:');
        expect(output).toContain('2024-01-01');
    });

    it('includes ended timestamp when provided', () => {
        const meta = { ...baseMeta, endedAt: '2024-01-01T10:05:00.000Z' };
        const output = formatLogsAsText([], meta);
        expect(output).toContain('Ended:');
    });

    it('omits ended line when endedAt is not provided', () => {
        const output = formatLogsAsText([], baseMeta);
        expect(output).not.toContain('Ended:');
    });

    it('includes trigger type when provided', () => {
        const meta = { ...baseMeta, triggerType: 'Scheduler' };
        const output = formatLogsAsText([], meta);
        expect(output).toContain('Trigger: Scheduler');
    });

    it('omits trigger line when triggerType is absent', () => {
        const output = formatLogsAsText([], baseMeta);
        expect(output).not.toContain('Trigger:');
    });

    it('groups log entries by stage', () => {
        const logs = [
            makeEntry('Starting up', { stage: 'Initializing' }),
            makeEntry('Pushing file', { stage: 'Uploading' }),
        ];
        const output = formatLogsAsText(logs, baseMeta);
        expect(output).toContain('[STAGE: Initializing]');
        expect(output).toContain('[STAGE: Uploading]');
    });

    it('includes log messages within their stage section', () => {
        const logs = [makeEntry('Backup completed', { stage: 'Done' })];
        const output = formatLogsAsText(logs, baseMeta);
        expect(output).toContain('Backup completed');
    });

    it('appends duration suffix for entries with durationMs >= 1000', () => {
        const logs = [makeEntry('Stage done', { stage: 'Done', durationMs: 2500 })];
        const output = formatLogsAsText(logs, baseMeta);
        expect(output).toContain('[2.5s]');
    });

    it('appends ms for durations under 1 second', () => {
        const logs = [makeEntry('Fast op', { stage: 'Done', durationMs: 150 })];
        const output = formatLogsAsText(logs, baseMeta);
        expect(output).toContain('[150ms]');
    });

    it('renders details block when present', () => {
        const logs = [makeEntry('Output', { stage: 'Done', details: 'line1\nline2' })];
        const output = formatLogsAsText(logs, baseMeta);
        expect(output).toContain('[DETAILS]');
        expect(output).toContain('line1');
        expect(output).toContain('line2');
    });

    it('renders UTC timestamps in HH:MM:SS format', () => {
        const logs = [makeEntry('msg', { timestamp: '2024-01-15T14:30:45.000Z', stage: 'S' })];
        const output = formatLogsAsText(logs, baseMeta);
        expect(output).toContain('14:30:45');
    });

    it('assigns entries without stage to "General" group', () => {
        const logs = [makeEntry('no stage', { stage: undefined })];
        const output = formatLogsAsText(logs, baseMeta);
        expect(output).toContain('[STAGE: General]');
    });

    it('includes stage duration in header when multiple entries share the same stage', () => {
        const logs = [
            makeEntry('start', { timestamp: '2024-01-01T10:00:00.000Z', stage: 'Upload' }),
            makeEntry('end', { timestamp: '2024-01-01T10:00:05.000Z', stage: 'Upload' }),
        ];
        const output = formatLogsAsText(logs, baseMeta);
        expect(output).toContain('[STAGE: Upload]');
        expect(output).toMatch(/\(5\.0s\)/);
    });

    it('includes the DBackup header line', () => {
        const output = formatLogsAsText([], baseMeta);
        expect(output).toContain('DBackup Execution Log');
    });
});
