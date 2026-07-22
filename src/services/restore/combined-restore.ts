import fs from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { DatabaseAdapter, StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { LogLevel, LogType } from "@/lib/core/logs";
import {
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "@/lib/adapters/database/common/tar-utils";
import { extractArchive } from "@/lib/archive/extract";
import { readArchiveManifest, readArchiveIndex } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import { getProfileMasterKey } from "@/services/backup/encryption-service";
import type { RestoreInput } from "./types";

export interface CombinedRestoreCallbacks {
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;
    updateDetail: (detail: string) => void;
}

export interface CombinedRestoreResult {
    status: "Success" | "Partial" | "Failed";
    restoredDatabases: string[];
    restoredDirectories: string[];
    errors: { entry: string; error: string }[];
}

/** Recursively lists every file (absolute paths) under a directory root. */
async function listFilesRecursive(rootDir: string): Promise<string[]> {
    const entries = await fs.readdir(rootDir, { withFileTypes: true, recursive: true } as any);
    const files: string[] = [];
    for (const entry of entries as any[]) {
        if (entry.isFile()) {
            const parentPath = entry.parentPath || entry.path || rootDir;
            files.push(path.join(parentPath, entry.name));
        }
    }
    return files;
}

/**
 * Restores selected database and/or directory entries from a combined (v2) archive. Only ever
 * invoked by pipeline.ts when readManifestVersion(tempFile) === 2 - which, by construction, only
 * happens for archives produced by the combined dump path (executeCombinedDump), so this
 * function never has to handle a "v2 but actually pure-database" case.
 *
 * Mirrors the existing v1 restore path's building blocks (shouldRestoreDatabase/
 * getTargetDatabaseName, prepareRestore-then-restoreOne, per-item success/failure like
 * 03-upload.ts's destination loop) rather than reinventing them.
 */
export async function restoreCombinedArchive(
    tempFile: string,
    input: RestoreInput,
    callbacks: CombinedRestoreCallbacks
): Promise<CombinedRestoreResult> {
    const { log, updateDetail } = callbacks;

    const archiveSource = await localFileSource(tempFile);
    const manifest = await readArchiveManifest(archiveSource);

    // A v2 archive is encrypted per entry, so the master key is needed to read even the
    // index - the file list itself is sealed, deliberately, since paths are usually the
    // most sensitive metadata in a backup.
    const masterKey = manifest.encryption
        ? await getProfileMasterKey(manifest.encryption.profileId)
        : undefined;
    const index = await readArchiveIndex(archiveSource, manifest, { masterKey });

    const allDbEntries = index.databases;
    const allDirEntries = index.directories;

    log(`Combined archive detected: ${allDbEntries.length} database(s), ${allDirEntries.length} directory source(s)`, 'info');

    const dbMapping = Array.isArray(input.databaseMapping)
        ? input.databaseMapping as { originalName: string; targetName: string; selected: boolean }[]
        : undefined;
    // No mapping provided at all = restore every database entry (matches shouldRestoreDatabase's
    // own "no mapping = restore all" convention, used identically by every v1 adapter restore()).
    const selectedDbNames = dbMapping && dbMapping.length > 0
        ? allDbEntries.map((e) => e.name).filter((name) => shouldRestoreDatabase(name, dbMapping))
        : allDbEntries.map((e) => e.name);

    const dirMapping = input.directoryMapping ?? [];
    const selectedDirIds = dirMapping.length > 0
        ? allDirEntries.map((e) => e.src).filter((id) => dirMapping.some((m) => m.entryId === id && m.selected))
        : allDirEntries.map((e) => e.src);

    if (selectedDbNames.length === 0 && selectedDirIds.length === 0) {
        throw new Error("No entries selected for restore");
    }

    // Resolve the database restore target once - all selected DB entries restore into the same
    // target server, exactly like a v1 multi-DB restore today (only the target DB *name* varies
    // per entry, via databaseMapping).
    let sourceAdapter: DatabaseAdapter | undefined;
    let dbConf: Record<string, unknown> | undefined;
    if (selectedDbNames.length > 0) {
        if (!input.targetSourceId) {
            throw new Error("Missing targetSourceId: this archive contains database(s) to restore");
        }
        const sourceConfig = await prisma.adapterConfig.findUnique({ where: { id: input.targetSourceId } });
        if (!sourceConfig || sourceConfig.type !== "database") {
            throw new Error("Target source not found");
        }
        sourceAdapter = registry.get(sourceConfig.adapterId) as DatabaseAdapter;
        if (!sourceAdapter) {
            throw new Error("Source impl missing");
        }
        if (!sourceAdapter.restoreOne) {
            throw new Error(`Database adapter '${sourceConfig.adapterId}' does not support combined restores`);
        }

        dbConf = await resolveAdapterConfig(sourceConfig) as Record<string, unknown>;
        dbConf.type = sourceConfig.adapterId;
        if (input.privilegedAuth) dbConf.privilegedAuth = input.privilegedAuth;

        if (sourceAdapter.test) {
            try {
                const testResult = await sourceAdapter.test(dbConf) as { success: boolean; version?: string };
                if (testResult.success && testResult.version) {
                    dbConf.detectedVersion = testResult.version;
                    log(`Target server version: ${testResult.version}`, 'info');
                }
            } catch { /* ignore - cosmetic binary-selection hint only, mirrors v1 pipeline.ts */ }
        }
    }

    const extractDir = await createTempDir("combined-restore-");
    const restoredDatabases: string[] = [];
    const restoredDirectories: string[] = [];
    const errors: { entry: string; error: string }[] = [];

    try {
        log(`Extracting ${selectedDbNames.length} database(s) and ${selectedDirIds.length} directory source(s)...`, 'info');
        const extracted = await extractArchive(tempFile, extractDir, {
            masterKey,
            selection: {
                databaseNames: selectedDbNames,
                directoryJobSourceIds: selectedDirIds,
            },
        });

        // ── Database entries ──
        if (extracted.databaseFiles.length > 0 && sourceAdapter && dbConf) {
            const restoreOne = sourceAdapter.restoreOne!; // presence already checked when sourceAdapter was resolved above
            const prepareRestore = sourceAdapter.prepareRestore;
            const resolvedDbConf = dbConf;
            const targetNames = extracted.databaseFiles.map((f) => getTargetDatabaseName(f.entry.name, dbMapping));
            if (prepareRestore) {
                log(`Preparing target database(s): ${targetNames.join(', ')}...`, 'info');
                try {
                    await prepareRestore(resolvedDbConf, targetNames);
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    throw new Error(`Failed to prepare target database(s): ${message}`);
                }
            }

            for (const { entry, path: dumpPath } of extracted.databaseFiles) {
                const targetName = getTargetDatabaseName(entry.name, dbMapping);
                log(`Restoring database: ${entry.name} → ${targetName}`, 'info');
                try {
                    await restoreOne(
                        resolvedDbConf,
                        dumpPath,
                        targetName,
                        (msg, level, type, details) => log(msg, level, type, details),
                        undefined,
                        entry.name
                    );
                    restoredDatabases.push(targetName);
                    log(`Database restored: ${targetName}`, 'success');
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    errors.push({ entry: `database:${entry.name}`, error: message });
                    log(`Failed to restore database '${entry.name}': ${message}`, 'error');
                }
            }
        }

        // ── Directory entries ──
        for (const { entry, path: rootPath } of extracted.directoryRoots) {
            if (!selectedDirIds.includes(entry.src)) continue; // e.g. an empty (0-file) unselected dir still appears here

            const mappingEntry = dirMapping.find((m) => m.entryId === entry.src);
            if (!mappingEntry || !mappingEntry.targetConfigId) {
                errors.push({ entry: `directory:${entry.src}`, error: "No restore target specified" });
                log(`Skipping directory '${entry.label}': no restore target specified`, 'warning', 'storage');
                continue;
            }

            try {
                const targetConfig = await prisma.adapterConfig.findUnique({ where: { id: mappingEntry.targetConfigId } });
                if (!targetConfig || targetConfig.type !== "storage") {
                    throw new Error("Restore target adapter not found");
                }
                const targetAdapter = registry.get(targetConfig.adapterId) as StorageAdapter;
                if (!targetAdapter) {
                    throw new Error("Restore target adapter implementation missing");
                }
                const targetConf = await resolveAdapterConfig(targetConfig) as Record<string, unknown>;
                const targetPath = mappingEntry.targetPath || entry.label;

                log(`Restoring directory '${entry.label}' to ${targetConfig.name}:${targetPath}...`, 'info', 'storage');

                const files = await listFilesRecursive(rootPath);
                let uploaded = 0;
                for (const localFile of files) {
                    const relPath = path.relative(rootPath, localFile).split(path.sep).join('/');
                    const remotePath = `${targetPath.replace(/\/+$/, '')}/${relPath}`;
                    const ok = await targetAdapter.upload(targetConf, localFile, remotePath);
                    if (!ok) throw new Error(`Failed to upload ${relPath}`);
                    uploaded++;
                    updateDetail(`${entry.label}: ${uploaded}/${files.length} file(s) restored`);
                }

                restoredDirectories.push(entry.src);
                log(`Directory restored: ${entry.label} (${uploaded} file(s))`, 'success', 'storage');
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                errors.push({ entry: `directory:${entry.src}`, error: message });
                log(`Failed to restore directory '${entry.label}': ${message}`, 'error', 'storage');
            }
        }
    } finally {
        await cleanupTempDir(extractDir);
    }

    const totalSelected = selectedDbNames.length + selectedDirIds.length;
    const totalRestored = restoredDatabases.length + restoredDirectories.length;

    const status: CombinedRestoreResult["status"] =
        totalRestored === 0 ? "Failed" : totalRestored < totalSelected ? "Partial" : "Success";

    return { status, restoredDatabases, restoredDirectories, errors };
}
