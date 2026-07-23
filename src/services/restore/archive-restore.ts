/**
 * Full restore of a seekable (manifest v2) archive, driven by byte ranges.
 *
 * Replaces the old combined-restore path, which downloaded the entire archive before
 * doing anything. Here the archive is opened remotely: on adapters with ranged reads only
 * the selected entries are ever transferred - restoring just the database out of a 60 GB
 * archive moves only the database's bytes. Adapters without ranges fall back to one full
 * download, which is exactly what the old path always cost.
 *
 * Selection is first-class: databases via the mapping, directory sources whole or as a
 * subset of paths. Nothing is extracted to disk as a whole - database dumps are staged one
 * at a time (peak disk = largest dump), directory files stream through a per-file stage
 * (peak disk = largest file).
 */

import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { DatabaseAdapter, StorageAdapter, AdapterConfig } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { LogLevel, LogType } from "@/lib/core/logs";
import { shouldRestoreDatabase, getTargetDatabaseName } from "@/lib/adapters/database/common/tar-utils";
import { openArchiveEntry } from "@/lib/archive/reader";
import { forEachSnapshotFile, hashingStream } from "@/lib/archive/chain-source";
import { resolveSelection } from "@/lib/archive/browse";
import { entryKey, IndexFileLine } from "@/lib/archive/types";
import { getTempDir } from "@/lib/temp-dir";
import { openArchiveForRestore } from "./file-restore";
import type { RestoreInput } from "./types";

export interface ArchiveRestoreCallbacks {
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;
    updateDetail: (detail: string) => void;
}

export interface ArchiveRestoreResult {
    status: "Success" | "Partial" | "Failed";
    restoredDatabases: string[];
    restoredDirectories: string[];
    errors: { entry: string; error: string }[];
}

interface DirectoryTarget {
    adapter: StorageAdapter;
    config: AdapterConfig;
    basePath: string;
    label: string;
}

/**
 * Restores selected databases and/or directory content from a v2 archive.
 *
 * Invoked by the restore pipeline as soon as the backup's metadata identifies a seekable
 * archive - before any download has happened. Mirrors the old combined-restore semantics
 * (selection conventions, per-item error collection, Success/Partial/Failed) so the
 * pipeline's status handling is unchanged.
 */
