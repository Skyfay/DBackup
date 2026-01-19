
import { describe, it, expect } from 'vitest';
import { MySQL80Dialect } from '@/lib/adapters/database/mysql/dialects/mysql-8';
import { MySQL57Dialect } from '@/lib/adapters/database/mysql/dialects/mysql-5-7';
import { MariaDBDialect } from '@/lib/adapters/database/mysql/dialects/mariadb';

describe('MySQL Dialects', () => {

    describe('MySQL 8.0+', () => {
        const dialect = new MySQL80Dialect();
        it('should support version 8.0.x', () => {
            expect(dialect.supportsVersion('8.0.32')).toBe(true);
            expect(dialect.supportsVersion('5.7.40')).toBe(false);
        });

        it('should generate dump args', () => {
            const config = { host: 'localhost', port: 3306, user: 'root', password: 'password' };
            const dbs = ['db1'];
            const args = dialect.getDumpArgs(config, dbs);

            expect(args).toContain('-h');
            expect(args).toContain('localhost');
            expect(args).toContain('-P');
            expect(args).toContain('3306');
            expect(args).toContain('-u');
            expect(args).toContain('root');
            // MySQL 8 specifics might effectively be just defaults in the base for now,
            // or specific flags like --column-statistics=0 if needed (though usually handled in code).
            expect(args).toContain('--databases');
            expect(args).toContain('db1');
        });
    });

    describe('MySQL 5.7', () => {
        const dialect = new MySQL57Dialect();

        it('should support version 5.7.x', () => {
             expect(dialect.supportsVersion('5.7.40')).toBe(true);
             expect(dialect.supportsVersion('8.0.0')).toBe(false);
        });
    });

    describe('MariaDB', () => {
        const dialect = new MariaDBDialect();

        it('should support mariadb versions', () => {
            expect(dialect.supportsVersion('10.5.0-MariaDB')).toBe(true);
            expect(dialect.supportsVersion('11.0.0')).toBe(true);
            // Some checks might look for "MariaDB" string or specific version ranges
        });
    });
});
