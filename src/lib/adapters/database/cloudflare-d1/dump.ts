import type { DatabaseAdapter } from "@/lib/core/interfaces";
import type { LogLevel, LogType } from "@/lib/core/logs";
import { AdapterError } from "@/lib/logging/errors";
import { formatBytes } from "@/lib/utils";
import { requireDatabase, type D1Connection } from "./api";
import { exportDatabase } from "./jobs";
import { warnAboutLargeIntegers } from "./large-integers";
import type { CloudflareD1Config } from "@/lib/adapters/definitions";

type OnLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

/**
 * The backup of one D1 database: the SQL dump of Cloudflare's export, unchanged.
 *
 * The export locks the database while it runs (it serves no queries until the export ends), which
 * the run log says before it starts. Databases are picked by name and looked up on every run, so a
 * database deleted and created again under the same name is backed up under its new ID.
 */
export const dumpOne: NonNullable<DatabaseAdapter["dumpOne"]> = async (config, dbName, destinationPath, _host, onLog) => {
    const log = (message: string, level: LogLevel = "info") => onLog?.(message, level);
    const connection = config as CloudflareD1Config & D1Connection;

    const db = await requireDatabase(connection, dbName, "dump");
    if (connection.checkLargeIntegers !== false) {
        await warnAboutLargeIntegers(connection, db.uuid, dbName, log);
    }

    log(`Exporting ${dbName}. Cloudflare locks the database until the export ends, it serves no queries meanwhile.`);
    const size = await exportDatabase(connection, db.uuid, destinationPath, log);
    if (size === 0) {
        throw new AdapterError("cloudflare-d1", "dump", `The export of ${dbName} is empty.`);
    }
    log(`Exported ${dbName} (${formatBytes(size)})`);
    return { size };
};

/** The databases of the job's selection, refused when it names none. */
function selectedDatabases(config: Record<string, unknown>): string[] {
    const value = config.database;
    const names = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return names.map((name) => String(name).trim()).filter(Boolean);
}

/**
 * The backup in the format before the seekable archive. A new adapter has no such backups, the
 * interface still asks for it, so this writes the single database a job names.
 */
// LEGACY-FORMAT(write): Part of DatabaseAdapter.dump, which no job calls anymore. Remove it together with DatabaseAdapter.dump.
export const dump: DatabaseAdapter["dump"] = async (config, destinationPath, host, onLog) => {
    const startedAt = new Date();
    const logs: string[] = [];
    const log: OnLog = (message, level, type, details) => {
        logs.push(message);
        onLog?.(message, level, type, details);
    };
    try {
        const names = selectedDatabases(config as Record<string, unknown>);
        if (names.length !== 1) throw new AdapterError("cloudflare-d1", "dump", "A dump without the archive holds exactly one database.");
        const { size } = await dumpOne(config, names[0], destinationPath, host, log);
        return { success: true, path: destinationPath, size, logs, startedAt, completedAt: new Date() };
    } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error), logs, startedAt, completedAt: new Date() };
    }
};