export async function restoreArchiveSnapshot(
    input: RestoreInput,
    callbacks: ArchiveRestoreCallbacks
): Promise<ArchiveRestoreResult> {
    const { log, updateDetail } = callbacks;

    // Opens the archive remotely, reads the index (sidecar first), and verifies the chain
    // is complete - a missing sibling archive fails here, by name, before anything runs.
    const archive = await openArchiveForRestore(input.storageConfigId, input.file);

    try {
        const index = archive.index;
        log(
            archive.ranged
                ? "Archive opened with ranged reads - only the selected entries will be transferred."
                : "Destination cannot serve byte ranges - the archive is fetched once in full.",
            'info'
        );
        if (index.deps.length > 0) {
            log(`Incremental snapshot - restore reads from ${index.deps.length + 1} archives of its chain.`, 'info');
        }
        log(`Archive contains ${index.databases.length} database(s) and ${index.directories.length} directory source(s).`, 'info');

        // ── Selection (identical conventions to the old path) ────────────────
        // A scope of 'databases' or 'files' means the other half was deliberately left out
        // of this restore. It is not the same as selecting none of its entries: the
        // excluded half is not reported as skipped and does not turn the result Partial,
        // because the request never asked for it.
        const scope = input.scope ?? 'all';
        const wantsDatabases = scope !== 'files';
        const wantsFiles = scope !== 'databases';

        const dbMapping = Array.isArray(input.databaseMapping)
            ? input.databaseMapping as { originalName: string; targetName: string; selected: boolean }[]
            : undefined;
        // No mapping provided at all = restore every database entry, matching every v1
        // adapter's own convention in shouldRestoreDatabase().
        const selectedDbNames = !wantsDatabases
            ? []
            : dbMapping && dbMapping.length > 0
                ? index.databases.map((d) => d.name).filter((name) => shouldRestoreDatabase(name, dbMapping))
                : index.databases.map((d) => d.name);

        const dirMapping = input.directoryMapping ?? [];
        const selectedDirs = !wantsFiles
            ? []
            : dirMapping.length > 0
                ? index.directories.filter((d) => dirMapping.some((m) => m.entryId === d.src && m.selected))
                : index.directories;

        if (selectedDbNames.length === 0 && selectedDirs.length === 0) {
            throw new Error("No entries selected for restore");
        }

        if (scope !== 'all') {
            log(
                scope === 'databases'
                    ? "Scope: databases only - the archive's directory sources are left untouched."
                    : "Scope: files only - the archive's databases are left untouched.",
                'info'
            );
        }

        const restoredDatabases: string[] = [];
        const restoredDirectories: string[] = [];
        const errors: { entry: string; error: string }[] = [];

        // ── Databases ─────────────────────────────────────────────────────────
        if (selectedDbNames.length > 0) {
            await restoreDatabases(input, archive, selectedDbNames, dbMapping, restoredDatabases, errors, callbacks);
        }

        // ── Directory sources ─────────────────────────────────────────────────
        if (selectedDirs.length > 0) {
            // Resolve every target up front, so a misconfigured source is reported before
            // any bytes move rather than midway through.
            const targets = new Map<string, DirectoryTarget>();
            const workItems: { src: string; file: IndexFileLine }[] = [];
            const perSourceTotals = new Map<string, number>();
            const labels = new Map(index.directories.map((d) => [d.src, d.label]));

            for (const dir of selectedDirs) {
                const mappingEntry = dirMapping.find((m) => m.entryId === dir.src);
                if (!mappingEntry?.targetConfigId) {
                    errors.push({ entry: `directory:${dir.label}`, error: "No restore target specified" });
                    log(`Skipping directory '${dir.label}': no restore target specified`, 'warning', 'storage');
                    continue;
                }

                try {
                    const targetConfig = await prisma.adapterConfig.findUnique({ where: { id: mappingEntry.targetConfigId } });
                    if (!targetConfig || targetConfig.type !== "storage") {
                        throw new Error("Restore target adapter not found");
                    }
                    const targetAdapter = registry.get(targetConfig.adapterId) as StorageAdapter | undefined;
                    if (!targetAdapter) {
                        throw new Error("Restore target adapter implementation missing");
                    }

                    const basePath = mappingEntry.targetPath || dir.label;
                    targets.set(dir.src, {
                        adapter: targetAdapter,
                        config: await resolveAdapterConfig(targetConfig),
                        basePath,
                        label: `${targetConfig.name}:${basePath}`,
                    });
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    errors.push({ entry: `directory:${dir.label}`, error: message });
                    log(`Failed to resolve restore target for '${dir.label}': ${message}`, 'error', 'storage');
                    continue;
                }

                // A subset of paths when the user picked one, the whole source otherwise.
                const files = mappingEntry.paths && mappingEntry.paths.length > 0
                    ? resolveSelection(index, dir.src, mappingEntry.paths)
                    : index.files.filter((f) => f.src === dir.src);

                perSourceTotals.set(dir.src, files.length);
                for (const file of files) workItems.push({ src: dir.src, file });

                log(
                    `Directory '${dir.label}': restoring ${files.length} of ${dir.fileCount} file(s) to ${targets.get(dir.src)!.label}`,
                    'info', 'storage'
                );
            }

            const perSourceDone = new Map<string, number>();
            const perSourceFailed = new Map<string, number>();
            let done = 0;

            await forEachSnapshotFile(archive, workItems, async (file, content) => {
                const target = targets.get(file.src)!;
                const stagePath = path.join(getTempDir(), `restore-${process.pid}-${crypto.randomUUID()}`);
                let digest: string | undefined;

                try {
                    await pipeline(content, hashingStream((d) => { digest = d; }), createWriteStream(stagePath));

                    // For unencrypted archives this is the only integrity check the file
                    // gets - there is no AEAD tag protecting its bytes.
                    if (file.h && digest && digest !== file.h) {
                        throw new Error(`Checksum mismatch: expected ${file.h}, got ${digest}`);
                    }

                    const remotePath = `${target.basePath.replace(/\/+$/, "")}/${file.p}`;
                    if (!(await target.adapter.upload(target.config, stagePath, remotePath))) {
                        throw new Error(`Adapter '${target.adapter.id}' rejected the upload`);
                    }

                    perSourceDone.set(file.src, (perSourceDone.get(file.src) ?? 0) + 1);
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    perSourceFailed.set(file.src, (perSourceFailed.get(file.src) ?? 0) + 1);
                    errors.push({ entry: `${labels.get(file.src) ?? file.src}/${file.p}`, error: message });
                    log(`Failed to restore '${file.p}' to ${target.label}: ${message}`, 'error', 'storage');
                } finally {
                    await fs.unlink(stagePath).catch(() => { });
                }

                done++;
                updateDetail(`Files: ${done}/${workItems.length} restored`);
            });

            for (const dir of selectedDirs) {
                if (!targets.has(dir.src)) continue; // target resolution already failed above
                const failed = perSourceFailed.get(dir.src) ?? 0;
                if (failed === 0) {
                    restoredDirectories.push(dir.src);
                    log(`Directory restored: ${dir.label} (${perSourceDone.get(dir.src) ?? 0} file(s))`, 'success', 'storage');
                } else {
                    log(`Directory '${dir.label}': ${failed} of ${perSourceTotals.get(dir.src)} file(s) failed`, 'error', 'storage');
                }
            }
        }

        const totalSelected = selectedDbNames.length + selectedDirs.length;
        const totalRestored = restoredDatabases.length + restoredDirectories.length;
        const status: ArchiveRestoreResult["status"] =
            totalRestored === 0 ? "Failed" : totalRestored < totalSelected ? "Partial" : "Success";

        return { status, restoredDatabases, restoredDirectories, errors };
    } finally {
        await archive.dispose();
    }
}

