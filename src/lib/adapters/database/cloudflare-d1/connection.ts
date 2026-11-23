import type { DatabaseAdapter, DatabaseInfo } from "@/lib/core/interfaces";
import { d1Request, listDatabases, type D1Connection } from "./api";

/**
 * Connectivity and the list of databases of a Cloudflare account.
 *
 * The test lists the databases, which checks the token, the account and the right to read D1 at
 * once. It cannot check the right to export (D1 Edit) without side effects: an export locks the
 * database while it runs. A token with D1 Read only passes the test and fails at the first backup,
 * with a message that names the missing permission.
 */

/** The sentence of an error, without the `[adapter] operation:` an `AdapterError` puts in front. */
function errorText(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/^\[cloudflare-d1\] [a-z-]+: /, "");
}

export const test: NonNullable<DatabaseAdapter["test"]> = async (config) => {
    try {
        const databases = await listDatabases(config as D1Connection);
        const count = databases.length === 1 ? "1 database" : `${databases.length} databases`;
        return {
            success: true,
            message: `Connected to Cloudflare D1 (${count}). Backups need the permission D1 Edit on the token.`,
        };
    } catch (error: unknown) {
        return { success: false, message: errorText(error) };
    }
};

/** One small page of the list, the cheapest call that proves token and account. */
export const ping: NonNullable<DatabaseAdapter["ping"]> = async (config) => {
    try {
        await d1Request(config as D1Connection, "ping", "GET", "/d1/database?per_page=10");
        return { success: true, message: "Cloudflare D1 answered" };
    } catch (error: unknown) {
        return { success: false, message: errorText(error) };
    }
};

export const getDatabases: NonNullable<DatabaseAdapter["getDatabases"]> = async (config) => {
    const databases = await listDatabases(config as D1Connection);
    return databases.map((db) => db.name).sort((a, b) => a.localeCompare(b));
};

/** The list answers size and table count of every database, so no call per database is needed. */
export const getDatabasesWithStats: NonNullable<DatabaseAdapter["getDatabasesWithStats"]> = async (config) => {
    const databases = await listDatabases(config as D1Connection);
    return databases
        .map((db): DatabaseInfo => ({
            name: db.name,
            sizeInBytes: typeof db.file_size === "number" ? db.file_size : undefined,
            tableCount: typeof db.num_tables === "number" ? db.num_tables : undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
};
