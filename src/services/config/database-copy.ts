/**
 * The configuration backup is a copy of the whole database of DBackup. A copy holds every table,
 * every link and whatever a later version adds, so nothing has to be taught to export or import it.
 *
 * The copy also carries the ENCRYPTION_KEY and BETTER_AUTH_SECRET it was made with, in a row that
 * only ever exists in a copy. The file is encrypted with a key of the Vault, and a restore onto a
 * DBackup with other values encrypts the stored secrets again for that one.
 */

import { promises as fs } from "fs";
import { PrismaClient } from "@prisma/client";
import { createDatabaseSnapshot } from "@/services/system/database-service";
import packageJson from "../../../package.json";

/** The row of a copy that holds the keys of the DBackup it came from. */
export const COPY_KEYS_SETTING = "configBackup.copyKeys";

/** What a restore never takes over: every sign-in ends with it, and the caches fill again. */
export const DROPPED_TABLES = ["Session", "Verification", "StorageListCache", "DatabaseListCache"];

/** The history, which a copy holds only with Include the history. */
export const HISTORY_TABLES = ["NotificationLog", "Execution", "AuditLog", "StorageSnapshot", "HealthCheckLog"];

/** The keys of the DBackup a copy came from, and when and by which version it was made. */
export interface CopyKeys {
    encryptionKey: string;
    authSecret: string;
    version: string;
    createdAt: string;
}

/** A client of its own on a copy, apart from the live database. The caller disconnects it. */
export function openCopy(file: string): PrismaClient {
    return new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
}

/** The keys a copy carries, or null for a copy without them, like a download of the database. */
export async function readCopyKeys(copy: PrismaClient): Promise<CopyKeys | null> {
    const row = await copy.systemSetting.findUnique({ where: { key: COPY_KEYS_SETTING } }).catch(() => null);
    if (!row) return null;
    try {
        const keys = JSON.parse(row.value) as Partial<CopyKeys>;
        return typeof keys.encryptionKey === "string" && typeof keys.authSecret === "string"
            ? { encryptionKey: keys.encryptionKey, authSecret: keys.authSecret, version: keys.version ?? "", createdAt: keys.createdAt ?? "" }
            : null;
    } catch {
        return null;
    }
}

/**
 * A copy of the database for the configuration backup, in a temp file the caller removes: without
 * sign-ins and caches, without the history unless it is wanted, and with the keys of this DBackup.
 */
export async function createConfigCopy({ includeHistory }: { includeHistory: boolean }): Promise<{ file: string; sizeBytes: number }> {
    const snapshot = await createDatabaseSnapshot();
    const copy = openCopy(snapshot.tempFile);
    try {
        for (const table of [...DROPPED_TABLES, ...(includeHistory ? [] : HISTORY_TABLES)]) {
            await copy.$executeRawUnsafe(`DELETE FROM "${table}"`);
        }
        const keys: CopyKeys = {
            encryptionKey: process.env.ENCRYPTION_KEY ?? "",
            authSecret: process.env.BETTER_AUTH_SECRET ?? "",
            version: packageJson.version,
            createdAt: new Date().toISOString(),
        };
        const value = JSON.stringify(keys);
        await copy.systemSetting.upsert({ where: { key: COPY_KEYS_SETTING }, create: { key: COPY_KEYS_SETTING, value }, update: { value } });
        // Gives the space of what was removed back, the file is uploaded as it is.
        await copy.$executeRawUnsafe("VACUUM");
    } catch (error: unknown) {
        await copy.$disconnect();
        await fs.unlink(snapshot.tempFile).catch(() => undefined);
        throw error;
    }
    await copy.$disconnect();
    const { size } = await fs.stat(snapshot.tempFile);
    return { file: snapshot.tempFile, sizeBytes: size };
}
