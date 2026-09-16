/**
 * Database Service
 *
 * Size information and maintenance for DBackup's own SQLite database: VACUUM to give space from
 * deleted rows back to the disk, and a consistent snapshot of the whole file for download.
 *
 * Both operations run through Prisma's single connection and hold it until they finish. They
 * refuse to start while a backup, restore or system task is running, and set the maintenance
 * flag so nothing new starts until they are done.
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { formatInTimeZone } from "date-fns-tz";
import prisma from "@/lib/prisma";
import { getTempDir, getTempPath } from "@/lib/temp-dir";
import { DATABASE_BUSY, beginDatabaseMaintenance, endDatabaseMaintenance } from "@/lib/server/database-maintenance";
import { formatBytes } from "@/lib/utils";
import { ServiceError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ service: "DatabaseService" });

export interface DatabaseInfo {
    /** Absolute path of the database file, as SQLite reports it. */
    path: string;
    journalMode: string;
    fileBytes: number;
    /** Size of the `-wal` file. 0 outside WAL mode or right after a checkpoint. */
    walBytes: number;
    totalBytes: number;
    /** Bytes the pages in use take. A VACUUM shrinks the files to roughly this. */
    usedBytes: number;
    /**
     * Roughly what a VACUUM gives back. Strictly a lower bound: space wasted inside partially
     * filled pages is reclaimed too but cannot be measured up front, so the real gain is often
     * a bit larger.
     */
    reclaimableBytes: number;
    /** Free space on the volume holding the database, or null when the platform cannot tell. */
    freeDiskBytes: number | null;
}

export interface VacuumResult {
    beforeBytes: number;
    afterBytes: number;
    durationMs: number;
}

export interface DatabaseSnapshot {
    tempFile: string;
    fileName: string;
    sizeBytes: number;
}

function busy(operation: string, message: string): ServiceError {
    return new ServiceError("DatabaseService", operation, message, { code: DATABASE_BUSY });
}

/** First column of a single-row PRAGMA. Prisma returns integers as BigInt. */
async function readPragma(name: string): Promise<string | number> {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`PRAGMA ${name};`);
    const value = rows[0] ? Object.values(rows[0])[0] : undefined;
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "number" || typeof value === "string") return value;
    throw new ServiceError("DatabaseService", "readPragma", `PRAGMA ${name} returned no value`);
}

async function getDatabaseFilePath(): Promise<string> {
    // Asking SQLite avoids re-implementing how Prisma resolves a relative DATABASE_URL.
    const rows = await prisma.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list;");
    const main = rows.find((row) => row.name === "main");
    if (!main?.file) {
        throw new ServiceError("DatabaseService", "getDatabaseFilePath", "Could not determine the database file location");
    }
    return main.file;
}

async function fileSize(filePath: string): Promise<number> {
    try {
        return (await fs.stat(filePath)).size;
    } catch {
        return 0;
    }
}

async function freeBytesAt(dir: string): Promise<number | null> {
    try {
        const stats = await fs.statfs(dir);
        return Number(stats.bavail) * Number(stats.bsize);
    } catch {
        return null;
    }
}

export async function getDatabaseInfo(): Promise<DatabaseInfo> {
    const filePath = await getDatabaseFilePath();
    const pageSize = Number(await readPragma("page_size"));
    const pageCount = Number(await readPragma("page_count"));
    const freePages = Number(await readPragma("freelist_count"));
    const journalMode = String(await readPragma("journal_mode")).toLowerCase();

    const [fileBytes, walBytes, freeDiskBytes] = await Promise.all([
        fileSize(filePath),
        fileSize(`${filePath}-wal`),
        freeBytesAt(path.dirname(filePath)),
    ]);

    const totalBytes = fileBytes + walBytes;
    const usedBytes = (pageCount - freePages) * pageSize;

    return {
        path: filePath,
        journalMode,
        fileBytes,
        walBytes,
        totalBytes,
        usedBytes,
        reclaimableBytes: Math.max(0, totalBytes - usedBytes),
        freeDiskBytes,
    };
}

async function requireFreeSpace(operation: string, dir: string, requiredBytes: number): Promise<void> {
    const free = await freeBytesAt(dir);
    if (free !== null && free < requiredBytes) {
        throw busy(
            operation,
            `Not enough free disk space in ${dir}. ${formatBytes(requiredBytes)} are needed, ${formatBytes(free)} are available.`
        );
    }
}

/**
 * Runs a maintenance operation with the flag held, after checking nothing is running.
 * Releases the flag and restarts the queue afterwards, whatever happened.
 */
async function withMaintenance<T>(operation: string, fn: (info: DatabaseInfo) => Promise<T>): Promise<T> {
    if (!beginDatabaseMaintenance()) {
        throw busy(operation, "Another database maintenance operation is already running.");
    }

    try {
        const running = await prisma.execution.count({ where: { status: "Running" } });
        if (running > 0) {
            throw busy(
                operation,
                `${running} run${running === 1 ? " is" : "s are"} in progress. Try again once ${running === 1 ? "it has" : "they have"} finished.`
            );
        }
        return await fn(await getDatabaseInfo());
    } finally {
        endDatabaseMaintenance();
        // Backups queued while the flag was held start now. Imported lazily because the queue
        // pulls in the whole runner.
        import("@/lib/execution/queue-manager")
            .then(({ processQueue }) => processQueue())
            .catch((error: unknown) => log.error("Failed to resume the queue after database maintenance", { operation }, wrapError(error)));
    }
}

/**
 * Rebuilds the database file without its unused pages, then truncates the WAL so the space
 * actually returns to the disk.
 */
export async function vacuumDatabase(): Promise<VacuumResult> {
    return withMaintenance("vacuum", async (before) => {
        // In WAL mode the rebuilt database is written to the -wal file first.
        await requireFreeSpace("vacuum", path.dirname(before.path), before.usedBytes);

        const startedAt = Date.now();
        await prisma.$executeRawUnsafe("VACUUM;");
        if (before.journalMode === "wal") {
            await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE);");
        }
        const durationMs = Date.now() - startedAt;

        const after = await getDatabaseInfo();
        log.info("Database vacuumed", { beforeBytes: before.totalBytes, afterBytes: after.totalBytes, durationMs });
        return { beforeBytes: before.totalBytes, afterBytes: after.totalBytes, durationMs };
    });
}

/**
 * Writes a consistent, compacted copy of the database to a temp file. Includes everything still
 * in the WAL, which a plain file copy would miss. The caller owns the file and deletes it.
 */
export async function createDatabaseSnapshot(): Promise<DatabaseSnapshot> {
    return withMaintenance("snapshot", async (info) => {
        await requireFreeSpace("snapshot", getTempDir(), info.usedBytes);

        const tempFile = getTempPath(`dbackup-database-${process.pid}-${crypto.randomUUID()}.db`);
        try {
            await prisma.$executeRaw`VACUUM INTO ${tempFile}`;
            const sizeBytes = (await fs.stat(tempFile)).size;
            const fileName = `dbackup-database_${formatInTimeZone(new Date(), "UTC", "yyyy-MM-dd_HH-mm-ss")}.db`;
            log.info("Database snapshot created", { sizeBytes });
            return { tempFile, fileName, sizeBytes };
        } catch (error: unknown) {
            await fs.unlink(tempFile).catch(() => { });
            throw error;
        }
    });
}