/**
 * Restores the selected database entries.
 *
 * Each dump is pulled by byte range into a temp file, restored, and removed before the
 * next one - peak disk usage is the largest single dump, not the sum. Database entries
 * always live in the snapshot's own archive (incrementals never carry them forward), so
 * no chain sibling is ever opened here.
 */
async function restoreDatabases(
    input: RestoreInput,
    archive: Awaited<ReturnType<typeof openArchiveForRestore>>,
    selectedDbNames: string[],
    dbMapping: { originalName: string; targetName: string; selected: boolean }[] | undefined,
    restoredDatabases: string[],
    errors: { entry: string; error: string }[],
    { log }: ArchiveRestoreCallbacks
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
        throw new Error(`Database adapter '${sourceConfig.adapterId}' does not support combined restores`);
    }

    const dbConf = await resolveAdapterConfig(sourceConfig) as Record<string, unknown>;
    dbConf.type = sourceConfig.adapterId;
    if (input.privilegedAuth) dbConf.privilegedAuth = input.privilegedAuth;

    if (sourceAdapter.test) {
        try {
            const testResult = await sourceAdapter.test(dbConf) as { success: boolean; version?: string };
            if (testResult.success && testResult.version) {
                dbConf.detectedVersion = testResult.version;
                log(`Target server version: ${testResult.version}`, 'info');
            }
        } catch { /* ignore - cosmetic binary-selection hint only */ }
    }

    const targetNames = selectedDbNames.map((name) => getTargetDatabaseName(name, dbMapping));
    if (sourceAdapter.prepareRestore) {
        log(`Preparing target database(s): ${targetNames.join(', ')}...`, 'info');
        try {
            await sourceAdapter.prepareRestore(dbConf, targetNames);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            throw new Error(`Failed to prepare target database(s): ${message}`);
        }
    }

    for (const dbName of selectedDbNames) {
        const dbLine = archive.index.databases.find((d) => d.name === dbName);
        const entry = dbLine ? archive.index.entries.get(entryKey(undefined, dbLine.n)) : undefined;
        if (!dbLine || !entry) {
            errors.push({ entry: `database:${dbName}`, error: "Not found in the archive index" });
            log(`Database '${dbName}' is missing from the archive index`, 'error');
            continue;
        }

        const targetName = getTargetDatabaseName(dbName, dbMapping);
        const dumpPath = path.join(getTempDir(), `restore-db-${process.pid}-${crypto.randomUUID()}`);

        try {
            log(`Fetching dump for '${dbName}' (${archive.ranged ? "ranged read" : "from downloaded archive"})...`, 'info');
            await pipeline(
                await openArchiveEntry(archive.source, archive.manifest, entry, archive.masterKey),
                createWriteStream(dumpPath)
            );

            log(`Restoring database: ${dbName} → ${targetName}`, 'info');
            await sourceAdapter.restoreOne(
                dbConf,
                dumpPath,
                targetName,
                (msg, level, type, details) => log(msg, level, type, details),
                undefined,
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
    }
}
