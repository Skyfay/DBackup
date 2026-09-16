/**
 * The database half of a seekable archive restore.
 *
 * Each selected dump is pulled by byte range into a temp file, checked against its recorded
 * checksum, handed to the adapter's restoreOne() and removed before the next one starts. Peak
 * disk usage is therefore the largest single dump, not the sum of them.
 */

import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { createHost, resolveTransport } from "@/lib/transport";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { getTargetDatabaseName } from "@/lib/adapters/database/common/tar-utils";
import { openArchiveEntry } from "@/lib/archive/reader";
import { hashingStream } from "@/lib/archive/hashing";
import { EXTENSION_BY_FORMAT } from "@/lib/archive/format";
import { entryKey } from "@/lib/archive/types";
import { getTempDir } from "@/lib/temp-dir";
import type { openArchiveForRestore } from "./file-restore";
import type { ArchiveRestoreCallbacks } from "./archive-restore";
import type { RestoreInput } from "./types";

export type DatabaseMapping = { originalName: string; targetName: string; selected: boolean }[];

/**
 * Which database a dump is restored into.
 *
 * The mapping from the restore page wins. Without one, a plain `targetDatabaseName` still
 * applies when exactly one database is being restored, which is how an API caller has
 * always renamed a single-database restore. With several databases selected it cannot
 * say which one it means, so it is ignored and every dump keeps its own name.
 */
export function resolveDatabaseTarget(
    dbName: string,
    dbMapping: DatabaseMapping | undefined,
    targetDatabaseName: string | undefined,
    selectedCount: number
): string {
    if (dbMapping && dbMapping.length > 0) return getTargetDatabaseName(dbName, dbMapping);
    if (targetDatabaseName && selectedCount === 1) return targetDatabaseName;
    return dbName;
}

/**
 * Restores the selected database entries of an opened archive.
 *
 * Database entries always live in the snapshot's own archive (incrementals never carry them
 * forward), so no chain sibling is ever opened here. Failures are collected per database, so
 * one broken dump does not stop the others.
 */
export async function restoreDatabases(
    input: RestoreInput,
    archive: Awaited<ReturnType<typeof openArchiveForRestore>>,
    selectedDbNames: string[],
    dbMapping: DatabaseMapping | undefined,
    restoredDatabases: string[],
    errors: { entry: string; error: string }[],
    { log, updateProgress }: ArchiveRestoreCallbacks
): Promise<void> {
    if (!input.targetSourceId) {
        throw new Error("Missing targetSourceId: this archive contains database(s) to restore");
    }
    const sourceConfig = await prisma.adapterConfig.findUnique({ where: { id: input.targetSourceId } });
    if (!sourceConfig || sourceConfig.type !== "database") {
        throw new Error("Target source not found");
    }
    const sourceAdapter = registry.get(sourceConfig.adapterId) as DatabaseAdapter | undefined;
    if (!sourceAdapter) {
        throw new Error("Source impl missing");
    }
    if (!sourceAdapter.restoreOne) {
        throw new Error(`Database adapter '${sourceConfig.adapterId}' cannot restore from this backup format`);
    }

    const dbConf = await resolveAdapterConfig(sourceConfig) as Record<string, unknown>;
    dbConf.type = sourceConfig.adapterId;
    if (input.privilegedAuth) dbConf.privilegedAuth = input.privilegedAuth;

    const hasMapping = !!dbMapping && dbMapping.length > 0;
    if (!hasMapping && input.targetDatabaseName && selectedDbNames.length > 1) {
        log(
            `Target database name '${input.targetDatabaseName}' ignored: ${selectedDbNames.length} databases are being restored, so each keeps its own name. Use a database mapping to rename them.`,
            'warning'
        );
    }
    const targetFor = (dbName: string) =>
        resolveDatabaseTarget(dbName, dbMapping, input.targetDatabaseName, selectedDbNames.length);

    // One transport for the whole database portion: the version probe, the
    // prepare step and every restoreOne share a single connection.
    const host = createHost(resolveTransport(sourceAdapter, dbConf));
    try {
        if (sourceAdapter.test) {
            try {
                const testResult = await sourceAdapter.test(dbConf, host) as { success: boolean; version?: string };
                if (testResult.success && testResult.version) {
                    dbConf.detectedVersion = testResult.version;
                    log(`Target server version: ${testResult.version}`, 'info');
                }
            } catch { /* ignore - cosmetic binary-selection hint only */ }
        }

        const targetNames = selectedDbNames.map(targetFor);
        if (sourceAdapter.prepareRestore) {
            log(`Preparing target database(s): ${targetNames.join(', ')}...`, 'info');
            try {
                await sourceAdapter.prepareRestore(dbConf, targetNames, host);
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                throw new Error(`Failed to prepare target database(s): ${message}`);
            }
        }

        const total = selectedDbNames.length;
        for (const [position, dbName] of selectedDbNames.entries()) {
            const dbLine = archive.index.databases.find((d) => d.name === dbName);
            const entry = dbLine ? archive.index.entries.get(entryKey(undefined, dbLine.n)) : undefined;
            if (!dbLine || !entry) {
                errors.push({ entry: `database:${dbName}`, error: "Not found in the archive index" });
                log(`Database '${dbName}' is missing from the archive index`, 'error');
                continue;
            }

            const targetName = targetFor(dbName);
            // The extension matters: SqlPackage refuses a BACPAC without one, and a readable
            // name makes a leftover temp file identifiable.
            const dumpPath = path.join(
                getTempDir(),
                `restore-db-${process.pid}-${crypto.randomUUID()}.${EXTENSION_BY_FORMAT[dbLine.format] ?? "dump"}`
            );

            try {
                log(`Fetching dump for '${dbName}' (${archive.ranged ? "ranged read" : "from downloaded archive"})...`, 'info');
                let digest: string | undefined;
                await pipeline(
                    await openArchiveEntry(archive.source, archive.manifest, entry, archive.masterKey),
                    hashingStream((d) => { digest = d; }),
                    createWriteStream(dumpPath)
                );

                // For an unencrypted archive this is the only integrity check a dump gets, and
                // restoring a damaged one would overwrite a working database with it.
                if (dbLine.h && digest !== dbLine.h) {
                    throw new Error(`Checksum mismatch: expected ${dbLine.h}, got ${digest}`);
                }

                log(`Restoring database: ${dbName} → ${targetName}`, 'info');
                await sourceAdapter.restoreOne(
                    dbConf,
                    dumpPath,
                    targetName,
                    host,
                    (msg, level, type, details) => log(msg, level, type, details),
                    (percent, detail) => {
                        // Each database gets an equal slice of the bar, so a multi-database
                        // restore moves forward instead of restarting at 0 for every dump.
                        const overall = Math.round(((position + Math.min(100, Math.max(0, percent)) / 100) / total) * 100);
                        updateProgress?.(overall, `${dbName}: ${detail ?? `${Math.round(percent)}%`}`);
                    },
                    dbName
                );
                restoredDatabases.push(targetName);
                log(`Database restored: ${targetName}`, 'success');
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                errors.push({ entry: `database:${dbName}`, error: message });
                log(`Failed to restore database '${dbName}': ${message}`, 'error');
            } finally {
                await fs.unlink(dumpPath).catch(() => { });
            }
            updateProgress?.(Math.round(((position + 1) / total) * 100));
        }
    } finally {
        await host.dispose().catch(() => {});
    }
}
