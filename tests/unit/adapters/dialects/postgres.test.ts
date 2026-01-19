
import { describe, it, expect } from 'vitest';
import { PostgresBaseDialect } from '@/lib/adapters/database/postgres/dialects/postgres-base';

describe('PostgreSQL Dialect (Base)', () => {
    const dialect = new PostgresBaseDialect();

    it('should generate correct dump arguments', () => {
        const config = {
            host: 'localhost',
            port: 5432,
            user: 'test_user',
        };
        const databases = ['db1'];
        const args = dialect.getDumpArgs(config, databases);

        expect(args).toContain('-h');
        expect(args).toContain('localhost');
        expect(args).toContain('-p');
        expect(args).toContain('5432');
        expect(args).toContain('-U');
        expect(args).toContain('test_user');
        // We do NOT expect -d yet because the base dialect returns general connection args + dump logic
        // Wait, the dialect logic pushes direct args.
        // Let's check implementation behavior:
        // args: [...connection, ...databases] effectively?
    });
});
