import { withHost } from "@/lib/transport";
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { registry } from '@/lib/core/registry';
import { registerAdapters } from '@/lib/adapters';
import { DatabaseAdapter } from '@/lib/core/interfaces';
import { createArchive } from '@/lib/archive/writer';
import { readArchiveManifest, readArchiveIndex, openArchiveEntry } from '@/lib/archive/reader';
import { localFileSource } from '@/lib/archive/sources';
import { EXTENSION_BY_FORMAT } from '@/lib/archive/format';
import { entryKey } from '@/lib/archive/types';
import { dumpFormatFor, hasNativeCompression } from '@/lib/runner/steps/dump-databases';
import { testDatabases, shouldSkipDatabase } from './test-configs';

/**
 * Every backup is a seekable archive, so every adapter's single-database dump has to survive
 * the trip through one: dumped with dumpOne(), packed encrypted and compressed, read back out
 * by its index entry, and restored with restoreOne().
 */
describe('Integration Tests: Seekable Archive Round Trip', () => {
    const tempDir = path.join(os.tmpdir(), 'dbm-integration-archive-roundtrip');
    const masterKey = crypto.randomBytes(32);

    beforeAll(() => {
        registerAdapters();
        fs.mkdirSync(tempDir, { recursive: true });
    });

    afterAll(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    testDatabases.forEach(({ name, config }) => {
        const shouldSkip = shouldSkipDatabase(name, config.type);
        const slug = name.replace(/\s+/g, '_');

        it.skipIf(shouldSkip)(`${name}: dumps, packs, extracts and restores one database`, async () => {
            const adapter = registry.get(config.type) as DatabaseAdapter;
            expect(adapter?.dumpOne).toBeTypeOf('function');
            expect(adapter?.restoreOne).toBeTypeOf('function');

            const format = dumpFormatFor(config.type);
            const extension = EXTENSION_BY_FORMAT[format];

            const [dbName] = await withHost(adapter, config, async (host) =>
                adapter.listDumpEntries
                    ? adapter.listDumpEntries(config as never, [], host)
                    : [String((config as { database: unknown }).database)]
            );

            // 1. Dump one database
            const dumpPath = path.join(tempDir, `${slug}_0001.${extension}`);
            await withHost(adapter, config, (host) => adapter.dumpOne!(config as never, dbName, dumpPath, host));
            const dumpDigest = crypto.createHash('sha256').update(fs.readFileSync(dumpPath)).digest('hex');

            // 2. Pack it the way the runner does
            const archivePath = path.join(tempDir, `${slug}.tar`);
            await createArchive(
                [{ kind: 'database', dbName, path: dumpPath, format, nativeCompression: hasNativeCompression(config.type) }],
                archivePath,
                { sourceType: config.type, compression: 'GZIP', encryption: { masterKey, profileId: 'integration' } }
            );

            // 3. Read it back by its index entry
            const source = await localFileSource(archivePath);
            const manifest = await readArchiveManifest(source);
            const index = await readArchiveIndex(source, manifest, { masterKey });
            const line = index.databases.find((d) => d.name === dbName)!;
            expect(line.h).toBe(dumpDigest);

            const restoredDump = path.join(tempDir, `${slug}_restore.${extension}`);
            const entry = index.entries.get(entryKey(undefined, line.n))!;
            await pipeline(await openArchiveEntry(source, manifest, entry, masterKey), fs.createWriteStream(restoredDump));
            expect(crypto.createHash('sha256').update(fs.readFileSync(restoredDump)).digest('hex')).toBe(dumpDigest);

            // 4. Restore it into the database it came from
            await withHost(adapter, config, (host) =>
                adapter.restoreOne!(config as never, restoredDump, dbName, host, undefined, undefined, dbName)
            );
        }, 180000);
    });
});
