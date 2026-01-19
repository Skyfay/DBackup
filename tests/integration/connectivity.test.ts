import { describe, it, expect, beforeAll } from 'vitest';
import { registry } from '@/lib/core/registry';
import { registerAdapters } from '@/lib/adapters';
import { DatabaseAdapter } from '@/lib/core/interfaces';
import { testDatabases } from './test-configs';

describe('Integration Tests: Database Connectivity', () => {

    beforeAll(() => {
        registerAdapters();
    });

    testDatabases.forEach(({ name, config }) => {
        describe(name, () => {
            // Test 1: Connectivity
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

            // Test 2: Listing
            it('should list databases', async () => {
                const adapter = registry.get(config.type) as DatabaseAdapter;
                const dbs = await adapter.getDatabases(config as any);

                expect(Array.isArray(dbs)).toBe(true);
                expect(dbs.length).toBeGreaterThan(0);
            });
        });
    });
});
