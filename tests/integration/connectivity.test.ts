import { describe, it, expect, beforeAll } from 'vitest';
import { registry } from '@/lib/core/registry';
import { registerAdapters } from '@/lib/adapters';
import { DatabaseAdapter } from '@/lib/core/interfaces';

// Configuration for all test instances
const databases = [
    {
        name: 'MySQL 8.0',
        config: {
            type: 'mysql',
            host: 'localhost',
            port: 33308,
            user: 'root',
            password: 'rootpassword',
            database: 'testdb'
        }
    },
    {
        name: 'MySQL 5.7',
        config: {
            type: 'mysql',
            host: 'localhost',
            port: 33357,
            user: 'root',
            password: 'rootpassword',
            database: 'testdb'
        }
    },
    {
        name: 'MariaDB 11',
        config: {
            type: 'mariadb',
            host: 'localhost',
            port: 33311,
            user: 'root',
            password: 'rootpassword',
            database: 'testdb'
        }
    },
    {
        name: 'PostgreSQL 16',
        config: {
            type: 'postgres',
            host: 'localhost',
            port: 54416,
            user: 'testuser',
            password: 'testpassword',
            database: 'testdb'
        }
    },
    {
        name: 'PostgreSQL 12',
        config: {
            type: 'postgres',
            host: 'localhost',
            port: 54412,
            user: 'testuser',
            password: 'testpassword',
            database: 'testdb'
        }
    },
    {
        name: 'MongoDB 6',
        config: {
            type: 'mongodb',
            host: 'localhost',
            port: 27717,
            user: 'root',
            password: 'rootpassword',
            database: 'testdb' // Auth DB usually admin, but adapter handles uri construction
        }
    }
];

describe('Integration Tests: Database Connectivity', () => {

    beforeAll(() => {
        registerAdapters();
    });

    databases.forEach(({ name, config }) => {
        describe(name, () => {
            it('should successfully connect', async () => {
                const adapter = registry.get(config.type) as DatabaseAdapter;
                if (!adapter) throw new Error(`Adapter ${config.type} not found`);

                const result = await adapter.test(config as any);

                if (!result.success) {
                    console.error(`Connection failed for ${name}:`, result.message);
                }

                expect(result.success).toBe(true);
                expect(result.message).toContain('Connection successful');
            });

            it('should list databases', async () => {
                const adapter = registry.get(config.type) as DatabaseAdapter;
                const dbs = await adapter.getDatabases(config as any);

                expect(Array.isArray(dbs)).toBe(true);
                expect(dbs.length).toBeGreaterThan(0);

                // Should at least contain the test database or system dbs
                // Note: MongoDB listing might depend on auth roles
            });
        });
    });
});
