import fs from "fs";
import { pipeline } from "stream/promises";
import type { DatabaseAdapter } from "@/lib/core/interfaces";
import type { LogLevel, LogType } from "@/lib/core/logs";
import { AdapterError } from "@/lib/logging/errors";
import type { CloudflareD1Config } from "@/lib/adapters/definitions";
import { d1Request, databaseIdOf, findDatabase, listDatabases, query, type D1Connection, type D1Database } from "./api";
import { importDatabase } from "./jobs";
import { INTERNAL_OBJECT_FILTER, quoteIdentifier } from "./sql";

type OnLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;
type Log = (message: string, level?: "info" | "warning" | "error") => void;
type D1RestoreConfig = CloudflareD1Config & D1Connection & {
    databaseMapping?: { originalName: string; targetName: string; selected: boolean }[];
};

/**
 * A restore into D1, like every other adapter: an existing target is replaced, a new name creates
 * a new database.
 *
 * Replacing never deletes the database itself. A Worker binds a D1 database by its ID, and a new
 * database gets a new ID, so the restore drops the objects inside and keeps the database. The drops
 * go into the same file as the dump, ahead of it, and D1 runs an import as one transaction: an
 * import that fails leaves the target exactly as it was, never half empty.
 *
 * Before it replaces anything, the restore writes the current Time Travel bookmark of the target
 * into the log, with the command that goes back to it.
 */

/** The Time Travel bookmark of a database now, or null when Cloudflare does not answer one. */
async function currentBookmark(config: D1Connection, uuid: string): Promise<string | null> {
    try {
        const { result } = await d1Request<{ bookmark?: string }>(config, "restore", "GET", `/d1/database/${databaseIdOf(uuid)}/time_travel/bookmark`);
        return typeof result?.bookmark === "string" ? result.bookmark : null;
    } catch {
        return null;
    }
}

/**
 * The statements that empty a database: triggers, views, virtual tables, then tables, each with
 * `IF EXISTS`, since dropping a virtual table drops its shadow tables too. Objects of SQLite and of
 * Cloudflare stay.
 */
async function dropStatements(config: D1Connection, uuid: string): Promise<string[]> {
    const [result] = await query<{ type: string; name: string; sql: string | null }>(
        config,
        uuid,
        `SELECT type, name, sql FROM sqlite_master WHERE type IN ('trigger', 'view', 'table') AND ${INTERNAL_OBJECT_FILTER}`,
    );
    const rank = (object: { type: string; sql: string | null }) =>
        object.type === "trigger" ? 0 : object.type === "view" ? 1 : /^CREATE VIRTUAL TABLE/i.test(object.sql ?? "") ? 2 : 3;
    return (result?.results ?? [])
        .sort((a, b) => rank(a) - rank(b))
        .map((object) => `DROP ${object.type === "trigger" ? "TRIGGER" : object.type === "view" ? "VIEW" : "TABLE"} IF EXISTS ${quoteIdentifier(object.name)};`);
}

/** The dump with the drops ahead of it, in a file beside it. */
async function withDropsAhead(dumpPath: string, drops: string[]): Promise<string> {
    const combined = `${dumpPath}.replace.sql`;
    const out = fs.createWriteStream(combined);
    out.write(["PRAGMA defer_foreign_keys=TRUE;", ...drops, ""].join("\n"));
    await pipeline(fs.createReadStream(dumpPath), out);
    return combined;
}

/** Where a new database goes: what the connection says, or like the database the backup came from. */
async function locationOf(config: D1RestoreConfig, originalName: string | undefined, log: Log): Promise<Record<string, string>> {
    const wanted = config.newDatabaseLocation ?? "auto";
    if (wanted === "eu" || wanted === "fedramp") return { jurisdiction: wanted };
    if (wanted !== "auto") return { primary_location_hint: wanted };

    const original = originalName ? await findDatabase(config, originalName).catch(() => null) : null;
    if (original?.jurisdiction) {
        log(`Creating it in the jurisdiction ${original.jurisdiction}, like ${originalName}`);
        return { jurisdiction: original.jurisdiction };
    }
    return {};
}

