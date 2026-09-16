import fs from "fs/promises";
import path from "path";
import type { ExecutionHost } from "@/lib/transport";
import type { BackupResult } from "@/lib/core/interfaces";
import type { LogLevel, LogType } from "@/lib/core/logs";
import type { AzureSQLConfig } from "@/lib/adapters/definitions";
import { formatBytes } from "@/lib/utils";
import { createMultiDbTar, createTempDir, cleanupTempDir } from "../common/tar-utils";
import type { TarFileEntry } from "../common/types";
import { getDatabases } from "./connection";
import { resolveExporter } from "./exporter";

/**
 * A BACPAC of a live database is not a point-in-time copy.
 *
 * Microsoft is explicit that an export running against a database being written to
 * can produce a package that is transactionally and referentially inconsistent, and
 * that such a package can fail to import later. DBackup exports directly rather
 * than from a copy, so this is stated in the run log of every backup, before the
 * export starts rather than after it succeeds. A line that appears only in the
 * documentation is a line nobody reads until they have already lost something.
 */
const CONSISTENCY_NOTICE =
    "A BACPAC export is not transactionally consistent while the database is being written to. " +
    "For a guaranteed-consistent backup, quiesce writes for the duration, or export from a copy made with CREATE DATABASE ... AS COPY OF.";

/**
 * Export one or more databases to BACPAC.
 *
 * A single database lands as a plain .bacpac at destinationPath. Several are packed
 * into the shared multi-database TAR with a real manifest, which is what lets the
 * runner rename the file and record the database names without opening it.
 */
export async function dump(
    config: AzureSQLConfig,
    destinationPath: string,
    host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    _onProgress?: (percentage: number) => void,
): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string, level: LogLevel = "info", type: LogType = "general", details?: string) => {
        logs.push(msg);
        onLog?.(msg, level, type, details);
    };

    try {
        const databases = await resolveDatabases(config, host, log);
        const exporter = resolveExporter();

        log(CONSISTENCY_NOTICE, "warning");

        if (databases.length === 1) {
            // captureOutput is a no-op on the DirectHost this adapter always
            // resolves to, so SqlPackage writes straight to the runner's temp file
            // and the size-polling progress in 02-dump.ts sees it grow.
            await host.captureOutput(destinationPath, {}, (hostPath) =>
                exporter.exportDatabase(config, databases[0], hostPath, host, log),
            );
        } else {
            await exportMany(config, databases, destinationPath, host, exporter, log);
        }

        const stats = await fs.stat(destinationPath);
        if (stats.size === 0) {
            throw new Error("Export produced an empty file. Check the run log for SqlPackage errors.");
        }

        // formatBytes rather than a hand-rolled division. A BACPAC of a small
        // database is a few kilobytes, and fixed MB reported that as "0.00 MB".
        log(`Backup finished successfully. Size: ${formatBytes(stats.size)}`);

        return {
            success: true,
            path: destinationPath,
            size: stats.size,
            logs,
            startedAt,
            completedAt: new Date(),
        };
    } catch (error: unknown) {
        // Not logged here. The caller turns this into a thrown "Dump failed: ..."
        // that the runner reports, and logging it too would put the same failure in
        // the run log twice.
        return {
            success: false,
            logs,
            error: error instanceof Error ? error.message : String(error),
            startedAt,
            completedAt: new Date(),
        };
    }
}

/**
 * Export one database to a plain BACPAC at destinationPath, without the multi-database TAR.
 *
 * The consistency notice is logged for every database, because each export is its own
 * window in which writes can make the package inconsistent.
 */
export async function dumpOne(
    config: AzureSQLConfig,
    dbName: string,
    destinationPath: string,
    host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
): Promise<{ size: number }> {
    const log = (msg: string, level: LogLevel = "info", type: LogType = "general", details?: string) =>
        onLog?.(msg, level, type, details);

    log(CONSISTENCY_NOTICE, "warning");
    await host.captureOutput(destinationPath, {}, (hostPath) =>
        resolveExporter().exportDatabase(config, dbName, hostPath, host, log),
    );

    const stats = await fs.stat(destinationPath);
    if (stats.size === 0) {
        throw new Error("Export produced an empty file. Check the run log for SqlPackage errors.");
    }
    return { size: stats.size };
}

/** The job's database selection, or every user database when nothing was picked. */
async function resolveDatabases(
    config: AzureSQLConfig,
    host: ExecutionHost,
    log: (msg: string, level?: LogLevel) => void,
): Promise<string[]> {
    let databases: string[] = [];

    if (Array.isArray(config.database)) {
        databases = config.database.filter((s) => s && s.trim().length > 0);
    } else if (typeof config.database === "string" && config.database.includes(",")) {
        databases = config.database.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    } else if (typeof config.database === "string" && config.database.trim().length > 0) {
        databases = [config.database.trim()];
    }

    if (databases.length === 0) {
        log("No databases selected, discovering all user databases");
        databases = await getDatabases(config, host);
        if (databases.length === 0) {
            throw new Error("No user databases found on this server.");
        }
        log(`Found ${databases.length} database(s): ${databases.join(", ")}`);
    }

    return databases;
}

/** Export each database to its own BACPAC, then pack them with a manifest. */
async function exportMany(
    config: AzureSQLConfig,
    databases: string[],
    destinationPath: string,
    host: ExecutionHost,
    exporter: ReturnType<typeof resolveExporter>,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
): Promise<void> {
    // Sequential on purpose. Concurrent exports of one Azure database multiply the
    // DTU cost of the backup window, and the service tier is the user's bill.
    const stagingDir = await createTempDir("azure-sql-");
    try {
        const entries: TarFileEntry[] = [];

        for (const dbName of databases) {
            const localPath = path.join(stagingDir, `${dbName}.bacpac`);
            await host.captureOutput(localPath, {}, (hostPath) =>
                exporter.exportDatabase(config, dbName, hostPath, host, log),
            );
            entries.push({ name: `${dbName}.bacpac`, path: localPath, dbName, format: "bacpac" });
        }

        log(`Packing ${entries.length} exports into an archive`);
        await createMultiDbTar(entries, destinationPath, { sourceType: "azure-sql" });
    } finally {
        await cleanupTempDir(stagingDir);
    }
}
