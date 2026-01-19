
import { describe, it, expect } from 'vitest';
import { MongoDBBaseDialect } from '@/lib/adapters/database/mongodb/dialects/mongodb-base';

describe('MongoDB Dialect', () => {
    const dialect = new MongoDBBaseDialect();

    it('should support any version by default', () => {
        expect(dialect.supportsVersion('4.4')).toBe(true);
        expect(dialect.supportsVersion('7.0')).toBe(true);
    });

    it('should generate uri-based dump args', () => {
        const config = { uri: 'mongodb://user:pass@host:27017' };
        // Assuming dumpMongo passes empty array if ALL dbs, or specific list
        const args = dialect.getDumpArgs(config, []);
        expect(args).toContain('--uri=mongodb://user:pass@host:27017');
    });

    it('should generate host/port args', () => {
        const config = { host: 'localhost', port: 27017 };
        const args = dialect.getDumpArgs(config, []);
        expect(args).toContain('--host');
        expect(args).toContain('localhost');
        expect(args).toContain('--port');
        expect(args).toContain('27017');
    });

    it('should include authentication args', () => {
        const config = { host: 'localhost', port: 27017, user: 'admin', password: 'password', authenticationDatabase: 'admin' };
        const args = dialect.getDumpArgs(config, []);
        expect(args).toContain('--username');
        expect(args).toContain('admin');
        expect(args).toContain('--password');
        expect(args).toContain('password');
        expect(args).toContain('--authenticationDatabase');
        expect(args).toContain('admin');
    });
});
