import path from "path";
import type { ExecutionHost } from "@/lib/transport";
import type { BackupResult } from "@/lib/core/interfaces";
import type { LogLevel, LogType } from "@/lib/core/logs";
import type { AzureSQLConfig } from "@/lib/adapters/definitions";
import {
    isMultiDbTar,
    readTarManifest,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";
import { resolveExporter } from "./exporter";
import { withPool } from "./pool";
import { validateDatabaseName } from "./identifiers";

type DatabaseMapping = { originalName: string; targetName: string; selected: boolean }[];

/**
 * Restore config as it reaches the adapter.
 *
 * `databaseMapping` arrives as an array despite RestoreInput typing it as a record
 * too. The pipeline passes whatever it was given straight through, and every
 * adapter reads the array form, so that is what is handled here.
 */
type AzureSQLRestoreConfig = AzureSQLConfig & {
    databaseMapping?: DatabaseMapping;
    privilegedAuth?: { user: string; password: string };
};

/** One database to import, and where its BACPAC currently sits locally. */
interface RestoreItem {
    localPath: string;
    targetName: string;
}

/**
 * Import one or more BACPACs into Azure SQL Database.
 *
 * Every target is a database that does not exist yet, which prepareRestore has
 * already verified. SqlPackage creates it as part of the import.
 */
export async function restore(
    config: AzureSQLRestoreConfig,
    sourcePath: string,
    host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void,
): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string, level: LogLevel = "info", type: LogType = "general", details?: string) => {
        logs.push(msg);
        onLog?.(msg, level, type, details);
    };

    const effectiveConfig = applyPrivilegedAuth(config);

    let stagingDir: string | null = null;

    try {
        let items: RestoreItem[];

        if (await isMultiDbTar(sourcePath)) {
            stagingDir = await createTempDir("azure-sql-restore-");
            items = await unpackArchive(sourcePath, stagingDir, config.databaseMapping, log);
        } else {
            items = [{ localPath: sourcePath, targetName: resolveSingleTarget(config) }];
        }

        if (items.length === 0) {
            throw new Error("No databases selected for restore.");
        }

        for (const item of items) {
            await importInto(effectiveConfig, item.localPath, item.targetName, host, log, onProgress);
        }

        log("Restore finished successfully");

        return { success: true, path: sourcePath, logs, startedAt, completedAt: new Date() };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error: ${message}`, "error");
        return { success: false, logs, error: message, startedAt, completedAt: new Date() };
    } finally {
        if (stagingDir) await cleanupTempDir(stagingDir);
    }
}

/**
 * Import a single BACPAC, as produced by dumpOne, into `targetDbName`.
 *
 * Throws instead of returning a result, which is the contract the seekable archive
 * restore expects from every adapter.
 */
export async function restoreOne(
    config: AzureSQLRestoreConfig,
    filePath: string,
    targetDbName: string,
    host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void,
): Promise<void> {
    const log = (msg: string, level: LogLevel = "info", type: LogType = "general", details?: string) =>
        onLog?.(msg, level, type, details);
    validateDatabaseName(targetDbName);
    await importInto(applyPrivilegedAuth(config), filePath, targetDbName, host, log, onProgress);
}

/**
 * The privileged credentials are handed over nested, never flattened, so the adapter has
 * to apply them itself. Same pattern as mysql and postgres.
 */
function applyPrivilegedAuth(config: AzureSQLRestoreConfig): AzureSQLConfig {
    return config.privilegedAuth
        ? { ...config, user: config.privilegedAuth.user, password: config.privilegedAuth.password }
        : config;
}

/** Replace one database with the contents of a local BACPAC. */
async function importInto(
    config: AzureSQLConfig,
    localPath: string,
    targetName: string,
    host: ExecutionHost,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void,
): Promise<void> {
    log(`Restoring into ${targetName}`);
    await dropExistingDatabase(config, targetName, host, log);
    // stageInput is a no-op on a DirectHost, so this hands SqlPackage the very file
    // the pipeline already downloaded.
    await host.stageInput(localPath, {}, (hostPath) =>
        resolveExporter().importDatabase(config, hostPath, targetName, host, log, onProgress),
    );
    log(`Restore completed for ${targetName}`);
}

/**
 * Drop the target database so the import can create it.
 *
 * A BACPAC import always issues its own CREATE DATABASE and has no overwrite mode,
 * so replacing a database means dropping it first. That matches what every other
 * adapter does on a restore, and the restore dialog already had the user choose
 * overwrite over rename before anything got this far.
 *
 * Destructive, and logged as such. Worth knowing if it was the wrong target: Azure
 * keeps a dropped database restorable through **Deleted databases** in the portal
 * for the retention window of its own automated backups.
 */
async function dropExistingDatabase(
    config: AzureSQLConfig,
    name: string,
    host: ExecutionHost,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
): Promise<void> {
    await withPool(config, host, async (pool) => {
        const existing = await pool
            .request()
            .input("dbName", name)
            .query("SELECT name FROM sys.databases WHERE name = @dbName");

        if (existing.recordset.length === 0) return;

        log(
            `Dropping the existing database ${name}. A BACPAC import cannot overwrite in place, and Azure can restore a dropped database from Deleted databases in the portal if this was not intended.`,
            "warning",
        );
        // Bracket quoting through validateDatabaseName, which doubles any `]`. The
        // name reaches here from the restore dialog, so it is user input.
        await pool.request().query(`DROP DATABASE [${validateDatabaseName(name)}]`);
        log(`Dropped ${name}`);
    });
}

/**
 * Extract the selected databases from a multi-database archive.
 *
 * The manifest is what maps a file inside the archive back to its database name,
 * which is why the archive is written with one. Deriving the name from the filename
 * instead, as the MSSQL adapter does, breaks on any database whose name contains
 * the separator being parsed.
 */
async function unpackArchive(
    sourcePath: string,
    stagingDir: string,
    mapping: DatabaseMapping | undefined,
    log: (msg: string, level?: LogLevel) => void,
): Promise<RestoreItem[]> {
    const manifest = await readTarManifest(sourcePath);
    if (!manifest) {
        throw new Error("Archive has no manifest.json and cannot be restored.");
    }

    const selected = manifest.databases
        .map((db) => db.name)
        .filter((name) => shouldRestoreDatabase(name, mapping));

    if (selected.length === 0) return [];

    log(`Extracting ${selected.length} of ${manifest.databases.length} database(s) from the archive`);
    const { manifest: extractedManifest, files } = await extractSelectedDatabases(sourcePath, stagingDir, selected);

    // Matched by filename rather than by array position. extractSelectedDatabases
    // returns the files it wrote, and nothing promises that order matches the
    // manifest once entries have been skipped.
    return files.map((localPath) => {
        const filename = path.basename(localPath);
        const entry = extractedManifest.databases.find((db) => db.filename === filename);
        if (!entry) {
            throw new Error(`Extracted file ${filename} is not listed in the archive manifest.`);
        }
        return { localPath, targetName: getTargetDatabaseName(entry.name, mapping) };
    });
}

/** Target for a single-database backup, which carries no manifest to consult. */
function resolveSingleTarget(config: AzureSQLRestoreConfig): string {
    const selected = config.databaseMapping?.find((m) => m.selected);
    if (selected) return selected.targetName || selected.originalName;

    const database = Array.isArray(config.database) ? config.database[0] : config.database;
    if (!database) {
        throw new Error("No target database specified for restore.");
    }
    return database;
}

/**
 * Database names inside a BACPAC.
 *
 * Unlike a .bak, a BACPAC can be read without a server: it is a ZIP, and a
 * multi-database backup is the shared TAR whose manifest lists them outright.
 * Implementing this saves the analyze route a full download of the archive purely
 * to answer what is inside it.
 */
export async function analyzeDump(sourcePath: string): Promise<string[]> {
    try {
        if (await isMultiDbTar(sourcePath)) {
            const manifest = await readTarManifest(sourcePath);
            return manifest?.databases.map((db) => db.name) ?? [];
        }
    } catch {
        // Unreadable here is not fatal. The caller falls back to the target the user
        // picked, and the restore itself will fail with a better message.
    }

    // A single BACPAC does not record its source database name in a form worth
    // trusting - Origin.xml carries the server it came from, not a name the user
    // would recognise as a restore target.
    return [];
}
