import { withHost, type ExecutionHost } from "@/lib/transport";
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registry } from '@/lib/core/registry';
import { registerAdapters } from '@/lib/adapters';
import { DatabaseAdapter } from '@/lib/core/interfaces';
import { testDatabases, shouldSkipDatabase } from './test-configs';

/**
 * A MySQL or MariaDB backup holds the stored procedures, functions and events of a database,
 * and they come back with a restore into another name. A login that may not read the events
 * still gets its backup, without them and with a warning, instead of a failed dump.
 */

type Config = { type: string; host: string; port: number; user: string; password: string; database: string };

const SOURCE_DB = 'dbk_content_src';
const TARGET_DB = 'dbk_content_dst';
const NO_EVENT_USER = 'dbk_no_event';
const NO_EVENT_PASSWORD = 'Pw-dbk-12345';

/** Runs statements as the login of the config, with the client the adapter would use. */
async function sql(adapter: DatabaseAdapter, config: Config, statements: string): Promise<string> {
    return withHost(adapter, config, async (host: ExecutionHost) => {
        const client = await host.which('mariadb', 'mysql');
        const result = await host.exec([
            client, '-h', config.host, '-P', String(config.port), '-u', config.user, `-p${config.password}`,
            '--protocol=tcp', '-N', '-s', '-e', statements,
        ]);
        if (result.code !== 0) throw new Error(result.stderr);
        return result.stdout.trim();
    });
}

describe('Integration Tests: what a MySQL dump holds', () => {
    const tempDir = path.join(os.tmpdir(), 'dbm-integration-mysql-content');

    beforeAll(() => {
        registerAdapters();
        fs.mkdirSync(tempDir, { recursive: true });
    });

    afterAll(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    testDatabases
        .filter(({ config }) => config.type === 'mysql' || config.type === 'mariadb')
        .forEach(({ name, config: base }) => {
            const config = base as Config;
            const shouldSkip = shouldSkipDatabase(name, config.type);
            const slug = name.replace(/\s+/g, '_');

            const setUp = (adapter: DatabaseAdapter) => sql(adapter, config, [
                `DROP DATABASE IF EXISTS ${SOURCE_DB}`,
                `DROP DATABASE IF EXISTS ${TARGET_DB}`,
                `CREATE DATABASE ${SOURCE_DB}`,
                `CREATE TABLE ${SOURCE_DB}.t (id INT PRIMARY KEY, v VARCHAR(20))`,
                `INSERT INTO ${SOURCE_DB}.t VALUES (1, 'one')`,
                `CREATE PROCEDURE ${SOURCE_DB}.p_hello() SELECT 'hello'`,
                `CREATE FUNCTION ${SOURCE_DB}.f_add(a INT, b INT) RETURNS INT DETERMINISTIC RETURN a + b`,
                `CREATE EVENT ${SOURCE_DB}.e_tick ON SCHEDULE EVERY 1 DAY DISABLE DO DELETE FROM ${SOURCE_DB}.t WHERE id < 0`,
            ].join('; '));

            const tearDown = (adapter: DatabaseAdapter) => sql(adapter, config, [
                `DROP DATABASE IF EXISTS ${SOURCE_DB}`,
                `DROP DATABASE IF EXISTS ${TARGET_DB}`,
                `DROP USER IF EXISTS '${NO_EVENT_USER}'@'%'`,
            ].join('; '));

            it.skipIf(shouldSkip)(`${name}: keeps a routine and an event through backup and restore`, async () => {
                const adapter = registry.get(config.type) as DatabaseAdapter;
                await setUp(adapter);
                try {
                    const dumpPath = path.join(tempDir, `${slug}.sql`);
                    const source = { ...config, database: SOURCE_DB };
                    await withHost(adapter, source, (host) => adapter.dumpOne!(source as never, SOURCE_DB, dumpPath, host));

                    const dump = fs.readFileSync(dumpPath, 'utf8');
                    expect(dump).toContain('PROCEDURE `p_hello`');
                    expect(dump).toContain('FUNCTION `f_add`');
                    expect(dump).toContain('EVENT `e_tick`');

                    await sql(adapter, config, `CREATE DATABASE ${TARGET_DB}`);
                    await withHost(adapter, config, (host) =>
                        adapter.restoreOne!(config as never, dumpPath, TARGET_DB, host, undefined, undefined, SOURCE_DB)
                    );

                    expect(await sql(adapter, config, `SELECT ${TARGET_DB}.f_add(2, 3)`)).toBe('5');
                    expect(await sql(adapter, config, `SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '${TARGET_DB}'`)).toBe('2');
                    expect(await sql(adapter, config, `SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = '${TARGET_DB}'`)).toBe('e_tick');
                } finally {
                    await tearDown(adapter);
                }
            }, 180000);

            it.skipIf(shouldSkip)(`${name}: leaves out the events of a login that may not read them, with a warning`, async () => {
                const adapter = registry.get(config.type) as DatabaseAdapter;
                await setUp(adapter);
                try {
                    await sql(adapter, config, [
                        `CREATE USER '${NO_EVENT_USER}'@'%' IDENTIFIED BY '${NO_EVENT_PASSWORD}'`,
                        `GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON *.* TO '${NO_EVENT_USER}'@'%'`,
                    ].join('; '));

                    const login = { ...config, user: NO_EVENT_USER, password: NO_EVENT_PASSWORD, database: SOURCE_DB };
                    const warnings: string[] = [];
                    const dumpPath = path.join(tempDir, `${slug}_no_event.sql`);
                    await withHost(adapter, login, (host) =>
                        adapter.dumpOne!(login as never, SOURCE_DB, dumpPath, host, (message, level) => {
                            if (level === 'warning') warnings.push(message);
                        })
                    );

                    const dump = fs.readFileSync(dumpPath, 'utf8');
                    expect(dump).not.toContain('EVENT `e_tick`');
                    expect(dump).toContain('PROCEDURE `p_hello`');
                    expect(warnings.some((warning) => warning.startsWith(`Events of ${SOURCE_DB} left out`))).toBe(true);
                } finally {
                    await tearDown(adapter);
                }
            }, 180000);
        });
});
