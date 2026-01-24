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

                // Simple Retry Logic for Flaky Docker environments
                let result;
                for(let i=0; i<3; i++) {
                    if (!adapter.test) throw new Error("Adapter does not implement test method");
                    result = await adapter.test(config as any);
                    if(result.success) break;
                    await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
                }

                if (!result?.success) {
                    console.error(`Connection failed for ${name}:`, result?.message);
                }

                expect(result?.success).toBe(true);
                expect(result?.message).toContain('Connection successful');
            }, 20000); // Increased timeout per test

            // Test 2: Listing
            it('should list databases', async () => {
                const adapter = registry.get(config.type) as DatabaseAdapter;
                if (!adapter.getDatabases) throw new Error("Adapter does not implement getDatabases method");

                let dbs;
                try {
                     dbs = await adapter.getDatabases(config as any);
                } catch (_e) {
                    // Retry once
                    await new Promise(r => setTimeout(r, 2000));
                    dbs = await adapter.getDatabases(config as any);
                }

                expect(Array.isArray(dbs)).toBe(true);
                expect(dbs.length).toBeGreaterThan(0);
            }, 20000);
        });
    });
});
