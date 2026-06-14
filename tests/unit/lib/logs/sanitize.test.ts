import { describe, it, expect } from 'vitest';
import { sanitizeLogs } from '@/lib/logs/sanitize';
import type { LogEntry } from '@/lib/core/logs';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        type: 'general',
        message: 'test message',
        ...overrides,
    };
}

describe('sanitizeLogs', () => {
    it('redacts IPv4 addresses in message', () => {
        const result = sanitizeLogs([makeEntry({ message: 'Connected to 192.168.1.100 successfully' })]);
        expect(result[0].message).not.toContain('192.168.1.100');
        expect(result[0].message).toContain('[IP REDACTED]');
    });

    it('redacts IPv6 addresses in message', () => {
        const result = sanitizeLogs([makeEntry({ message: 'Server 2001:db8::1 timed out' })]);
        expect(result[0].message).toContain('[IP REDACTED]');
        expect(result[0].message).not.toContain('2001:db8::1');
    });

    it('redacts mongodb connection string credentials', () => {
        const result = sanitizeLogs([makeEntry({ message: 'mongodb://admin:s3cr3t@host:27017/db' })]);
        expect(result[0].message).not.toContain('s3cr3t');
        expect(result[0].message).toContain('[CREDENTIALS REDACTED]');
    });

    it('redacts postgresql connection string credentials', () => {
        const result = sanitizeLogs([makeEntry({ message: 'Connecting via postgresql://user:pass@host/mydb' })]);
        expect(result[0].message).not.toContain('pass');
        expect(result[0].message).toContain('[CREDENTIALS REDACTED]');
    });

    it('redacts mysql connection string credentials', () => {
        const result = sanitizeLogs([makeEntry({ message: 'mysql://root:topsecret@db/schema' })]);
        expect(result[0].message).not.toContain('topsecret');
        expect(result[0].message).toContain('[CREDENTIALS REDACTED]');
    });

    it('redacts redis connection string credentials', () => {
        const result = sanitizeLogs([makeEntry({ message: 'redis://user:pass@localhost:6379' })]);
        expect(result[0].message).not.toContain('pass');
        expect(result[0].message).toContain('[CREDENTIALS REDACTED]');
    });

    it('redacts credentials in details field', () => {
        const result = sanitizeLogs([makeEntry({ details: 'sftp://user:secret@host/path' })]);
        expect(result[0].details).not.toContain('secret');
        expect(result[0].details).toContain('[CREDENTIALS REDACTED]');
    });

    it('redacts IPv4 addresses in details field', () => {
        const result = sanitizeLogs([makeEntry({ details: 'Timeout on server 172.16.0.5' })]);
        expect(result[0].details).not.toContain('172.16.0.5');
        expect(result[0].details).toContain('[IP REDACTED]');
    });

    it('redacts SENSITIVE_KEYS in context', () => {
        const result = sanitizeLogs([makeEntry({ context: { password: 'my-secret', jobId: 'job-1' } })]);
        expect(result[0].context!.password).toBe('[REDACTED]');
        expect(result[0].context!.jobId).toBe('job-1');
    });

    it('redacts apiKey in context', () => {
        const result = sanitizeLogs([makeEntry({ context: { apiKey: 'sk-secret-key' } })]);
        expect(result[0].context!.apiKey).toBe('[REDACTED]');
    });

    it('redacts IP addresses inside non-sensitive context string values', () => {
        const result = sanitizeLogs([makeEntry({ context: { info: 'server at 10.10.10.10 responded' } })]);
        expect(result[0].context!.info).toContain('[IP REDACTED]');
        expect(result[0].context!.info).not.toContain('10.10.10.10');
    });

    it('redacts nested sensitive keys in context objects', () => {
        const result = sanitizeLogs([makeEntry({ context: { db: { password: 'nested-pass', port: 5432 } } })]);
        expect(result[0].context!.db.password).toBe('[REDACTED]');
        expect(result[0].context!.db.port).toBe(5432);
    });

    it('preserves non-string non-object context values unchanged', () => {
        const result = sanitizeLogs([makeEntry({ context: { count: 42, active: true } })]);
        expect(result[0].context!.count).toBe(42);
        expect(result[0].context!.active).toBe(true);
    });

    it('leaves entries without details or context unchanged', () => {
        const result = sanitizeLogs([makeEntry({ details: undefined, context: undefined })]);
        expect(result[0].details).toBeUndefined();
        expect(result[0].context).toBeUndefined();
    });

    it('leaves clean messages without sensitive content unchanged', () => {
        const result = sanitizeLogs([makeEntry({ message: 'Backup completed successfully' })]);
        expect(result[0].message).toBe('Backup completed successfully');
    });

    it('processes multiple entries independently', () => {
        const logs = [
            makeEntry({ message: 'Server: 10.0.0.1 responded' }),
            makeEntry({ message: 'No sensitive data here' }),
            makeEntry({ message: 'mongodb://user:pass@host/db' }),
        ];
        const result = sanitizeLogs(logs);
        expect(result[0].message).toContain('[IP REDACTED]');
        expect(result[1].message).toBe('No sensitive data here');
        expect(result[2].message).toContain('[CREDENTIALS REDACTED]');
    });
});