async function createDatabase(config: D1RestoreConfig, name: string, originalName: string | undefined, log: Log): Promise<D1Database & { uuid: string }> {
    const location = await locationOf(config, originalName, log);
    const { result } = await d1Request<D1Database>(config, "restore", "POST", "/d1/database", { name, ...location });
    const uuid = databaseIdOf(result?.uuid);
    log(`Created the D1 database ${name} (ID ${uuid}). A Worker that should use it needs this ID as its database_id.`);
    return { ...result, uuid };
}

async function deleteDatabase(config: D1Connection, uuid: string): Promise<void> {
    await d1Request(config, "restore", "DELETE", `/d1/database/${databaseIdOf(uuid)}`);
}

/** Restores one dump of `dumpOne` into the database named `targetDbName`. */
export const restoreOne: NonNullable<DatabaseAdapter["restoreOne"]> = async (config, filePath, targetDbName, _host, onLog, _onProgress, originalDbName) => {
    const log: Log = (message, level = "info") => onLog?.(message, level);
    const connection = config as D1RestoreConfig;
    const existing = await findDatabase(connection, targetDbName);

    if (!existing) {
        log(`${targetDbName} does not exist yet`);
        const created = await createDatabase(connection, targetDbName, originalDbName, log);
        try {
            const outcome = await importDatabase(connection, created.uuid, filePath, log);
            log(`Restored ${targetDbName} (${outcome.queries ?? "?"} statements)`);
        } catch (error: unknown) {
            // The database came from this restore and holds nothing, so it does not stay behind.
            await deleteDatabase(connection, created.uuid).catch(() => log(`Could not delete the empty database ${targetDbName} again, delete it in the Cloudflare dashboard.`, "warning"));
            throw error;
        }
        return;
    }

    const uuid = databaseIdOf(existing.uuid);
    const bookmark = await currentBookmark(connection, uuid);
    if (bookmark) {
        log(`Time Travel bookmark of ${targetDbName} before the restore: ${bookmark}. Back to it with: wrangler d1 time-travel restore ${targetDbName} --bookmark=${bookmark}`);
    } else {
        log(`Cloudflare answered no Time Travel bookmark for ${targetDbName}, the state before the restore can only be found by its time.`, "warning");
    }

    const drops = await dropStatements(connection, uuid);
    log(drops.length > 0 ? `Replacing ${targetDbName}: dropping its ${drops.length} objects and importing the backup in one transaction` : `${targetDbName} is empty, importing the backup`);

    const importPath = drops.length > 0 ? await withDropsAhead(filePath, drops) : filePath;
    try {
        const outcome = await importDatabase(connection, uuid, importPath, log);
        log(`Restored ${targetDbName} (${outcome.queries ?? "?"} statements)`);
    } finally {
        if (importPath !== filePath) await fs.promises.rm(importPath, { force: true });
    }
};

/**
 * Before the restore starts: the token reaches the account. Whether it may write shows first at
 * the import, Cloudflare offers no check without side effects.
 */
export const prepareRestore: NonNullable<DatabaseAdapter["prepareRestore"]> = async (config) => {
    await listDatabases(config as D1Connection);
};

/**
 * A restore of a backup in the format before the seekable archive. This adapter never wrote one,
 * so the only file that can arrive is a single dump.
 */
// LEGACY-FORMAT(read): Part of DatabaseAdapter.restore. Remove it together with DatabaseAdapter.restore.
export const restore: DatabaseAdapter["restore"] = async (config, sourcePath, host, onLog, onProgress) => {
    const startedAt = new Date();
    const logs: string[] = [];
    const log: OnLog = (message, level, type, details) => {
        logs.push(message);
        onLog?.(message, level, type, details);
    };
    try {
        const connection = config as D1RestoreConfig;
        const picked = connection.databaseMapping?.find((entry) => entry.selected);
        const named = Array.isArray(connection.database) ? connection.database[0] : connection.database;
        const target = picked?.targetName || picked?.originalName || named;
        if (!target) throw new AdapterError("cloudflare-d1", "restore", "No target database named for the restore.");
        await restoreOne(config, sourcePath, target, host, log, onProgress, picked?.originalName);
        return { success: true, path: sourcePath, logs, startedAt, completedAt: new Date() };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error: ${message}`, "error");
        return { success: false, error: message, logs, startedAt, completedAt: new Date() };
    }
};
